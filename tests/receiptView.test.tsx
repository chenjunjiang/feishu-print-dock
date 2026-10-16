// ReceiptPrint 组件测试（原则 25）：tab 挂载/@page 切换/表单渲染
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// js-sdk 无浏览器环境，mock 掉 bitable（组件级测试只验渲染与挂载行为，不连真表——真表链路由浏览器 E2E 覆盖）
vi.mock('@lark-base-open/js-sdk', () => ({ bitable: { base: { getActiveTable: vi.fn(), getSelection: vi.fn() } } }));

import ReceiptPrint from '../src/views/ReceiptPrint';
import { bitable } from '@lark-base-open/js-sdk';

describe('ReceiptPrint 组件', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('挂载时注入 @page（默认 58mm 两长度合法写法）并打 data-print-receipt 标记，卸载还原 A4', () => {
    const { unmount } = render(<ReceiptPrint baseId="b" tableId="t" />);
    const styleText = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('');
    expect(styleText).toContain('@page { size: 58mm'); // 两长度合法写法（58mm auto 不合规范会被 Chrome 丢弃）
    expect(styleText).not.toContain('58mm auto');
    expect(document.body.hasAttribute('data-print-receipt')).toBe(true);
    unmount();
    const after = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('');
    expect(after).not.toContain('@page { size: 58mm'); // 覆盖规则已移除（A4 基础规则由 index.html 承担，E2E 验证）
    expect(document.getElementById('receipt-page-style')).toBeNull();
    expect(document.body.hasAttribute('data-print-receipt')).toBe(false);
  });

  it('beforeprint 时按所选纸张宽度重写 @page（触发即声明，无需调驱动）', () => {
    const { unmount } = render(<ReceiptPrint baseId="b" tableId="t" />);
    // 切到 40mm 窄卷（纸张宽度下拉 = 第 4 个 select，位于字段映射三个之后）
    fireEvent.change(document.querySelectorAll('select')[3], { target: { value: '40' } });
    window.dispatchEvent(new Event('beforeprint'));
    const styleText = document.getElementById('receipt-page-style')!.textContent!;
    expect(styleText).toContain('@page { size: 40mm');
    expect(styleText).not.toContain('58mm');
    unmount();
  });

  it('纸张宽度选择持久化：切换后写入 localStorage，重挂载自动恢复', () => {
    const { unmount } = render(<ReceiptPrint baseId="b" tableId="t" />);
    fireEvent.change(document.querySelectorAll('select')[3], { target: { value: '40' } });
    const saved = Object.keys(localStorage)
      .filter((k) => k.includes('receipt'))
      .map((k) => JSON.parse(localStorage.getItem(k)!));
    expect(saved.some((s) => s.data?.paperWidthMm === 40)).toBe(true);
    unmount();
    // 重挂载（模拟下次打开插件）：下拉恢复 40，@page 跟随
    const { unmount: unmount2 } = render(<ReceiptPrint baseId="b" tableId="t" />);
    expect((document.querySelectorAll('select')[3] as HTMLSelectElement).value).toBe('40');
    expect(document.getElementById('receipt-page-style')!.textContent).toContain('size: 40mm');
    unmount2();
  });

  it('渲染字段映射三个下拉 + 纸张宽度下拉与小票信息表单', () => {
    const { unmount } = render(<ReceiptPrint baseId="b" tableId="t" />);
    const selects = document.querySelectorAll('select');
    expect(selects.length).toBe(4); // 名称/数量/金额/纸张宽度
    const paperOpts = Array.from(selects[3].querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(paperOpts).toEqual(['58', '40', '80']); // 三档齐备，默认 58
    expect((selects[3] as HTMLSelectElement).value).toBe('58');
    const inputs = document.querySelectorAll('input[type="text"], input[type="number"]');
    expect(inputs.length).toBeGreaterThanOrEqual(6); // 店名x2/单号/收银/折扣/感谢/标语
    unmount();
  });

  it('店名输入实时反映到小票预览（执行前配置区即可见反馈）', () => {
    const { unmount } = render(<ReceiptPrint baseId="b" tableId="t" />);
    const inputs = document.querySelectorAll('input[type="text"]');
    const storeCn = inputs[1] as HTMLInputElement; // 第二个文本框 = 店名（中文）
    fireEvent.change(storeCn, { target: { value: '测试店' } });
    // 配置持久化写入了 localStorage（purpose=receipt 键空间）
    const keys = Object.keys(localStorage);
    expect(keys.some((k) => k.includes('receipt'))).toBe(true);
    unmount();
  });

  it('名称下拉包含查找引用字段(type 19)，数量下拉同样兼容（2026-10-14 用户反馈回归锚）', async () => {
    vi.mocked(bitable.base.getActiveTable).mockResolvedValue({
      getFieldMetaList: async () => [
        { id: 'f1', name: '出库单号', type: 1 },
        { id: 'fname', name: '商品名称', type: 19 },
        { id: 'fqty', name: '出库数量', type: 2 },
        { id: 'fqtyLk', name: '引用库存', type: 19 },
      ],
    } as never);
    const { unmount } = render(<ReceiptPrint baseId="b" tableId="t" />);
    await waitFor(() => {
      expect(document.querySelectorAll('select')[0]?.textContent).toContain('商品名称');
    });
    const selects = document.querySelectorAll('select');
    const nameOpts = Array.from(selects[0].querySelectorAll('option')).map((o) => o.textContent);
    expect(nameOpts).toContain('商品名称'); // 查找引用字段出现在名称下拉（本次 bug）
    expect(nameOpts).toContain('出库单号'); // 原有文本字段不受影响（兼容而非替换）
    const qtyOpts = Array.from(selects[1].querySelectorAll('option')).map((o) => o.textContent);
    expect(qtyOpts).toContain('引用库存'); // 数量侧同样接受查找引用（parseNumeric 兜底数组取首项）
    unmount();
  });

  /** 把组件 mock 到能执行出预览：1 行记录（玫瑰 ×2 ¥18），三个字段映射选好后点执行 */
  async function renderWithPreview() {
    vi.mocked(bitable.base.getActiveTable).mockResolvedValue({
      getFieldMetaList: async () => [
        { id: 'fn', name: '商品名称', type: 1 },
        { id: 'fq', name: '数量', type: 2 },
        { id: 'fa', name: '金额', type: 2 },
      ],
      getActiveView: async () => ({ getSelectedRecordIdList: async () => ['r1'] }),
      getField: async (id: string) => ({ getValue: async () => (id === 'fn' ? '玫瑰' : id === 'fq' ? 2 : 18) }),
    } as never);
    const rendered = render(<ReceiptPrint baseId="b" tableId="t" />);
    await waitFor(() => {
      expect(document.querySelectorAll('select')[0].querySelectorAll('option').length).toBeGreaterThan(1);
    });
    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: 'fn' } });
    fireEvent.change(selects[1], { target: { value: 'fq' } });
    fireEvent.change(selects[2], { target: { value: 'fa' } });
    // 测试环境无 i18n 实例，t() 原样返回键名（common.execute）
    const execBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'common.execute')!;
    fireEvent.click(execBtn);
    await waitFor(() => expect(document.querySelector('[data-receipt]')).not.toBeNull());
    return rendered;
  }

  it('打印走独立窗口：写入文档含所选纸张 @page 与小票内容，onload 后触发打印（2026-10-16 iframe @page 失效根因修复）', async () => {
    const { unmount } = await renderWithPreview();
    // 纸张切 40mm 窄卷
    fireEvent.change(document.querySelectorAll('select')[3], { target: { value: '40' } });
    const written: string[] = [];
    const fakeWin = {
      document: { write: (s: string) => written.push(s), close: () => {} },
      print: vi.fn(),
      addEventListener: vi.fn(),
      close: vi.fn(),
      onload: null as null | (() => void),
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
    const printBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'common.print')!;
    fireEvent.click(printBtn);
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    const doc = written.join('');
    expect(doc).toContain('@page { size: 40mm'); // 所选纸张宽度进独立窗口 @page（顶层文档，Chrome 必认）
    expect(doc).toContain('margin: 0'); // 零边距，挤压 Chrome 页眉页脚空间
    expect(doc).toContain('玫瑰'); // 小票内容
    expect(doc).toContain('¥18.00'); // 金额直接取表值 18（数量不参与乘法，客户计算逻辑为准）
    expect(doc).toContain('font-size: 7.3px'); // 40mm 档字号等比微缩 ×0.667（11px→7.3px）
    fakeWin.onload!(); // 内容加载完 -> 自动打印 + 注册 afterprint 关窗
    expect(fakeWin.print).toHaveBeenCalled();
    expect(fakeWin.addEventListener).toHaveBeenCalledWith('afterprint', expect.any(Function));
    openSpy.mockRestore();
    unmount();
  });

  it('弹窗被拦截时退化为原地打印；beforeprint 克隆小票到 #pd-print-root 防空白页，afterprint 移除', async () => {
    const { unmount } = await renderWithPreview();
    // 弹窗拦截 -> window.print 兜底
    vi.spyOn(window, 'open').mockReturnValue(null);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const printBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'common.print')!;
    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalled();
    // 原地路径：beforeprint 克隆小票到独立打印根（display:none 其余子树由 index.html 打印 CSS 承担）
    window.dispatchEvent(new Event('beforeprint'));
    const root = document.getElementById('pd-print-root');
    expect(root?.querySelector('[data-receipt]')).not.toBeNull();
    expect(root!.textContent).toContain('玫瑰');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('pd-print-root')).toBeNull();
    vi.restoreAllMocks();
    unmount();
  });
});
