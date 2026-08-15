# TS Novel Spider 浏览器扩展

面向 Microsoft Edge、兼容 Google Chrome 的 Chromium Manifest V3 扩展工程。

当前只包含工程骨架：

- Manifest V3 清单
- 后台 service worker 入口
- 扩展弹窗入口
- 连接设置页入口
- TypeScript 类型检查与 Vite 构建

浏览器采集、配对、WebSocket 通信和开发数据导出等功能将在后续任务中实现。

## 本地开发

```powershell
npm install
npm run typecheck
npm run build
```

构建产物位于 `dist/`。

## 在 Edge 中加载

1. 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 选择“加载解压缩的扩展”，并选择本工程的 `dist/` 目录。

## 在 Chrome 中加载

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，并选择本工程的 `dist/` 目录。
