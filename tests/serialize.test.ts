// serialize.ts 单测：白名单 7 类型 / 数组连接 / 空值 / 不支持类型 / 防 [object Object]
import { describe, it, expect } from 'vitest';
import { serializeValue, formatDateTime, SERIALIZABLE_TYPES } from '../src/engine/serialize';

describe('白名单与不支持类型', () => {
  it('7 类型在白名单内', () => {
    expect(SERIALIZABLE_TYPES).toHaveLength(7);
    for (const t of ['Text', 'Number', 'SingleSelect', 'DateTime', 'Checkbox', 'Url', 'AutoNumber']) {
      expect(SERIALIZABLE_TYPES).toContain(t);
    }
  });

  it('不支持类型显式返回 unsupported（不输出 [object Object]）', () => {
    const r = serializeValue('User', { name: '张三' });
    expect(r.ok).toBe(false);
    expect(r.unsupported).toBe('User');
    expect(r.text).toBe('');
    const r2 = serializeValue('Formula', { value: 42 });
    expect(r2.ok).toBe(false);
  });
});

describe('各类型序列化', () => {
  it('Text：string 直传；富文本段数组拼接', () => {
    expect(serializeValue('Text', 'hello').text).toBe('hello');
    expect(serializeValue('Text', [{ type: 'text', text: '订单' }, { type: 'text', text: 'A-1' }]).text).toBe('订单A-1');
  });

  it('Number：数字直转', () => {
    expect(serializeValue('Number', 42.5).text).toBe('42.5');
  });

  it('SingleSelect：选项对象取文本', () => {
    expect(serializeValue('SingleSelect', { text: '选项A' }).text).toBe('选项A');
    expect(serializeValue('SingleSelect', { name: '选项B' }).text).toBe('选项B');
  });

  it('DateTime：时间戳 -> 本地日期时间', () => {
    const r = serializeValue('DateTime', 1756800000000);
    expect(r.text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('Checkbox：是/否', () => {
    expect(serializeValue('Checkbox', true).text).toBe('是');
    expect(serializeValue('Checkbox', false).text).toBe('否');
  });

  it('Url：优先显示文本（与表格显示一致），无文本取 link', () => {
    expect(serializeValue('Url', { link: 'https://example.com', text: '例子' }).text).toBe('例子');
    expect(serializeValue('Url', { link: 'https://example.com' }).text).toBe('https://example.com');
  });

  it('空值：null/undefined/空串 -> 空文本（不报错）', () => {
    expect(serializeValue('Text', null).text).toBe('');
    expect(serializeValue('Text', undefined).text).toBe('');
    expect(serializeValue('Text', '').text).toBe('');
  });

  it('数组：逗号连接', () => {
    expect(serializeValue('Text', ['a', 'b', 'c']).text).toBe('abc'); // 富文本段拼接优先
    const r = serializeValue('Number', [1, 2, 3]);
    expect(r.ok).toBe(true);
    expect(r.text).toBe('123');
  });
});

describe('formatDateTime', () => {
  it('非法输入兜底字符串化', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});
