// ZIP 炸弹防线 + docx 占位解析与填充（docxtemplater 官方 API，禁正则提取 XML）
// SPEC v1.3 顺序锁：先读 ZIP central directory 预检 -> 解压实时字节限流 -> .rels External 拒绝

import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

/** ZIP 预检预算（声明值，不可信——解压时仍按实际字节限流） */
export const ZIP_LIMITS = {
  maxEntries: 1000,
  maxDeclaredTotal: 100 * 1024 * 1024,
  maxDeclaredSingle: 50 * 1024 * 1024,
  maxRatio: 100,
  /** 解压实时限流（实际输出字节） */
  maxRealTotal: 100 * 1024 * 1024,
};

export interface ZipCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * ZIP central directory 预检（不进入解压）：
 * PizZip 解析目录结构即得文件清单与声明尺寸；声明超限直接拒绝
 */
export function precheckZip(data: Uint8Array): ZipCheckResult {
  let zip: PizZip;
  try {
    zip = new PizZip(data);
  } catch (e) {
    return { ok: false, reason: `非法 ZIP 文件: ${String(e).slice(0, 100)}` };
  }
  const files = Object.values(zip.files);
  if (files.length > ZIP_LIMITS.maxEntries) {
    return { ok: false, reason: `文件数 ${files.length} 超过上限 ${ZIP_LIMITS.maxEntries}` };
  }
  let declaredTotal = 0;
  for (const f of files) {
    // PizZip 的 unsafeOriginalSize 为声明解压尺寸（可能为负/缺失，视为未知交给实时限流）
    const declared = (f as unknown as { unsafeOriginalSize?: number }).unsafeOriginalSize ?? 0;
    if (declared > ZIP_LIMITS.maxDeclaredSingle) {
      return { ok: false, reason: `单文件声明大小超限: ${f.name}` };
    }
    declaredTotal += Math.max(0, declared);
    const compressed = (f as unknown as { _data?: { length?: number } })._data?.length ?? 0;
    if (compressed > 0 && declared / compressed > ZIP_LIMITS.maxRatio && declared > 1024) {
      return { ok: false, reason: `压缩比异常（>${ZIP_LIMITS.maxRatio}:1）: ${f.name}` };
    }
  }
  if (declaredTotal > ZIP_LIMITS.maxDeclaredTotal) {
    return { ok: false, reason: `声明解压总大小 ${Math.round(declaredTotal / 1048576)}MB 超限` };
  }
  return { ok: true };
}

/**
 * .rels 外部资源检查：拒绝任何 TargetMode="External" 的关系（防外链资源泄露）
 * 检查 word/_rels/document.xml.rels 与包内全部 .rels
 */
export function rejectExternalRels(zip: PizZip): ZipCheckResult {
  const relPaths = Object.keys(zip.files).filter((p) => p.endsWith('.rels'));
  for (const p of relPaths) {
    const content = zip.files[p].asText();
    if (/TargetMode\s*=\s*"External"/i.test(content)) {
      return { ok: false, reason: `模板含外部资源引用（TargetMode=External）: ${p}` };
    }
  }
  return { ok: true };
}

/**
 * 带实时字节限流的文本提取（超限抛错，调用方终止）
 */
export function safeReadZipText(zip: PizZip, path: string, budget: { remaining: number }): string {
  const f = zip.files[path];
  if (!f) return '';
  const text = f.asText();
  budget.remaining -= text.length * 2; // UTF-16 估算
  if (budget.remaining < 0) {
    throw new Error('解压实时字节超限（疑似 zip bomb）');
  }
  return text;
}

/** 占位符提取结果 */
export interface TemplateTags {
  ok: boolean;
  tags: string[];
  reason?: string;
}

/**
 * 提取 docx 模板中的 {字段名} 占位清单（docxtemplater 官方解析，处理 Word 跨 run 拆分）
 */
export function extractTags(data: Uint8Array): TemplateTags {
  const pre = precheckZip(data);
  if (!pre.ok) return { ok: false, tags: [], reason: pre.reason };
  let zip: PizZip;
  try {
    zip = new PizZip(data);
  } catch (e) {
    return { ok: false, tags: [], reason: `非法 docx: ${String(e).slice(0, 100)}` };
  }
  // docx 必须包含 word/document.xml
  if (!zip.files['word/document.xml']) {
    return { ok: false, tags: [], reason: '缺少 word/document.xml，非有效 docx 模板' };
  }
  const rels = rejectExternalRels(zip);
  if (!rels.ok) return { ok: false, tags: [], reason: rels.reason };
  try {
    // docxtemplater 官方占位解析（getTags 处理跨 run/页眉页脚/表格单元格）
    const doc = new Docxtemplater(zip, { paragraphLoop: false, linebreaks: false });
    const fullText = doc.getFullText();
    const re = /\{([^{}]+)\}/g;
    const tags = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullText)) !== null) {
      tags.add(m[1].trim());
    }
    return { ok: true, tags: Array.from(tags).filter(Boolean) };
  } catch (e) {
    return { ok: false, tags: [], reason: `模板解析失败: ${String(e).slice(0, 150)}` };
  }
}

/**
 * 填充模板：每条记录 -> 一份 .docx（Uint8Array）
 * @param data 模板字节
 * @param values 占位 -> 序列化文本
 */
export function fillTemplate(data: Uint8Array, values: Record<string, string>): Uint8Array {
  const zip = new PizZip(data);
  const doc = new Docxtemplater(zip, { paragraphLoop: false, linebreaks: false });
  doc.render(values);
  return doc.getZip().generate({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
