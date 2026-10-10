// 小票模式计算引擎（纯函数）：出库记录行 -> 58mm 小票数据
// spec 锁定：分单位整数运算；行金额逐行 half-up 舍入后再求和（禁止先求和再舍入）；
// 折扣下限 0、应付不为负；数量/单价空或 <=0、名称为空的行跳过并计数；单号留空自动生成 yyyyMMddHHmmss

/** 纸张常量（mm）：58mm 热敏纸，内容宽 = 纸宽 - 左右各 2mm 边距 */
export const RECEIPT_PAPER_MM = 58;
export const RECEIPT_CONTENT_MM = 54;

/** 出库记录映射后的一行商品（qty/price 读表可能为 null——空单元格；引擎负责校验） */
export interface ReceiptItem {
  name: string;
  qty: number | null;
  price: number | null;
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
    const price = it.price;
    const valid =
      name !== '' &&
      typeof qty === 'number' && Number.isFinite(qty) && qty > 0 &&
      typeof price === 'number' && Number.isFinite(price) && price > 0;
    if (!valid) {
      skippedCount += 1;
      continue;
    }
    // 此分支内 qty/price 已验证为正数（上面复合条件已窄化，类型系统不跨变量，断言安全）
    const q = qty as number;
    const pr = price as number;
    // 逐行 half-up 到分，再累加（spec 禁止先求和再舍入）
    const amountFen = roundToCents(q * pr);
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
