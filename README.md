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

## 发布链路

```
本仓库(gitee monorepo, 工作区备份)
  → git subtree split -P feishu_print_dock -b print-dock-export
  → push print-dock-export 到 github.com/chenjunjiang/feishu-print-dock 的 main 分支
  → Vercel(Gumu1 team) 自动部署生产 → print-dock.snapdiff.app
```

- 注意：只推 gitee **不会**触发部署；必须 split 后推 GitHub main（Vercel 只接 GitHub，不认 gitee）
- split 分支命名 `print-dock-export`；其他子项目同理（feishu-qr-shortcut / feishu-qr-scan-shortcut / feishu-img-watermark-shortcut 各有独立 GitHub 仓库）
- CLI 直接 `vercel --prod` 会被 commit 作者校验拦（全局 git email 是占位邮箱 example.com，非团队成员）——走上面的 split 推送即可
- 上架表单：随 Vercel 生产地址提交（Task 0 阻断项见 SPEC）
