// beforeprint 滚动归零守卫：Safari 按 iframe 滚动位置裁剪打印内容的防线
// （用户实测：面板滚到底部预览时打印，Safari 打印输出只剩文档末行）
import { describe, it, expect, vi } from 'vitest';

describe('beforeprint 滚动归零', () => {
  it('派发 beforeprint 时调用 window.scrollTo(0,0)', async () => {
    // jsdom 的 scrollTo 未实现，mock 后断言调用参数
    const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    // main.tsx 模块加载即注册监听；其副作用 createRoot 需要 #root 容器
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    await import('../src/main');
    window.dispatchEvent(new Event('beforeprint'));
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockRestore();
  });
});
