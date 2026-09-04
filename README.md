# 打印台（feishu-print-dock）

飞书多维表格边栏插件：标签排版打印 / Word 模板套打 / 排版写回附件列。SPEC：`../docs/specs/2026-09-02-print-dock-v1.md`

## 快速命令

```bash
npm install
npm run dev        # 本地调试 :3000（多维表格「扩展脚本」粘贴 URL 加载）
npm test           # vitest（63 例：grid/serialize/template/persist/records/writeback）
npm run typecheck
npm run build      # 产物 dist/（须提交，官方托管契约）
```

## 官方契约（docs/官方边栏插件开发指南.md）

- `package.json.output = "dist"`；dist 提交入仓库；Vite `base: './'`；hash 路由（单页无路由）
- i18n 三语：locales/{zh,en,jp}.json（i18next）
- useTheme 浅深主题；垂直布局适配侧栏宽度；变化监听
- 数据安全：记录与模板内容不主动上传（依赖全 npm 内嵌，无 CDN/遥测）

## 上架链路

GitHub 仓库 → Replit 导入 → publish → 上架表单（Task 0 阻断项见 SPEC）
