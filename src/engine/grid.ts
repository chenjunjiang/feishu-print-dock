// 网格排版计算（纯函数，mm 为布局真源；px 换算仅用于 raster 出口）
// SPEC v1.3：A4 210×297mm；150dpi 目标画布 1240×1754px（html2canvas scale = 150/96 ≈ 1.5625）

/** A4 尺寸（mm） */
export const A4_W_MM = 210;
export const A4_H_MM = 297;
/** CSS 像素基准 96dpi：1mm = 96/25.4 px */
export const MM_TO_CSS_PX = 96 / 25.4;
/** raster 目标 dpi 与换算（禁 scale=2 错误换算） */
export const TARGET_DPI = 150;
export const HTML2CANVAS_SCALE = TARGET_DPI / 96; // ≈ 1.5625
/** A4@150dpi 目标画布（jsPDF 断言用） */
export const A4_PX_150DPI = { width: 1240, height: 1754 } as const;

export interface GridSpec {
  rows: number;
  cols: number;
  /** 页边距 mm（四边统一） */
  marginMm: number;
  /** 标签间距 mm */
  gapMm: number;
}

export interface CellRect {
  /** mm 坐标（相对页面左上） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 该格在序列中的页码（0 起） */
  page: number;
  /** 页内位置 */
  row: number;
  col: number;
}

export interface GridLayout {
  cells: CellRect[];
  pageCount: number;
  cellW: number;
  cellH: number;
}

/** 网格参数校验（非法输入显式拒绝，不静默 clamp） */
export function validateGrid(spec: GridSpec): string | null {
  if (!Number.isInteger(spec.rows) || spec.rows < 1 || spec.rows > 20) return '行数须为 1-20 整数';
  if (!Number.isInteger(spec.cols) || spec.cols < 1 || spec.cols > 20) return '列数须为 1-20 整数';
  if (spec.marginMm < 0 || spec.marginMm > 30) return '页边距须为 0-30mm';
  if (spec.gapMm < 0 || spec.gapMm > 20) return '间距须为 0-20mm';
  const cellW = (A4_W_MM - 2 * spec.marginMm - (spec.cols - 1) * spec.gapMm) / spec.cols;
  const cellH = (A4_H_MM - 2 * spec.marginMm - (spec.rows - 1) * spec.gapMm) / spec.rows;
  if (cellW < 10 || cellH < 10) return '单元格小于 10mm，请减少行列或增大边距';
  return null;
}

/** 计算网格布局：总单元数 = items；页数 = ceil(items / (rows×cols)) */
export function computeGrid(spec: GridSpec, items: number): GridLayout {
  const cellW = (A4_W_MM - 2 * spec.marginMm - (spec.cols - 1) * spec.gapMm) / spec.cols;
  const cellH = (A4_H_MM - 2 * spec.marginMm - (spec.rows - 1) * spec.gapMm) / spec.rows;
  const perPage = spec.rows * spec.cols;
  const cells: CellRect[] = [];
  for (let i = 0; i < items; i++) {
    const page = Math.floor(i / perPage);
    const inPage = i % perPage;
    const row = Math.floor(inPage / spec.cols);
    const col = inPage % spec.cols;
    cells.push({
      x: spec.marginMm + col * (cellW + spec.gapMm),
      y: spec.marginMm + row * (cellH + spec.gapMm),
      w: cellW,
      h: cellH,
      page,
      row,
      col,
    });
  }
  return { cells, pageCount: Math.max(1, Math.ceil(items / perPage)), cellW, cellH };
}

/** mm -> CSS px（排版渲染用；分页舍入误差：同页统一 round 防累计漂移） */
export function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_CSS_PX * 100) / 100;
}
