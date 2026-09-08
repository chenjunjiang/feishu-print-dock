// records.ts 单测：选择读取/附件 URL 管理/文件名/标题
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSelectedRecordIds,
  makeAttachmentUrlCache,
  fetchImageBlob,
  recordTitleOf,
  safeFileName,
} from '../src/records';

// mock js-sdk（单测层允许 mock SDK 边界）
const h = vi.hoisted(() => ({ ids: ['rec1', 'rec2'], throwOn: '' as string }));
vi.mock('@lark-base-open/js-sdk', () => ({
  bitable: {
    base: {
      getActiveTable: async () => ({
        getActiveView: async () => ({
          getSelectedRecordIdList: async () => {
            if (h.throwOn === 'view') throw new Error('view gone');
            return h.ids;
          },
        }),
      }),
    },
  },
}));

beforeEach(() => {
  h.ids = ['rec1', 'rec2'];
  h.throwOn = '';
});

describe('getSelectedRecordIds', () => {
  it('正常返回选中记录', async () => {
    const r = await getSelectedRecordIds(200);
    expect(r.ok).toBe(true);
    expect(r.recordIds).toEqual(['rec1', 'rec2']);
  });

  it('空选择 -> 显式提示', async () => {
    h.ids = [];
    const r = await getSelectedRecordIds(200);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('请先选择记录');
  });

  it('超上限 -> 阻止执行 + 分批提示（不截断）', async () => {
    h.ids = Array.from({ length: 201 }, (_, i) => `rec${i}`);
    const r = await getSelectedRecordIds(200);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('200');
  });

  it('视图异常 -> 显式错误', async () => {
    h.throwOn = 'view';
    const r = await getSelectedRecordIds(200);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('读取选择失败');
  });
});

describe('makeAttachmentUrlCache', () => {
  it('按需获取 + 缓存命中（10 分钟内不重复取）', async () => {
    const field = { getAttachmentUrls: vi.fn(async () => ['https://tmp/x.png']) };
    const cache = makeAttachmentUrlCache();
    const u1 = await cache.get('rec1', field);
    const u2 = await cache.get('rec1', field);
    expect(u1).toBe('https://tmp/x.png');
    expect(u2).toBe('https://tmp/x.png');
    expect(field.getAttachmentUrls).toHaveBeenCalledTimes(1);
  });

  it('获取失败返回 null（不抛错）', async () => {
    const field = { getAttachmentUrls: vi.fn(async () => { throw new Error('404'); }) };
    const cache = makeAttachmentUrlCache();
    expect(await cache.get('recX', field)).toBeNull();
  });
});

describe('fetchImageBlob', () => {
  it('非 200 返回状态码（调用方触发重取）', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 403 })) as unknown as typeof fetch;
    const r = await fetchImageBlob('https://tmp/expired');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    globalThis.fetch = orig;
  });
});

describe('recordTitleOf / safeFileName', () => {
  it('标题：主字段字符串/富文本段/空 -> recordId 短码', () => {
    expect(recordTitleOf('rec123456', ' 订单A ')).toBe('订单A');
    expect(recordTitleOf('rec123456', [{ type: 'text', text: '富文本' }])).toBe('富文本');
    expect(recordTitleOf('rec123456', '')).toBe('rec123456'.slice(-6));
    expect(recordTitleOf('rec123456', null)).toBe('123456');
  });

  it('文件名：路径字符/换行/Windows 保留字符清洗，Unicode 保留', () => {
    expect(safeFileName('订单/A\\B', 'label', 'png')).toBe('订单-A-B-label.png');
    expect(safeFileName('a?b:c*d', '套打-p1', 'png')).toBe('abcd-套打-p1.png');
    expect(safeFileName('  ', 'label', 'png')).toBe('record-label.png');
    expect(safeFileName('中文标题超长'.repeat(20), 'label', 'png').length).toBeLessThanOrEqual(40 + '-label.png'.length + 10);
  });
});

// partitionRenderable：无图记录跳过（防 "no image" 空白标签上纸）
import { partitionRenderable } from '../src/records';

describe('partitionRenderable', () => {
  it('有图进 ok，无图（null）进 skipped，顺序保持', () => {
    const items = [
      { recordId: 'a', imgUrl: 'https://x/1.png' },
      { recordId: 'b', imgUrl: null },
      { recordId: 'c', imgUrl: 'https://x/2.png' },
      { recordId: 'd', imgUrl: null },
    ];
    const r = partitionRenderable(items);
    expect(r.ok.map((i) => i.recordId)).toEqual(['a', 'c']);
    expect(r.skipped.map((i) => i.recordId)).toEqual(['b', 'd']);
  });
  it('全有图 / 全无图边界', () => {
    const all = [{ imgUrl: 'u' }, { imgUrl: 'u2' }];
    expect(partitionRenderable(all).skipped).toEqual([]);
    expect(partitionRenderable([{ imgUrl: null }]).ok).toEqual([]);
  });
});
