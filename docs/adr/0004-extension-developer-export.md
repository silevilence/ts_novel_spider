# Extension developer export: local-only fixture and cookie aid (amends ADR-0002)

ADR-0002 规定浏览器扩展不得转发或存储站点会话 Cookie 与验证凭据——该约束针对运行时采集通道（凭据不得经配对通道回传服务端）。本 ADR 增加明确例外：扩展提供用户手动触发的「开发数据导出」工具，可将当前页渲染后 HTML 导出为本地文件，并可查看/复制页面 Cookie。数据仅落开发者本机，绝不回传服务端、不进入配对通道；该工具用于新站点适配器开发的 fixture 采集与 Cookie 需求调研（如 SyosetuOrg 的年龄确认门）。

## Considered Options

- **禁止一切 Cookie 导出** — rejected：年龄门等 Cookie 依赖状态无法用 fixture 复现，适配器开发受阻。
- **Cookie 经配对通道回传服务端** — rejected：违背 ADR-0002 安全模型（压缩失陷扩展的爆炸半径）。
- **本地导出 + 服务端零接收（chosen）** — 开发者本机人工流转，服务端与配对通道不感知凭据。

## Consequences

- 扩展需新增 dev 开关与导出 UI；导出为单向本地动作（下载 HTML / 剪贴板复制 Cookie）。
- ADR-0002 的运行时约束不变：桥接采集通道仍不传输凭据，失陷扩展的爆炸半径不扩大。
