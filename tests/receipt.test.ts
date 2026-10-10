// buildReceipt 计算逻辑单测：金额直接取表值（客户计算逻辑为准），分单位整数 half-up，折扣下限 0，无效行跳过
import { describe, it, expect } from 'vitest';
import {
  buildReceipt,
  ReceiptItem,
  ReceiptConfig,
  RECEIPT_PAPER_MM,
  RECEIPT_CONTENT_MM,
} from '../src/engine/receipt';

const baseConfig: ReceiptConfig = {
  storeNameEn: 'SÉRUNE RHEA',
  storeNameCn: '山川草木',
  orderNo: '',
  cashier: '某某人',
  discountYuan: 0,
  thanks: '— 感谢您的光临 —',
  slogan: '让美好的事物参与我们生命的流动！',
  brandImage: null,
};

describe('buildReceipt 计算规则', () => {
  it('常规 3 行：行金额直接取表值（销售总金额），小计/总数正确', () => {
    const items: ReceiptItem[] = [
      { name: '玫瑰-长', qty: 1, amount: 18 },
      { name: '肉桂-短', qty: 1, amount: 18 },
      { name: '橙花精油', qty: 2, amount: 36 },
    ];
    const r = buildReceipt(items, baseConfig);
    expect(r.lines.map((l) => l.amountFen)).toEqual([1800, 1800, 3600]);
    expect(r.totalCount).toBe(4);
    expect(r.subtotalFen).toBe(7200);
    expect(r.payableFen).toBe(7200);
  });

  it('金额舍入：表值超过 2 位小数（公式列）half-up 到分', () => {
    const items: ReceiptItem[] = [
      { name: 'a', qty: 1, amount: 18.005 },
      { name: 'b', qty: 1, amount: 18.004 },
    ];
    const r = buildReceipt(items, baseConfig);
    expect(r.lines.map((l) => l.amountFen)).toEqual([1801, 1800]);
    expect(r.subtotalFen).toBe(3601);
  });

  it('小数数量（0.5 扎花材）可计算', () => {
    const items: ReceiptItem[] = [{ name: '尤加利', qty: 0.5, amount: 20 }];
    const r = buildReceipt(items, baseConfig);
    expect(r.lines[0].amountFen).toBe(2000);
    expect(r.totalCount).toBe(0.5);
    expect(r.totalCountText).toBe('0.5');
  });

  it('浮点累加残留清理：0.1+0.2 的总数显示 0.3 而非 0.30000000000000004', () => {
    const items: ReceiptItem[] = [
      { name: 'a', qty: 0.1, amount: 10 },
      { name: 'b', qty: 0.2, amount: 10 },
    ];
    const r = buildReceipt(items, baseConfig);
    expect(r.totalCount).toBeCloseTo(0.3, 10);
    expect(r.totalCountText).toBe('0.3');
  });

  it('折扣：应付 = 小计 - 折扣；折扣超过小计时应付为 0 不为负', () => {
    const items: ReceiptItem[] = [{ name: 'x', qty: 2, amount: 10 }];
    const r = buildReceipt(items, { ...baseConfig, discountYuan: 5 });
    expect(r.payableFen).toBe(500); // 行金额=10 元（表值直取，非 10×2）
    const r2 = buildReceipt(items, { ...baseConfig, discountYuan: 999 });
    expect(r2.payableFen).toBe(0);
    const r3 = buildReceipt(items, { ...baseConfig, discountYuan: -5 }); // 负折扣视为 0
    expect(r3.payableFen).toBe(1000);
    expect(r3.discountFen).toBe(0);
  });

  it('无效行跳过：数量/金额空、非数字、<=0、名称空全部跳过，skippedCount 计数', () => {
    const items: ReceiptItem[] = [
      { name: '有效', qty: 1, amount: 10 },
      { name: '零数量', qty: 0, amount: 10 },
      { name: '负金额', qty: 1, amount: -3 },
      { name: '空金额', qty: 1, amount: null },
      { name: 'NaN数量', qty: NaN, amount: 5 },
      { name: '', qty: 1, amount: 10 },
    ];
    const r = buildReceipt(items, baseConfig);
    expect(r.lines).toHaveLength(1);
    expect(r.skippedCount).toBe(5);
  });

  it('全部行被跳过：canPrint=false', () => {
    const r = buildReceipt([{ name: 'x', qty: 0, amount: 1 }], baseConfig);
    expect(r.canPrint).toBe(false);
    expect(buildReceipt([], baseConfig).canPrint).toBe(false);
  });

  it('金额格式化：分为单位转 ¥x.xx', () => {
    const items: ReceiptItem[] = [{ name: 'x', qty: 1, amount: 12.3 }];
    const r = buildReceipt(items, baseConfig);
    expect(r.lines[0].amountText).toBe('¥12.30');
    expect(r.payableText).toBe('¥12.30');
  });

  it('单号生成：yyyyMMddHHmmss 14 位数字', () => {
    const no = buildReceipt([], baseConfig, new Date('2026-10-09T10:30:00'));
    expect(no.generatedOrderNo).toMatch(/^20261009103000$/);
  });

  it('纸张常量锁定：58mm 纸宽 54mm 内容宽', () => {
    expect(RECEIPT_PAPER_MM).toBe(58);
    expect(RECEIPT_CONTENT_MM).toBe(54);
  });
});

// 字段映射白名单：用户出库表实测确证（销售总金额=公式20、销售单价=数字2/货币格式）
import { RECEIPT_TEXT_TYPES, RECEIPT_NUMBER_TYPES } from '../src/engine/receipt';

describe('字段映射白名单', () => {
  it('覆盖用户出库表的全部字段类型（商品名称1/销售单价2/出库数量2/销售总金额20公式）', () => {
    expect(RECEIPT_TEXT_TYPES).toContain(1);   // 商品名称(文本)
    expect(RECEIPT_NUMBER_TYPES).toContain(2);  // 销售单价/出库数量(数字)
    expect(RECEIPT_NUMBER_TYPES).toContain(20); // 销售总金额(公式)
    expect(RECEIPT_NUMBER_TYPES).toContain(99003); // 货币（其他表防御）
  });
});

// parseNumeric：实测 SDK/OpenAPI 数字字段可能返回字符串 "18"，公式返回 number——两者都要命中
import { parseNumeric } from '../src/engine/receipt';

describe('parseNumeric 宽松数字化', () => {
  it('number 直通（含小数），非有限数（NaN/Infinity）-> null', () => {
    expect(parseNumeric(18)).toBe(18);
    expect(parseNumeric(18.5)).toBe(18.5);
    expect(parseNumeric(NaN)).toBeNull();
    expect(parseNumeric(Infinity)).toBeNull();
  });
  it('字符串数字（OpenAPI 形态 "18"）-> number；空白串 -> null', () => {
    expect(parseNumeric('18')).toBe(18);
    expect(parseNumeric(' 36.5 ')).toBe(36.5);
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric('   ')).toBeNull();
    expect(parseNumeric('abc')).toBeNull();
  });
  it('null/undefined/无值对象 -> null', () => {
    expect(parseNumeric(null)).toBeNull();
    expect(parseNumeric(undefined)).toBeNull();
    expect(parseNumeric({ type: 20 })).toBeNull(); // 无 text/value 可取
  });
});

describe('parseNumeric 公式字段形态（js-sdk IOpenFormulaFuncCellValue）', () => {
  it('数值公式数字数组 [18] -> 18；空数组 -> null', () => {
    expect(parseNumeric([18])).toBe(18);
    expect(parseNumeric([36.5])).toBe(36.5);
    expect(parseNumeric([])).toBeNull();
  });
  it('富文本段数组 [{type,text}] -> 段文本数字化', () => {
    expect(parseNumeric([{ type: 'text', text: '18' }])).toBe(18);
    expect(parseNumeric([{ type: 'text', text: '¥36.00' }])).toBeNull(); // 带符号非纯数字不硬解
  });
  it('包装对象 {value:18} -> 18', () => {
    expect(parseNumeric({ value: 18 })).toBe(18);
    expect(parseNumeric({ value: '18' })).toBe(18);
  });
});
