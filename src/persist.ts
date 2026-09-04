// 配置与模板持久化（localStorage 配置 + IndexedDB 模板文件 + 降级）
// SPEC v1.3：键空间 = baseId+tableId 隔离；B 的字段映射按模板内容哈希维度；
// 存储不可用 -> 内存态 + 横幅提示 + 导入导出 JSON 兜底；schema version 迁移

const SCHEMA_VERSION = 1;

export interface PersistedConfig<T> {
  version: number;
  data: T;
}

export type StorageHealth = 'ok' | 'degraded';

/** 存储可用性探测（隐私模式/分区存储降级） */
export function detectStorageHealth(): StorageHealth {
  try {
    const k = '__pd_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return 'ok';
  } catch {
    return 'degraded';
  }
}

/** 内存态兜底（存储不可用时） */
const memoryFallback = new Map<string, string>();

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryFallback.set(key, value);
  }
}

/** 配置键空间：baseId+tableId+用途（+模板哈希） */
export function configKey(baseId: string, tableId: string, purpose: string, templateHash?: string): string {
  return ['print-dock', baseId, tableId, purpose, templateHash].filter(Boolean).join(':');
}

/** 读配置（schema version 不符 -> 视为无配置，待迁移策略随版本扩展） */
export function loadConfig<T>(key: string): T | null {
  const raw = safeGet(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedConfig<T>;
    if (parsed.version !== SCHEMA_VERSION) return null;
    return parsed.data;
  } catch {
    return null; // 损坏配置回退默认
  }
}

export function saveConfig<T>(key: string, data: T): void {
  safeSet(key, JSON.stringify({ version: SCHEMA_VERSION, data } satisfies PersistedConfig<T>));
}

/** 配置导入导出（存储降级时的迁移兜底） */
export function exportConfig<T>(data: T): string {
  return JSON.stringify({ version: SCHEMA_VERSION, data }, null, 2);
}

export function importConfig<T>(json: string): T | null {
  try {
    const parsed = JSON.parse(json) as PersistedConfig<T>;
    if (parsed.version !== SCHEMA_VERSION) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** 模板内容哈希（IndexedDB 键 + 映射维度；djb2 变体，非加密用途） */
export function contentHash(data: Uint8Array): string {
  let h = 5381;
  const step = Math.max(1, Math.floor(data.length / 8192)); // 采样哈希，大文件 O(1)
  for (let i = 0; i < data.length; i += step) {
    h = ((h << 5) + h + data[i]) | 0;
  }
  return (h >>> 0).toString(36) + '-' + data.length.toString(36);
}

// ---- IndexedDB 模板文件存储 ----

const DB_NAME = 'print-dock';
const STORE = 'templates';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface StoredTemplate {
  name: string;
  data: Uint8Array;
  savedAt: number;
}

/** 存模板文件（键 = 模板内容哈希） */
export async function saveTemplate(hash: string, name: string, data: Uint8Array): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ name, data, savedAt: Date.now() } satisfies StoredTemplate, hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false; // IndexedDB 不可用 -> 降级（本次会话内有效即可）
  }
}

export async function loadTemplate(hash: string): Promise<StoredTemplate | null> {
  try {
    const db = await openDb();
    return await new Promise<StoredTemplate | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(hash);
      req.onsuccess = () => resolve((req.result as StoredTemplate | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
