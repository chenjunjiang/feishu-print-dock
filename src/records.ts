// 选中记录读取 + 附件 URL 管理（10 分钟时效，fetch->状态码->Blob->ObjectURL）
// SPEC v1.3：附件一律走 fetch 拿状态码（<img> error 拿不到 401/403）；401/403 按 recordId 重取一次

import { bitable } from '@lark-base-open/js-sdk';

export const MAX_SELECTED_A = 200;
export const MAX_BATCH_B = 50;
export const MAX_BATCH_C = 50;

export interface SelectionResult {
  ok: boolean;
  recordIds: string[];
  reason?: string;
}

/** 读选中记录（空选择/超上限显式处理；顺序暂按返回序，Task 0.3 验证） */
export async function getSelectedRecordIds(max: number): Promise<SelectionResult> {
  try {
    const table = await bitable.base.getActiveTable();
    const view = await table.getActiveView();
    // GridView 才有 getSelectedRecordIdList
    const viewAny = view as unknown as { getSelectedRecordIdList?: () => Promise<string[]> };
    if (typeof viewAny.getSelectedRecordIdList !== 'function') {
      return { ok: false, recordIds: [], reason: '请在表格视图中选择记录' };
    }
    const ids = await viewAny.getSelectedRecordIdList();
    if (!ids || ids.length === 0) {
      return { ok: false, recordIds: [], reason: '请先选择记录' };
    }
    if (ids.length > max) {
      return { ok: false, recordIds: [], reason: `已选 ${ids.length} 条，超过单批上限 ${max} 条，请分批处理` };
    }
    return { ok: true, recordIds: ids };
  } catch (e) {
    return { ok: false, recordIds: [], reason: `读取选择失败: ${String(e).slice(0, 100)}` };
  }
}

export interface AttachmentUrlCache {
  get(recordId: string, field: unknown): Promise<string | null>;
  revokeAll(): void;
}

/**
 * 附件 URL 管理器：
 * - 按需获取（不一次性全取）；10 分钟时效戳
 * - 401/403 -> 按 recordId 重取一次（不无限重试）
 * - ObjectURL 用完 revoke
 */
export function makeAttachmentUrlCache(): AttachmentUrlCache {
  const cache = new Map<string, { urls: string[]; fetchedAt: number }>();
  const TTL_MS = 9 * 60 * 1000; // 官方 10 分钟，留 1 分钟余量

  async function urlsFor(recordId: string, field: unknown, forceRefresh = false): Promise<string[] | null> {
    const hit = cache.get(recordId);
    if (!forceRefresh && hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.urls;
    try {
      const f = field as { getAttachmentUrls(recordOrId: string): Promise<string[]> };
      const urls = await f.getAttachmentUrls(recordId);
      cache.set(recordId, { urls, fetchedAt: Date.now() });
      return urls;
    } catch {
      return null;
    }
  }

  return {
    async get(recordId: string, field: unknown): Promise<string | null> {
      const urls = await urlsFor(recordId, field);
      return urls && urls.length > 0 ? urls[0] : null; // 多附件取第 0 个（UI 已注明）
    },
    revokeAll(): void {
      cache.clear();
    },
  };
}

/**
 * 临时 URL -> Blob（fetch 拿状态码；401/403 由调用方触发重取）
 * 用于 Canvas 链路（CORS 验证属 Task 0.4）
 */
export async function fetchImageBlob(url: string): Promise<{ ok: true; blob: Blob } | { ok: false; status: number }> {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return { ok: false, status: res.status };
    const blob = await res.blob();
    return { ok: true, blob };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Blob -> ObjectURL（配合 revokeObjectURL 使用） */
export function blobToObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/** 记录标题（表主字段值；空 -> recordId 短码） */
export function recordTitleOf(recordId: string, primaryValue: unknown): string {
  if (typeof primaryValue === 'string' && primaryValue.trim()) return primaryValue.trim();
  if (Array.isArray(primaryValue)) {
    const text = primaryValue
      .map((s) => (typeof s === 'object' && s !== null ? String((s as Record<string, unknown>).text ?? '') : String(s)))
      .join('')
      .trim();
    if (text) return text;
  }
  return recordId.slice(-6);
}

/**
 * 排版可渲染性分区：无图记录不进排版（否则打印出 "no image" 空白标签浪费纸）。
 * 返回 { ok: 可渲染, skipped: 无图被跳过 }，调用方负责提示跳过数量。
 */
export function partitionRenderable<T extends { imgUrl: string | null }>(items: T[]): { ok: T[]; skipped: T[] } {
  const ok: T[] = [];
  const skipped: T[] = [];
  for (const it of items) (it.imgUrl ? ok : skipped).push(it);
  return { ok, skipped };
}

/** 写回文件名（Unicode 保留；ZIP 路径与附件名安全字符） */
export function safeFileName(title: string, suffix: string, ext: string): string {
  const cleaned = title
    .replace(/[/\\]/g, '-')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[?*:<>|"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return `${cleaned || 'record'}-${suffix}.${ext}`;
}
