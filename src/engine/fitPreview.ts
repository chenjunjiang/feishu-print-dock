// docx 预览缩放适配：docx-preview 按 A4 实宽（~794px）渲染，面板仅 ~350px。
// 直接 overflow 会在 flex 居中布局下把左侧裁掉，改为 transform 整体缩放。
// 注意：打印时必须还原（见 index.html @media print 里的 .print-area 复原规则），否则打印输出是缩小版。

/** 把 docx-preview 渲染结果等比缩放到容器宽度；容器够宽则不动 */
export function fitDocxPreview(container: HTMLElement): void {
  const pages = container.querySelectorAll<HTMLElement>('.docx');
  const wrapper = container.querySelector<HTMLElement>('.docx-wrapper');
  if (!pages.length || !wrapper || !pages[0].offsetWidth) return;
  // docx-preview 的 wrapper 是 display:flex + align-items:center：页比容器宽时 flex 居中
  // 把溢出页左移裁掉（负偏移），且缩放前必须解除居中，否则负偏移被 scale 一起缩进去
  wrapper.style.alignItems = 'flex-start';
  pages.forEach((p) => { p.style.margin = '0'; });
  const scale = container.clientWidth / pages[0].offsetWidth;
  if (scale >= 1) {
    container.style.overflow = 'auto';
    return;
  }
  wrapper.style.transformOrigin = 'top left';
  wrapper.style.transform = `scale(${scale})`;
  // transform 不改变占位高度，手动收容器高度避免底部大片留白
  container.style.height = `${wrapper.offsetHeight * scale}px`;
  container.style.overflow = 'hidden';
}
