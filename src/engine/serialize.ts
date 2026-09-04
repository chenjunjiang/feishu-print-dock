// 字段值序列化（纯函数）：SDK 原始值 -> 套打/排版用显示字符串
// SPEC v1.3：v1 白名单 7 类型（Text/Number/SingleSelect/DateTime/Checkbox/Url/AutoNumber）；
// 防 [object Object]；数组 -> 逗号连接；时区 = 浏览器本地

/** 字段类型（与 js-sdk FieldType 对齐，本地定义避免依赖 SDK 枚举运行时） */
export type FieldTypeName =
  | 'Text' | 'Number' | 'SingleSelect' | 'DateTime' | 'Checkbox' | 'Url' | 'AutoNumber'
  | 'MultiSelect' | 'Attachment' | 'User' | 'Link' | 'Formula' | 'Other';

/** 白名单（v1 支持序列化的类型） */
export const SERIALIZABLE_TYPES: readonly FieldTypeName[] = [
  'Text', 'Number', 'SingleSelect', 'DateTime', 'Checkbox', 'Url', 'AutoNumber',
];

export interface SerializeResult {
  ok: boolean;
  text: string;
  /** 不支持的类型（ok=false 时填类型名） */
  unsupported?: string;
}

/** 富文本段数组拼接（飞书文本字段原始形态 [{type:'text',text:'...'}]） */
function flattenSegments(v: unknown[]): string | null {
  const parts: string[] = [];
  for (const seg of v) {
    if (typeof seg === 'string') {
      parts.push(seg);
    } else if (seg && typeof seg === 'object') {
      const o = seg as Record<string, unknown>;
      if (typeof o.text === 'string') parts.push(o.text);
      else if (typeof o.name === 'string') parts.push(o.name); // 人员/选项对象
      else return null;
    } else if (typeof seg === 'number') {
      parts.push(String(seg));
    } else {
      return null;
    }
  }
  return parts.join('');
}

/** 日期格式化（浏览器本地时区）：YYYY-MM-DD HH:mm（秒级时间戳）或仅日期 */
export function formatDateTime(v: number | string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 单值序列化（按字段类型） */
export function serializeValue(type: FieldTypeName, value: unknown): SerializeResult {
  if (!SERIALIZABLE_TYPES.includes(type)) {
    return { ok: false, text: '', unsupported: type };
  }
  if (value === null || value === undefined || value === '') {
    return { ok: true, text: '' };
  }
  if (typeof value === 'string') return { ok: true, text: value };
  if (typeof value === 'number') {
    if (type === 'DateTime') return { ok: true, text: formatDateTime(value) };
    return { ok: true, text: String(value) };
  }
  if (typeof value === 'boolean') {
    return { ok: true, text: value ? '是' : '否' };
  }
  if (Array.isArray(value)) {
    const flat = flattenSegments(value);
    if (flat !== null) return { ok: true, text: flat };
    // 数组兜底：逐元素序列化后逗号连接
    const parts = value.map((v) => serializeValue(type, v));
    if (parts.every((p) => p.ok)) {
      return { ok: true, text: parts.map((p) => p.text).filter(Boolean).join('，') };
    }
    return { ok: false, text: '', unsupported: `${type}[]` };
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.text === 'string') return { ok: true, text: o.text };
    if (typeof o.name === 'string') return { ok: true, text: o.name };
    if (typeof o.value === 'string' || typeof o.value === 'number') return { ok: true, text: String(o.value) };
    if (type === 'Url' && typeof o.link === 'string') return { ok: true, text: o.link };
    return { ok: false, text: '', unsupported: `${type}(object)` };
  }
  return { ok: false, text: '', unsupported: `${type}(${typeof value})` };
}
