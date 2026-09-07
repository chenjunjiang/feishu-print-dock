// 回归守卫：html2canvas 调用必须带 useCORS:true
// 背景（2026-09-07 Task 0 实测 bug）：附件 tmp URL 跨域，html2canvas 默认 useCORS:false
// 会静默跳过跨域图片（不报错、canvas 不污染），导致写回/下载 PDF 丢码图只剩文本边框。
// jsdom 无法真实渲染 canvas，这里用源码扫描保证所有调用点不退化（import.meta.glob 免 node 类型）。
/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob('../src/**/*.{ts,tsx}', { as: 'raw', eager: true }) as Record<string, string>;

describe('html2canvas useCORS 回归守卫', () => {
  it('所有 html2canvas 调用点必须显式 useCORS:true（跨域附件图防静默丢图）', () => {
    const violations: string[] = [];
    let callCount = 0;
    for (const [file, code] of Object.entries(SOURCES)) {
      // 匹配每个 html2canvas( 调用的参数对象（单行/多行均可）
      const re = /html2canvas\(\s*[^,]+,\s*\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        callCount++;
        if (!/useCORS:\s*true/.test(m[1])) violations.push(`${file}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(callCount).toBeGreaterThan(0); // 防扫描失效（重命名/目录变更时应报错）
    expect(violations).toEqual([]);
  });
});
