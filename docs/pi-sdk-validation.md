# Pi SDK 验证记录

验证日期：2026-10-22。范围对应 ROADMAP 中 Pi SDK 安装部署、模型与领域工具、技能与恢复、运行时选型四项任务。本记录区分 SDK 能力验证与生产功能实现；没有把 Agent 模式接入生产服务，也没有修改根依赖或现有任务数据。

## 验证对象与环境

- 候选：`@earendil-works/pi-coding-agent`、`pi-agent-core`、`pi-ai` 均锁定 **1.4.0**，发布命名空间为 `@earendil-works`。旧命名空间 `@mariozechner/pi-coding-agent` 的 registry 版本为 0.73.1，本次没有安装或验证旧版本。
- 独立实验包：`scripts/experiments/pi-sdk/`，具有自己的 package.json、package-lock.json、严格 TypeScript 配置。不会随根 `npm ci` 安装，不属于生产依赖。
- Windows：Node **24.15.0** / npm **11.12.1**；SDK smoke、应用同进程启动及 `/api/health` 200 已通过。
- Linux：通过 Podman 构建 Dockerfile，在 `node:22-bookworm-slim` / Node **22.23.4** 中安装生产依赖、创建无内置工具的会话并完成假模型响应，已通过。Podman 使用已有 WSL machine，不挂载项目 `.data` 或真实配置。
- 根项目：`npm run typecheck`、`npm run build` 通过；66 项精翻、Index、修订和预算回归通过。Vite 仍提示现有的大 chunk 与混合动态/静态导入警告。
- 原始生产 Dockerfile 的完整重建及携带 SDK 的应用容器健康检查：**仍在验证，不能用上述独立 Linux smoke 替代**。

## 安装、许可与模块兼容性

SDK 顶层许可证为 MIT；lockfile 声明的传递依赖许可证包含 MIT、Apache-2.0、BSD-3-Clause、ISC、BlueOak-1.0.0、0BSD、Unlicense。这里是依赖声明核查，不是完整的发行合规审计。生产安装仍携带 TUI、MCP、codemode、QuickJS/WASM 等依赖；关闭相应功能不会自动减少安装包。

Pi 1.4.0 和其 `undici` 依赖要求 **Node >=22.19.0**。项目根 engines 仍为 >=20，因此不能把它无条件加入根 dependencies 后继续声称支持全部 Node 20 环境。Node 22 的 Docker 路线兼容；未来正式接入需明确提高运行要求或做独立运行进程的兼容设计。本次没有改变项目运行要求。

Pi 是 ESM，当前服务端是 NodeNext 配置下的 CommonJS 输出。实验中的 ESM 文件直接命名导入项目 TS 模块会失败；实验使用 `createRequire` 配合 tsx 读取现有 CommonJS 模块。生产 CommonJS 主程序应通过动态 `import()` 进入 ESM 适配模块，或使用独立 ESM worker；不能据此要求整个项目迁移模块格式。

## 模型与工具验证

`integration.test.ts` 启动仅监听回环地址的 OpenAI 协议模拟服务，实际运行 Pi 的 OpenAI transport，并由 Pi 调用受任务绑定的领域工具：

1. 通过现有 `resolveCapabilityRoute` 解析构造的系统偏好，注册主控模型，凭据仅放入内存。
2. 读取真实 `RefinedTranslationService` 的任务快照。
3. 调用现有 `buildIndexTranslatePrompt` 和 `generateRefinedTranslationText`；AI SDK 也请求本地模拟 API。
4. 通过现有服务写入内存 SQLite，检查另一个任务未变化、源文未回写、任务未擅自标记完成。

已验证：单 user Index 模板、完整源语言名称、模板思考关闭、真实响应 token 用量传递；非法参数与任务 ID 注入在执行前被拒绝；工具错误、HTTP 401、空译文和取消可观察；上下文包含工具及结果，下一步请求和压缩请求同样经过预算保护。

实验主控映射目前只覆盖 **openai-compatible、关闭思考、明确配置上下文上限**。Anthropic、Google、Ollama、主控思考参数、组织头和各家特殊协议尚未验证。上下文值 0 在项目内表示不做本地限制，不能直接当作 Pi 已知的远端窗口；实验对此拒绝启动，正式适配需另外确定策略。

Pi 不认识本项目的凭据清单，也不自动沿用 `redactSecrets`。实验在模型事件进入会话存储前脱敏，领域工具异常另行脱敏，验证模拟密钥不会进入持久化错误。未来还需覆盖所有工具结果、扩展输出、请求日志和审批路径，不可直接复制未包装的 SDK 工具集合。

预算适配是验证用途：使用共享 UTF-8 保守估算，连同实际输出预留检查请求并拒绝超限，没有静默裁掉必要材料。它不实现生产级压缩决策或所有提供商的思考 token 会计。用量可读取，但自定义模型价格暂设 0，因此费用统计不作为已验证能力。

## 技能、会话与故障矩阵

| 场景 | 实测结果 | 应用仍需承担的责任 |
|---|---|---|
| 指定技能及 `/skill:` 调用 | 选定技能可加载，项目 AGENTS.md 和未选技能不进入上下文 | 管理技能来源、启用项与版本 |
| 自主发现技能及参考资料 | 受限的同名 `read` 可替换内置 reader，模型看到技能目录并读取白名单资料；其他文件被拒绝 | 维护快照文件清单、路径校验及内容大小限制 |
| 关闭所有文件工具 | 显式技能命令仍可用，但默认系统提示词不会展示技能目录 | 提供受限 reader 或自行注入技能目录，不能只设 `noTools` |
| 工具执行期间追加指令 | 当前工具完成后，下一模型请求收到新指令 | UI 区分已接收与已生效，限制危险在途操作 |
| 在途工具取消 | AbortSignal 到达工具，检查信号后不产生晚到写入 | 所有写操作在落盘前检查取消及材料版本 |
| 完成操作拦截 | 扩展的 tool_call hook 能在缺少审核证据时阻止工具执行 | 审核证据校验和完成条件仍需由领域服务实现，不能只依赖提示词 |
| 会话重新打开 | 原始目标、对话与自定义 checkpoint 可读取；新会话不自动混入另一会话历史 | 根据 taskId 绑定会话，校验所有权；不能接受任意 session 文件路径 |
| 原生压缩并重新打开 | 假模型摘要保留待办，重新注入的系统约束仍存在 | 摘要由模型生成，不保证语义完整；硬约束、技能版本、待办与业务事实需独立持久化 |
| 取消压缩 | 不追加未完成摘要，保留原记录 | 明确恢复和重试策略 |
| 压缩请求超预算 | 在 provider 调用前拒绝，不落盘失败摘要 | 规划分批或人工处理，不把超预算当可无限重试错误 |
| 工具写入前进程退出 | 会话保留调用记录，业务结果尚不存在 | 识别未执行操作，允许安全重试 |
| 业务写入后、工具结果保存前进程退出 | 业务结果存在，但会话没有工具结果 | **阻塞项：事务内幂等记录、operationId 与业务状态核对** |
| 压缩中进程退出 | 恢复后原会话仍在，没有半份压缩记录 | 从可靠 checkpoint 重建上下文 |

进程退出测试启动真实子进程并在指定位置直接退出。写入窗口以独立临时 JSON 文件模拟外部持久化副作用，**不是生产 SQLite 的跨事务恢复测试**；精翻业务集成测试使用内存 SQLite。该测试证明会话恢复无法消除外部副作用的结果不确定窗口，未声称已实现业务恰好一次执行。

技能版本 1 与当前任务约束由实验调用方明确注入，Pi 不会替应用冻结技能文件。假模型摘要测试证明压缩与恢复机制可用，不能证明真实 LLM 在长小说上始终保留全部要求。

## 复现

在仓库根目录执行（根依赖需已安装）：

```powershell
npm ci --prefix scripts/experiments/pi-sdk
npm run typecheck --prefix scripts/experiments/pi-sdk
npm test --prefix scripts/experiments/pi-sdk
npm run build
npm run smoke --prefix scripts/experiments/pi-sdk -- --server-entry ../../../dist/server/index.js
npx tsx --test src/server/core/refined-translation.test.ts src/server/core/refined-translation-index.test.ts src/server/core/refined-revision.test.ts src/server/core/llm-context-budget.test.ts
```

容器验证使用新镜像，不复用正在运行的服务或宿主机数据。以下命令中的 `podman` 可在有 Docker 的环境替换为 `docker`，但 Docker 的忽略文件配置需按其构建上下文规则处理；`--ignorefile` 是本次 Podman 命令。

```powershell
podman build --ignorefile scripts/experiments/pi-sdk/container.ignore -f Dockerfile -t localhost/ts-novel-spider:pi-validation-base .
podman build --ignorefile scripts/experiments/pi-sdk/container.ignore -f scripts/experiments/pi-sdk/Dockerfile -t localhost/ts-novel-spider:pi-sdk-validation .
podman run --rm localhost/ts-novel-spider:pi-sdk-validation node /app/pi-validation/smoke.mjs --server-entry /app/dist/server/index.js
```

仅验证 SDK 的 Linux 安装与会话启动，可单独执行：

```powershell
podman build --ignorefile scripts/experiments/pi-sdk/container.ignore --build-arg NOVEL_IMAGE=docker.io/library/node:22-bookworm-slim -f scripts/experiments/pi-sdk/Dockerfile -t localhost/novel-pi-sdk:node22-validation .
```

所有测试仅使用生成的虚拟凭据、回环 HTTP 模拟服务和 Pi faux provider；没有调用真实 LLM，没有读取用户 `.data/system-preferences.json`。根依赖与浏览器扩展未变。实验测试不会由根 `npm test` 自动覆盖，必须执行上面的独立命令。

## 选型评估（暂定）

| 方案 | 本次证据 | 主要成本 |
|---|---|---|
| Pi 会话 SDK 1.4.0 | 已验证技能、模型工具调用、指令插入、取消、压缩与会话文件恢复 | ESM、Node 版本、模型配置适配、额外依赖与业务恢复 |
| Pi Agent Core | 已安装为 SDK 依赖；没有独立开发或基准比较 | 若单独使用，技能与长期会话能力需要另外组合 |
| 现有 AI SDK | 项目现有精翻及 66 项回归通过 | 技能加载、会话管理、压缩、追加指令与持久恢复需自行完善 |

技术上优先保留 **Pi 会话 SDK 1.4.0 + 薄适配模块 + 现有精翻领域操作**，本次无需 fork Pi 核心。建议固定精确版本及 lockfile，升级时重跑这套协议、技能和故障测试。正式采用仍以完整生产容器验证和 Node 支持策略明确为前提，不把初步匹配结论当成生产上线许可。

第一版仍限定单主控 Agent、领域工具及可配置技能；多 Agent、任意脚本、第三方技能安装和模式切换不在范围内。后续生产接入必须补事务幂等、材料版本、任务与会话所有权、技能快照、运行预算及审核完成条件；这些属于后续 ROADMAP 任务，不能因为 SDK 测试通过而勾选。

依据：安装的 1.4.0 package.json、lockfile、类型声明及运行源码优先；在线参考为 [SDK 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[Agent Core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)、[扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。在线 main 会继续变化，不能代替锁定包的实测结果。
