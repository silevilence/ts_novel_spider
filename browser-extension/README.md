# TS Novel Spider 浏览器扩展

面向 Microsoft Edge、兼容 Google Chrome 的 Chromium Manifest V3 扩展工程，作为 [TS Novel Spider](../README.md) 的**浏览器采集桥接**传输端：在真实标签页中打开页面、回传渲染后的 DOM，并把任务状态展示给用户。

小说元数据、目录与正文解析始终由服务端的 Spider 适配器完成（详见 [传输端架构决策](../docs/adr/0001-browser-transport-only-extension.md)）；扩展负责导航、DOM 采集与验证/限流状态识别。

## 能力

- **配对**：在设置页填入服务器地址与一次性配对令牌，换取长期配对密钥；支持解除配对。
- **连接状态**：与服务器保持 WebSocket 连接（断线自动重连、心跳保活），弹窗实时展示连接、任务与下一步操作。
- **采集执行**：按服务端请求在受控标签页中打开目标页面，等待加载完成后回传渲染后的 HTML，并识别验证/限流页面以提示人工处理。
- **走查**：手动「保存本页」或「打开目录」，逐章推进采集流程。
- **任务控制**：在弹窗中暂停、继续或中止当前浏览器采集任务。
- **站点授权**：仅在用户授予对应站点的可选主机权限后才会访问该站点。
- **开发数据导出**（默认关闭，需在设置页开启）：把当前页 HTML 下载为本地文件、查看并复制当前页 Cookie，用于采集测试 fixture 与 Cookie 需求调研。数据只停留在开发者本机，绝不回传服务端或配对通道（见 [开发数据导出决策](../docs/adr/0004-extension-developer-export.md)）。

## 安全边界

- 运行时采集通道只回传渲染后的 DOM 与状态，不回传站点会话 Cookie 或验证凭据；开发数据导出的本地操作按上述例外处理。
- 配对密钥只授予桥接通道（`/api/browser/*`），不能访问管控 API。
- 服务端默认仅接受本机（回环地址）连接；容器部署时由服务端显式放开。

## 本地开发

需要 Microsoft Edge / Google Chrome 116+，构建使用 npm 与 Node.js（工程声明 `>=20`，主项目 CI 使用 22）。以下命令在仓库根目录执行：

```bash
npm ci --prefix browser-extension
npm run typecheck --prefix browser-extension
npm run build --prefix browser-extension
```

构建产物位于 `browser-extension/dist/`。扩展有独立依赖与 TypeScript 配置，主项目的 `npm run build` / `npm run typecheck` 不包含扩展。

扩展自动化测试由根工程的 tsx 执行，需先在根目录安装依赖：

```bash
npm ci
npm run test:extension
```

测试使用模拟 Chrome API 与连接，不依赖真实站点或浏览器。修改扩展后重新构建，并在扩展管理页重新加载。

## 在 Edge 中加载

1. 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 选择“加载解压缩的扩展”，并选择本工程的 `dist/` 目录。
4. 打开扩展设置页，填写服务器地址（默认 `http://127.0.0.1:3000`）与在「全局设置 → 浏览器采集桥接」生成的一次性配对令牌。

## 在 Chrome 中加载

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，并选择本工程的 `dist/` 目录。
4. 同样在扩展设置页完成服务器地址与配对令牌配置。

服务器地址填写后端地址，开发环境默认是 `http://127.0.0.1:3000`，不是 Vite 的 5173 端口。一次性令牌有效期为 5 分钟，成功交换后失效；已授权浏览器可在主应用的桥接面板撤销。

当前支持桥接的来源为 Syosetu、Syosetu18、Kakuyomu；新站点仍需添加服务端适配器并注册浏览器传输能力。浏览器传输采集的书籍不参与定时更新与远端图片缓存。
