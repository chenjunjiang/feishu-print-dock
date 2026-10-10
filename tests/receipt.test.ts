// buildReceipt 计算逻辑单测：spec 锁定——分单位整数运算、行舍入 half-up、折扣下限 0、无效行跳过
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
  it('常规 3 行：行金额=单价×数量精确到分，小计/总数正确', () => {
    const items: ReceiptItem[] = [
      { name: '玫瑰-长', qty: 1, price: 18 },
      { name: '肉桂-短', qty: 1, price: 18 },
      { name: '橙花精油', qty: 1, price: 68 },
    ];
    const r = buildReceipt(items, baseConfig);
    expect(r.lines.map((l) => l.amountFen)).toEqual([1800, 1800, 6800]);
    expect(r.totalCount).toBe(3);
    expect(r.subtotalFen).toBe(10400);
    expect(r.payableFen).toBe(10400);
  });

  it('行金额逐行舍入 half-up 后求和（0.5 分入位），非先求和再舍入', () => {
    // 3 行 单价 0.335 元 数量 1 -> 每行 33.5 分 -> half-up 34 分；先求和再舍入会是 100.5->101，逐行是 102
    const items: ReceiptItem[] = [
      { name: 'a', qty: 1, price: 0.335 },
      { name: 'b', qty: 1, price: 0.335 },
      { name: 'c', qty: 1, price: 0.335 },
    ];
    const r = buildReceipt(items, baseConfig);
    expect(r.lines.map((l) => l.amountFen)).toEqual([34, 34, 34]);
    expect(r.subtotalFen).toBe(102);
  });

  it('小数数量（0.5 扎花材）可计算', () => {
    const items: ReceiptItem[] = [{ name: '尤加利', qty: 0.5, price: 20 }];
    const r = buildReceipt(items, baseConfig);
    expect(r.lines[0].amountFen).toBe(1000);
    expect(r.totalCount).toBe(0.5);
  });

  it('折扣：应付 = 小计 - 折扣；折扣超过小计时应付为 0 不为负', () => {
    const items: ReceiptItem[] = [{ name: 'x', qty: 2, price: 10 }];
    const r = buildReceipt(items, { ...baseConfig, discountYuan: 5 });
    expect(r.payableFen).toBe(1500);
    const r2 = buildReceipt(items, { ...baseConfig, discountYuan: 999 });
    expect(r2.payableFen).toBe(0);
    const r3 = buildReceipt(items, { ...baseConfig, discountYuan: -5 }); // 负折扣视为 0
    expect(r3.payableFen).toBe(2000);
    expect(r3.discountFen).toBe(0);
  });

  it('无效行跳过：数量/单价空、非数字、<=0 全部跳过，skippedCount 计数', () => {
    const items: ReceiptItem[] = [
      { name: '有效', qty: 1, price: 10 },
      { name: '零数量', qty: 0, price: 10 },
      { name: '负单价', qty: 1, price: -3 },
      { name: '空单价', qty: 1, price: null as unknown as number },
      { name: 'NaN数量', qty: NaN, price: 5 },
    ];
    const r = buildReceipt(items, baseConfig);
    expect(r.lines).toHaveLength(1);
    expect(r.skippedCount).toBe(4);
  });

  it('全部行被跳过：canPrint=false', () => {
    const r = buildReceipt([{ name: 'x', qty: 0, price: 1 }], baseConfig);
    expect(r.canPrint).toBe(false);
    expect(buildReceipt([], baseConfig).canPrint).toBe(false);
  });

  it('金额格式化：分为单位转 ¥x.xx', () => {
    const items: ReceiptItem[] = [{ name: 'x', qty: 1, price: 12.3 }];
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
