// C 写回（排版产物 -> 附件字段）：幂等/断点/进度/取消
// SPEC v1.3：串行流水线（并发=1），可取消；断点 recordId 集重试只补失败项；
// 决策表唯一规则（Task 0.2 实测定稿）：含非本插件附件 -> 需确认；纯本插件产物 -> 直接覆盖/按名删旧写新

export interface WriteBackItem {
  recordId: string;
  files: { name: string; blob: Blob }[];
}

export interface WriteBackProgress {
  done: number;
  total: number;
  currentRecordId?: string;
}

export interface WriteBackFailure {
  recordId: string;
  error: string;
}

export interface WriteBackResult {
  ok: boolean;
  succeeded: string[];
  failed: WriteBackFailure[];
  cancelled: boolean;
}

export interface AttachmentFieldLike {
  getValue(recordOrId: string): Promise<Array<{ name: string }>>;
  setValue(recordOrId: string, file: File | File[]): Promise<void>;
}

/** 本插件产物命名前缀（覆盖语义判定用） */
export const PLUGIN_FILE_MARKERS = ['-label.', '-套打', '-wm.'];

/** 判断是否含非本插件附件（决策表：含 -> 需用户确认） */
export function hasUserAttachments(existing: Array<{ name: string }>): boolean {
  return existing.some((a) => !PLUGIN_FILE_MARKERS.some((m) => a.name.includes(m)));
}

export interface WriteBackOptions {
  /** 用户已确认覆盖（含非本插件附件的记录由 UI 先弹窗） */
  confirmedOverwrite?: boolean;
  /** 进度回调 */
  onProgress?: (p: WriteBackProgress) => void;
  /** 取消信号 */
  isCancelled?: () => boolean;
  /** 已完成的 recordId 集（断点续传：跳过） */
  completedRecordIds?: Set<string>;
}

/**
 * 写回一批记录的附件（串行，断点可续）：
 * 每条 recordId 的 files 作为一次 setValue(File[]) 原子写入（Task 0.2 若证实不支持 File[]，
 * 调用方应合并为单文件长图再传入，本层契约 = 一次 setValue 一组）
 */
export async function writeBackBatch(
  field: AttachmentFieldLike,
  items: WriteBackItem[],
  opts: WriteBackOptions = {},
): Promise<WriteBackResult> {
  const succeeded: string[] = [];
  const failed: WriteBackFailure[] = [];
  const completed = opts.completedRecordIds ?? new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (opts.isCancelled?.()) {
      return { ok: failed.length === 0, succeeded, failed, cancelled: true };
    }
    if (completed.has(item.recordId)) {
      succeeded.push(item.recordId); // 断点：已完成直接计成功
      continue;
    }
    opts.onProgress?.({ done: i, total: items.length, currentRecordId: item.recordId });
    try {
      const files = item.files.map(
        (f) => new File([f.blob], f.name, { type: f.blob.type || 'image/png' }),
      );
      await field.setValue(item.recordId, files.length === 1 ? files[0] : files);
      succeeded.push(item.recordId);
      completed.add(item.recordId);
    } catch (e) {
      failed.push({ recordId: item.recordId, error: String(e).slice(0, 150) });
    }
  }
  opts.onProgress?.({ done: items.length, total: items.length });
  return { ok: failed.length === 0, succeeded, failed, cancelled: false };
}

/** 重试失败项（断点：只补失败，已完成不重复写） */
export function retryItems(items: WriteBackItem[], result: WriteBackResult): WriteBackItem[] {
  const failedIds = new Set(result.failed.map((f) => f.recordId));
  return items.filter((it) => failedIds.has(it.recordId));
}
