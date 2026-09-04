// persist.ts 单测：读写 / 键空间隔离 / 损坏回退 / 导入导出 / 哈希 / 降级
import { describe, it, expect, beforeEach } from 'vitest';
import {
  configKey,
  loadConfig,
  saveConfig,
  exportConfig,
  importConfig,
  contentHash,
  detectStorageHealth,
} from '../src/persist';

interface Cfg {
  rows: number;
  cols: number;
}

beforeEach(() => {
  localStorage.clear();
});

describe('配置读写与键空间', () => {
  it('saveConfig -> loadConfig 回读一致（带 schema version）', () => {
    const key = configKey('base1', 'tbl1', 'label');
    saveConfig<Cfg>(key, { rows: 4, cols: 4 });
    expect(loadConfig<Cfg>(key)).toEqual({ rows: 4, cols: 4 });
  });

  it('键空间隔离：baseId/tableId/用途/模板哈希互不错读', () => {
    const k1 = configKey('base1', 'tbl1', 'label');
    const k2 = configKey('base1', 'tbl2', 'label');
    const k3 = configKey('base2', 'tbl1', 'label');
    const k4 = configKey('base1', 'tbl1', 'merge', 'hashA');
    const k5 = configKey('base1', 'tbl1', 'merge', 'hashB');
    saveConfig(k1, { rows: 1, cols: 1 });
    saveConfig(k2, { rows: 2, cols: 2 });
    saveConfig(k3, { rows: 3, cols: 3 });
    saveConfig(k4, { rows: 4, cols: 4 });
    saveConfig(k5, { rows: 5, cols: 5 });
    expect(loadConfig<Cfg>(k1)).toEqual({ rows: 1, cols: 1 });
    expect(loadConfig<Cfg>(k2)).toEqual({ rows: 2, cols: 2 });
    expect(loadConfig<Cfg>(k3)).toEqual({ rows: 3, cols: 3 });
    expect(loadConfig<Cfg>(k4)).toEqual({ rows: 4, cols: 4 });
    expect(loadConfig<Cfg>(k5)).toEqual({ rows: 5, cols: 5 });
  });

  it('损坏配置回退 null（不抛错）', () => {
    const key = configKey('b', 't', 'x');
    localStorage.setItem(key, '{broken json');
    expect(loadConfig(key)).toBeNull();
    localStorage.setItem(key, JSON.stringify({ version: 999, data: { rows: 1 } }));
    expect(loadConfig(key)).toBeNull(); // schema 不符
  });

  it('不存在的键返回 null', () => {
    expect(loadConfig('print-dock:nope:nope:nope')).toBeNull();
  });
});

describe('导入导出', () => {
  it('exportConfig -> importConfig 回环', () => {
    const json = exportConfig<Cfg>({ rows: 4, cols: 8 });
    expect(importConfig<Cfg>(json)).toEqual({ rows: 4, cols: 8 });
  });

  it('非法 JSON / schema 不符返回 null', () => {
    expect(importConfig('not json')).toBeNull();
    expect(importConfig(JSON.stringify({ version: 0, data: {} }))).toBeNull();
  });
});

describe('contentHash', () => {
  it('同内容同哈希；不同内容不同哈希（含长度维度）', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    const c = new Uint8Array([1, 2, 3, 4, 6]);
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash(c));
    expect(contentHash(a)).not.toBe(contentHash(new Uint8Array([1, 2, 3, 4, 5, 6])));
  });

  it('大文件采样哈希 O(1)（不逐字节）', () => {
    const big = new Uint8Array(10 * 1024 * 1024);
    const t0 = Date.now();
    contentHash(big);
    expect(Date.now() - t0).toBeLessThan(100);
  });
});

describe('存储健康探测', () => {
  it('jsdom 环境 localStorage 可用 -> ok', () => {
    expect(detectStorageHealth()).toBe('ok');
  });
});
