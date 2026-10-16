// 小票模式计算引擎（纯函数）：出库记录行 -> 58mm 小票数据
// 金额规则（用户定版）：明细行金额直接取出库表「销售总金额」，不做单价×数量计算；
// 分单位整数运算，逐行 half-up 舍入后求和；折扣下限 0、应付不为负；
// 数量/金额空或 <=0、名称为空的行跳过并计数；单号留空自动生成 yyyyMMddHHmmss

/**
 * 纸张规格表（mm）：内容宽 = 纸宽 - 左右各 2mm 边距。
 * 三档来源：58/80 为热敏小票主流宽度；40 窄卷（2026-10-16 客户反馈：XP-58 驱动默认 58mm，
 * 40mm 纸用户每次打印都要手动调驱动——根因是旧 @page 写法 "58mm auto" 不合 CSS 规范被 Chrome 丢弃）。
 * fontScale：40mm 内容宽 36/54≈0.667 字号等比微缩防挤压；58/80 不缩放（80mm 每行更宽即可）。
 */
export interface ReceiptPaperSpec {
  widthMm: number;
  contentMm: number;
  fontScale: number;
}
export const RECEIPT_PAPERS: readonly ReceiptPaperSpec[] = [
  { widthMm: 58, contentMm: 54, fontScale: 1 },
  { widthMm: 40, contentMm: 36, fontScale: 36 / 54 },
  { widthMm: 80, contentMm: 76, fontScale: 1 },
];
export const DEFAULT_RECEIPT_PAPER_MM = 58;

/** 未知宽度回退默认 58mm（旧版本持久化数据/损坏值兼容） */
export function paperSpecOf(widthMm: number): ReceiptPaperSpec {
  return RECEIPT_PAPERS.find((p) => p.widthMm === widthMm) ?? RECEIPT_PAPERS[0];
}

/**
 * 字段映射类型白名单（js-sdk FieldType 枚举值，实测用户出库表确证）：
 * 名称 = 文本类 + 查找引用(19，商品名称常从商品表引用而来，2026-10-14 用户实测反馈)；
 * 数量/金额 = 数字(2) / 公式(20，销售总金额=单价×数量公式) / 货币(99003) + 查找引用(19，引用数字字段)
 * 公式字段 getValue 对数值公式返回 number，读取层按 typeof 过滤，文本公式自然跳过；
 * 查找引用值形态（数组取首项/富文本段）由 parseNumeric 与 serializeValue('Text') 兜底
 */
export const RECEIPT_TEXT_TYPES: readonly number[] = [1, 2, 3, 5, 7, 15, 1005, 19];
export const RECEIPT_NUMBER_TYPES: readonly number[] = [2, 20, 99003, 19];

/** 出库记录映射后的一行商品（qty/amount 读表可能为 null——空单元格；引擎负责校验） */
export interface ReceiptItem {
  name: string;
  qty: number | null;
  /** 行金额：直接取客户出库表的「销售总金额」，不做单价×数量计算（客户计算逻辑为准） */
  amount: number | null;
}

/** 面板配置（persist 持久化，purpose='receipt'；品牌图 dataURL 拆独立键避免按键写放大） */
export interface ReceiptConfig {
  storeNameEn: string;
  storeNameCn: string;
  /** 留空时自动生成时间戳单号 */
  orderNo: string;
  cashier: string;
  /** 折扣金额（元），<0 视为 0 */
  discountYuan: number;
  thanks: string;
  slogan: string;
  /** 品牌图 dataURL（PNG/JPG ≤200KB），null=不显示 */
  brandImage: string | null;
}

/** 小票明细行（金额以分为单位的整数，渲染层只消费 *Text 字段） */
export interface ReceiptLine {
  name: string;
  qty: number;
  amountFen: number;
  amountText: string;
}

/** buildReceipt 产物：渲染层只消费这些字段，不再做任何计算 */
export interface ReceiptData {
  lines: ReceiptLine[];
  totalCount: number;
  /** Σ数量（小数数量合法，如 0.5 扎花材）；浮点累加残留已清理（0.1+0.2 -> "0.3"） */
  totalCountText: string;
  subtotalFen: number;
  discountFen: number;
  payableFen: number;
  subtotalText: string;
  discountText: string;
  payableText: string;
  /** 被跳过的无效行数（名称为空 / 数量或单价为空、非数字、<=0） */
  skippedCount: number;
  /** 全部行被跳过或无输入时 false，渲染层禁用打印 */
  canPrint: boolean;
  /** 单号为空时自动生成的 yyyyMMddHHmmss 单号 */
  generatedOrderNo: string;
  dateText: string;
  timeText: string;
}

/** half-up 舍入到分（先放大到分再舍，+1e-6 对冲 33.5 这类二进制表示偏小的边界） */
function roundToCents(yuan: number): number {
  return Math.round(yuan * 100 + 1e-6);
}

/** 分 -> ¥x.xx */
function fenToText(fen: number): string {
  const sign = fen < 0 ? '-' : '';
  const abs = Math.abs(fen);
  const yuan = Math.floor(abs / 100);
  const cent = abs % 100;
  return `${sign}¥${yuan}.${String(cent).padStart(2, '0')}`;
}

/** 数量格式化：≤3 位小数、去尾零（0.30000000000000004 -> "0.3"，2 -> "2"） */
export function formatQty(n: number): string {
  return String(parseFloat(n.toFixed(3)));
}

/** yyyyMMddHHmmss 时间戳单号 */
export function generateOrderNo(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/**
 * 宽松数字化：SDK 字段值 -> number | null。
 * 实测/js-sdk 类型确证的形态：数字字段 number 或字符串 "18"；
 * 公式字段（js-sdk IOpenFormulaFuncCellValue）= number | string | number[] | 富文本段数组——
 * 数值公式可能返回 [18] 数字数组，段数组取 text 拼接；
 * 空串/纯空白/非数字/无限值一律 null（由 buildReceipt 跳过并计数）
 */
export function parseNumeric(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    // 实测（用户出库表诊断）：公式「销售总金额」返回带货币符号格式化串 "¥18.00"——剥符号/千分位/空白后再数字化
    const s = raw.replace(/[¥¥$€£,\s]/g, '').trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return parseNumeric(raw[0]); // number[] 或段数组：取首项递归
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.text === 'string') return parseNumeric(o.text); // 富文本段 {type,text}
    if (typeof o.value !== 'undefined') return parseNumeric(o.value); // 防包装 {value}
  }
  return null;
}

/**
 * 纯计算入口：items（已映射的出库行）+ 面板配置 -> 小票数据。
 * 无效行（名称为空；qty/price 为 null、非数字、<=0）跳过并计入 skippedCount。
 */
export function buildReceipt(items: ReceiptItem[], config: ReceiptConfig, now: Date = new Date()): ReceiptData {
  const lines: ReceiptLine[] = [];
  let skippedCount = 0;
  let totalCount = 0;
  let subtotalFen = 0;

  for (const it of items) {
    const name = typeof it.name === 'string' ? it.name.trim() : '';
    const qty = it.qty;
    const amount = it.amount;
    const valid =
      name !== '' &&
      typeof qty === 'number' && Number.isFinite(qty) && qty > 0 &&
      typeof amount === 'number' && Number.isFinite(amount) && amount > 0;
    if (!valid) {
      skippedCount += 1;
      continue;
    }
    // 此分支内 qty/amount 已验证为正数（上面复合条件已窄化，类型系统不跨变量，断言安全）
    const q = qty as number;
    // 行金额直接取表值（客户计算逻辑为准），仅做元->分 half-up 舍入
    const amountFen = roundToCents(amount as number);
    lines.push({ name, qty: q, amountFen, amountText: fenToText(amountFen) });
    totalCount += q;
    subtotalFen += amountFen;
  }

  // 折扣：<0 视为 0；>小计则应付为 0（不为负）
  const discountRaw = typeof config.discountYuan === 'number' && Number.isFinite(config.discountYuan) ? config.discountYuan : 0;
  const discountFen = Math.max(0, roundToCents(discountRaw));
  const payableFen = Math.max(0, subtotalFen - discountFen);

  const p = (n: number) => String(n).padStart(2, '0');
  const orderNo = config.orderNo.trim() || generateOrderNo(now);

  return {
    lines,
    totalCount,
    totalCountText: formatQty(totalCount),
    subtotalFen,
    discountFen,
    payableFen,
    subtotalText: fenToText(subtotalFen),
    discountText: `-${fenToText(discountFen).slice(1)}`, // "-0.00" 形态（不含¥，与客户模板一致）
    payableText: fenToText(payableFen),
    skippedCount,
    canPrint: lines.length > 0,
    generatedOrderNo: orderNo,
    dateText: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
    timeText: `${p(now.getHours())}:${p(now.getMinutes())}`,
  };
}
