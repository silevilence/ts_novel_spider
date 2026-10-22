# Pi SDK 模型与领域工具接入验收

2026-10-22，候选 `@earendil-works/pi-coding-agent` / `pi-agent-core` / `pi-ai` 1.4.0，独立实验目录 `scripts/experiments/pi-sdk/`。生产依赖和业务代码未修改。

## 可复现命令

```powershell
npm ci --prefix scripts/experiments/pi-sdk
npm run typecheck --prefix scripts/experiments/pi-sdk
```

进入实验目录后执行 `npx tsx --test integration.test.ts`。根依赖必须已安装；测试复用仓库 TS 业务模块，运行时使用 tsx 的 CommonJS 支持和 ESM SDK 适配。

## 验收结果

8 项集成测试验证：

- 实际 Pi OpenAI transport → 绑定任务的读取工具 → 现有 Index 提示词及生成函数 → 内存 SQLite 写回。另一个任务不变，任务没有被错误标为完成。
- 模型路由经过现有 `resolveCapabilityRoute`，专用翻译格式、缺失模型和未知上下文窗口不会被默认为可用主控。
- Index 只接收 user 消息、完整语言名称并关闭模板思考，响应 token 用量可读取；Pi 的控制器用量也可读取。
- 负段落索引、缺少参数和额外 taskId 注入在写操作执行前被拒绝，未启用默认文件或命令工具。
- 工具失败和 HTTP 401 记录为错误；提供商错误中 JSON 转义的模拟密钥也会在会话落盘前脱敏。
- 空响应及取消不会作为成功译文接受。
- 控制器请求、工具 schema/结果和输出预留纳入预算；大工具结果在下一次模型调用前被拒绝，不静默丢弃源文。

本地 HTTP 服务只监听 127.0.0.1，使用生成的虚拟密钥。没有调用真实 LLM，没有读取用户配置。Windows Node 24.15.0 下验证通过；根 typecheck/build 和 66 项相关精翻回归通过。

## 范围与遗留项

- 只验证 openai-compatible 主控、关闭思考、明确的上下文上限。Anthropic、Google、Ollama、思考参数、组织头、特殊兼容参数及真实提供商行为仍需后续验证。
- 使用新的受限验证工具包装现有领域函数，不证明现有 AI SDK ToolSet 可以原样转换；审批策略和所有生产工具仍需逐项适配。
- 预算及脱敏包装仅为实验。正式实现必须沿用模型实际路由、覆盖所有请求和日志出口，并保留审核与版本约束。
- SDK 最低 Node 22.19.0 与根 engines >=20 有差异；顶层 MIT 和传递许可声明已核查。Windows 启动及 Linux Node 22 SDK smoke 已通过，完整生产 Dockerfile 重建另行跟踪，不能以本项验收替代部署验收。

本项完成的是接入可行性与边界验证，不是 Agent 模式生产实现。
