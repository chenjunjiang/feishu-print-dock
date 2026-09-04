// grid.ts 单测：A4 网格计算（mm 真源/校验/分页/换算）
import { describe, it, expect } from 'vitest';
import {
  A4_W_MM,
  A4_H_MM,
  A4_PX_150DPI,
  HTML2CANVAS_SCALE,
  validateGrid,
  computeGrid,
  mmToPx,
} from '../src/engine/grid';

describe('validateGrid', () => {
  it('合法参数通过', () => {
    expect(validateGrid({ rows: 4, cols: 4, marginMm: 10, gapMm: 2 })).toBeNull();
    expect(validateGrid({ rows: 1, cols: 1, marginMm: 0, gapMm: 0 })).toBeNull();
  });

  it('非法行列/边距拒绝', () => {
    expect(validateGrid({ rows: 0, cols: 4, marginMm: 10, gapMm: 2 })).toContain('行数');
    expect(validateGrid({ rows: 4, cols: 21, marginMm: 10, gapMm: 2 })).toContain('列数');
    expect(validateGrid({ rows: 4, cols: 4, marginMm: 31, gapMm: 2 })).toContain('页边距');
    expect(validateGrid({ rows: 4.5, cols: 4, marginMm: 10, gapMm: 2 })).toContain('行数');
  });

  it('单元格过小拒绝（防不可读排版）', () => {
    expect(validateGrid({ rows: 20, cols: 20, marginMm: 10, gapMm: 5 })).toContain('10mm');
  });
});

describe('computeGrid', () => {
  it('4×4 @ 20 条 = 2 页（每页 16），坐标与页内位置正确', () => {
    const layout = computeGrid({ rows: 4, cols: 4, marginMm: 10, gapMm: 2 }, 20);
    expect(layout.pageCount).toBe(2);
    expect(layout.cells).toHaveLength(20);
    // 每页 16 格，第 17 条在第 2 页 (0,0)
    expect(layout.cells[16]).toMatchObject({ page: 1, row: 0, col: 0, x: 10, y: 10 });
    // 第 1 页第 2 行第 3 列
    const c = layout.cells[6];
    expect(c).toMatchObject({ page: 0, row: 1, col: 2 });
    expect(c.x).toBeCloseTo(10 + 2 * (c.w + 2), 5);
  });

  it('单元格尺寸：宽度 = (210 - 2×margin - (cols-1)×gap) / cols', () => {
    const layout = computeGrid({ rows: 2, cols: 4, marginMm: 10, gapMm: 0 }, 8);
    expect(layout.cellW).toBeCloseTo((A4_W_MM - 20) / 4, 5);
    expect(layout.cellH).toBeCloseTo((A4_H_MM - 20) / 2, 5);
  });

  it('0 条记录 = 0 格 1 页（空态安全）', () => {
    const layout = computeGrid({ rows: 4, cols: 4, marginMm: 10, gapMm: 2 }, 0);
    expect(layout.cells).toHaveLength(0);
    expect(layout.pageCount).toBe(1);
  });

  it('全部格在页面内（含边距，无溢出）', () => {
    const layout = computeGrid({ rows: 3, cols: 5, marginMm: 8, gapMm: 3 }, 15);
    for (const c of layout.cells) {
      expect(c.x + c.w).toBeLessThanOrEqual(A4_W_MM - 8 + 1e-9);
      expect(c.y + c.h).toBeLessThanOrEqual(A4_H_MM - 8 + 1e-9);
    }
  });
});

describe('换算与 dpi 常量', () => {
  it('html2canvas scale = 150/96 ≈ 1.5625（禁 scale=2）', () => {
    expect(HTML2CANVAS_SCALE).toBeCloseTo(1.5625, 4);
  });

  it('A4@150dpi 目标画布 1240×1754', () => {
    expect(A4_PX_150DPI.width).toBe(1240);
    expect(A4_PX_150DPI.height).toBe(1754);
  });

  it('mmToPx：210mm ≈ 793.7 CSS px', () => {
    expect(mmToPx(A4_W_MM)).toBeCloseTo(793.7, 0);
  });
});
