// fitDocxPreview 单测：缩放比计算、容器收高、宽容器不动（jsdom 无布局，mock 宽度）
import { describe, it, expect } from 'vitest';
import { fitDocxPreview } from '../src/engine/fitPreview';

/** 构造 docx-preview 渲染后的 DOM 结构并 mock 布局宽度 */
function makePreview(containerW: number, pageW: number, wrapperH: number) {
  const container = document.createElement('div');
  const wrapper = document.createElement('div');
  wrapper.className = 'docx-wrapper';
  const page = document.createElement('div');
  page.className = 'docx';
  wrapper.appendChild(page);
  container.appendChild(wrapper);
  document.body.appendChild(container);
  Object.defineProperty(container, 'clientWidth', { value: containerW });
  Object.defineProperty(page, 'offsetWidth', { value: pageW });
  Object.defineProperty(wrapper, 'offsetHeight', { value: wrapperH });
  return { container, wrapper };
}

describe('fitDocxPreview', () => {
  it('窄面板（350px）放 A4 页（794px）：整体缩放 ≈0.441 并收容器高度', () => {
    const { container, wrapper } = makePreview(350, 794, 1000);
    fitDocxPreview(container);
    expect(wrapper.style.transform).toBe(`scale(${350 / 794})`);
    expect(wrapper.style.transformOrigin).toBe('top left');
    expect(wrapper.style.alignItems).toBe('flex-start'); // 解除 flex 居中（负偏移裁左根因）
    expect(container.style.height).toBe(`${1000 * (350 / 794)}px`);
    expect(container.style.overflow).toBe('hidden');
  });
  it('容器比页面宽：不缩放，保持 auto 滚动', () => {
    const { container, wrapper } = makePreview(900, 794, 1000);
    fitDocxPreview(container);
    expect(wrapper.style.transform).toBe('');
    expect(container.style.overflow).toBe('auto');
  });
  it('docx-preview 结构缺失（渲染失败）时静默不炸', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    expect(() => fitDocxPreview(container)).not.toThrow();
  });
});
