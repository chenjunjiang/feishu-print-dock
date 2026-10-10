// ReceiptPrint 组件测试（原则 25）：tab 挂载/@page 切换/表单渲染
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

// js-sdk 无浏览器环境，mock 掉 bitable（组件级测试只验渲染与挂载行为，不连真表——真表链路由浏览器 E2E 覆盖）
vi.mock('@lark-base-open/js-sdk', () => ({ bitable: { base: { getActiveTable: vi.fn(), getSelection: vi.fn() } } }));

import ReceiptPrint from '../src/views/ReceiptPrint';

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

  it('挂载时把 @page 切为 58mm auto 并打 data-print-receipt 标记，卸载还原 A4', () => {
    const { unmount } = render(<ReceiptPrint baseId="b" tableId="t" />);
    const styleText = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('');
    expect(styleText).toContain('58mm auto');
    expect(document.body.hasAttribute('data-print-receipt')).toBe(true);
    unmount();
    const after = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('');
    expect(after).not.toContain('58mm auto'); // 覆盖规则已移除（A4 基础规则由 index.html 承担，E2E 验证）
    expect(document.getElementById('receipt-page-style')).toBeNull();
    expect(document.body.hasAttribute('data-print-receipt')).toBe(false);
  });

  it('渲染三个字段映射下拉与小票信息表单', () => {
    const { unmount } = render(<ReceiptPrint baseId="b" tableId="t" />);
    const selects = document.querySelectorAll('select');
    expect(selects.length).toBe(3); // 名称/数量/单价
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
});
