// writeback.ts 单测：幂等/断点/取消/决策表判定
import { describe, it, expect, vi } from 'vitest';
import {
  writeBackBatch,
  retryItems,
  hasUserAttachments,
  AttachmentFieldLike,
  WriteBackItem,
} from '../src/writeback';

function makeField(failFor: string[] = []): AttachmentFieldLike & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async getValue(recordId: string) {
      return [{ name: '用户原图.png' }];
    },
    async setValue(recordId: string) {
      if (failFor.includes(recordId)) throw new Error('network down');
      calls.push([recordId]);
    },
  };
}

const item = (id: string, name = 'x-label.png'): WriteBackItem => ({
  recordId: id,
  files: [{ name, blob: new Blob(['x'], { type: 'image/png' }) }],
});

describe('writeBackBatch', () => {
  it('10 条全部成功 + 结果清单', async () => {
    const field = makeField();
    const items = Array.from({ length: 10 }, (_, i) => item(`rec${i}`));
    const r = await writeBackBatch(field, items);
    expect(r.ok).toBe(true);
    expect(r.succeeded).toHaveLength(10);
    expect(field.calls).toHaveLength(10);
  });

  it('中途失败：失败项列入清单，其余继续（串行不中断）', async () => {
    const field = makeField(['rec2']);
    const items = [item('rec1'), item('rec2'), item('rec3')];
    const r = await writeBackBatch(field, items);
    expect(r.ok).toBe(false);
    expect(r.succeeded).toEqual(['rec1', 'rec3']);
    expect(r.failed).toEqual([{ recordId: 'rec2', error: 'Error: network down' }]);
  });

  it('取消：isCancelled 触发后停止，已完成保留', async () => {
    const field = makeField();
    let calls = 0;
    const r = await writeBackBatch(field, [item('rec1'), item('rec2'), item('rec3')], {
      isCancelled: () => ++calls > 1,
    });
    expect(r.cancelled).toBe(true);
    expect(r.succeeded.length).toBeLessThan(3);
  });

  it('断点续传：completedRecordIds 中的记录跳过（不重复写）', async () => {
    const field = makeField();
    const completed = new Set(['rec1', 'rec2']);
    const r = await writeBackBatch(field, [item('rec1'), item('rec2'), item('rec3')], {
      completedRecordIds: completed,
    });
    expect(r.succeeded).toEqual(['rec1', 'rec2', 'rec3']);
    expect(field.calls).toEqual([['rec3']]); // 只有 rec3 实际写
  });

  it('retryItems：只返回失败项（重试无重复文件）', () => {
    const items = [item('a'), item('b'), item('c')];
    const retried = retryItems(items, {
      ok: false,
      succeeded: ['a', 'c'],
      failed: [{ recordId: 'b', error: 'x' }],
      cancelled: false,
    });
    expect(retried.map((i) => i.recordId)).toEqual(['b']);
  });

  it('多文件一组原子写入（File[] 一次 setValue）', async () => {
    const field = makeField();
    const setValueSpy = vi.spyOn(field, 'setValue');
    await writeBackBatch(field, [
      { recordId: 'rec1', files: [
        { name: 'a-套打-p1.png', blob: new Blob(['1']) },
        { name: 'a-套打-p2.png', blob: new Blob(['2']) },
      ] },
    ]);
    expect(setValueSpy).toHaveBeenCalledTimes(1);
    const args = setValueSpy.mock.calls[0][1];
    expect(Array.isArray(args)).toBe(true);
    expect((args as File[]).map((f) => f.name)).toEqual(['a-套打-p1.png', 'a-套打-p2.png']);
  });

  it('进度回调按序触发', async () => {
    const field = makeField();
    const events: number[] = [];
    await writeBackBatch(field, [item('r1'), item('r2')], {
      onProgress: (p) => events.push(p.done),
    });
    expect(events[events.length - 1]).toBe(2);
  });
});

describe('hasUserAttachments（决策表判定）', () => {
  it('含非本插件附件 -> true（需确认）', () => {
    expect(hasUserAttachments([{ name: '身份证照片.jpg' }])).toBe(true);
    expect(hasUserAttachments([{ name: 'a-label.png' }, { name: '用户文件.pdf' }])).toBe(true);
  });

  it('纯本插件产物 -> false（直接覆盖）', () => {
    expect(hasUserAttachments([{ name: 'a-label.png' }, { name: 'b-套打-p1.png' }])).toBe(false);
    expect(hasUserAttachments([])).toBe(false);
  });
});
