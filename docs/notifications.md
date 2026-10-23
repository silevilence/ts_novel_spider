# 消息通知

## 使用

在「全局设置 → 消息通知」填写 AstrBot 实例根地址、API Key 与单个目标 UMO。默认关闭通知总开关、错误通知和每本书的更新提醒。保存配置不会发送消息；「发送测试通知」使用当前表单，可在总开关关闭时测试，也不会自动保存配置。

API Key 的操作分为保留、更换和清除，设置读取只返回 `keyConfigured`。密钥沿用现有系统偏好存储方式，保存在后端 `.data/system-preferences.json`，浏览器不读取已存密钥，也不直接请求 AstrBot。

发送需要 `im` scope。查询已知会话另需 `data` scope；只有 `im` scope 时，可以直接手写目标。UMO 使用 `平台:消息类型:会话标识` 格式，候选列表是已知会话，不代表所有可发送目标，也不保证可达。输入可按 UMO、返回的名称或平台搜索。更换地址/凭据会使旧候选失效，刷新不会清空已填目标。

在「定时更新 → 书单管理」为开启更新检查的小说勾选「更新时通知」，再保存书单。使用全局渠道与目标，不为每本书配置收件人。停止该书更新检查后不会再生成更新提醒，重新开启及回收站还原均保留原有开关。

## 事件与投递规则

- 业务通过 `NotificationService.submit(event)` 提交通用事件，渠道只实现单次 `NotificationChannel.send`。业务不接触 HTTP 发送协议。
- 事件先写 SQLite `notification_deliveries`，后端队列串行异步发送，不依赖前端连接。事件 ID 全局唯一且跨重启去重；终态重复提交不重新入队，即使改变接收目标也不会补发旧事件。
- 更新检查错误按小说与轮次汇总；采集失败按任务终态汇总。单章重试不逐条通知，重试后成功与用户主动取消不告警。
- 新章节更新提醒在本轮下载结束后提交，包含发现数、成功下载数、失败数与时间；无新章节不发。不等待自动翻译或总结完成。
- 同一次定时下载只提交一个结果事件：该书更新提醒和全局错误告警任一满足即投递，二者均满足也只投递一次。关闭该书更新提醒不关闭错误告警。
- 单次渠道尝试上限 15 秒，最多 3 次；仅明确可重试的接口不可用/限流失败重试，间隔 1 秒、2 秒。鉴权、参数、业务拒绝不重试。UMO 查询超时 10 秒。
- 发送超时、消息 POST 的网络异常/5xx、无法解析的成功响应均记为 `unknown`，不自动重发，不切换路径尝试。不能承诺远端恰好投递一次。
- 发送前重新核对通知开关和连接/目标。已关闭或变化时，待发送事件记为跳过；显式测试采用测试时的表单快照。在途请求不能撤回。
- 服务中断时，等待发送的记录记为未投递失败，发送中的记录记为结果不确定，不在重启后自动补发。
- 通知异常只记录本地结果/日志，不能触发新的通知。消息正文、记录、错误日志均脱敏；不透传远端错误正文。正常业务结果不受发送失败影响。

## AstrBot 兼容策略

依据 [HTTP API 介绍](https://docs.astrbot.app/dev/openapi.html)、[在线完整定义](https://docs.astrbot.app/openapi.json)、[Scope 对照](https://docs.astrbot.app/dev/openapi-scopes.html) 和官方实现 [消息路由](https://github.com/AstrBotDevs/AstrBot/blob/master/astrbot/dashboard/api/open_api.py)、[会话服务](https://github.com/AstrBotDevs/AstrBot/blob/master/astrbot/dashboard/services/session_management_service.py) 核对，日期为 2026-10-23。

介绍页说明 HTTP API 自 AstrBot v4.18.0 起提供；本次查阅的在线 OpenAPI `info.version` 为 `0.1.0`，它是接口契约版本，不是部署程序版本。实现按实例能力检测，不宣称所有 v4.18.0+ 部署均已实测兼容。

每次投递前，后端读取实例 `/api/v1/openapi.json`。优先使用其中声明的 `POST /api/v1/im/messages`，仅当实例声明单数路径时使用 `/api/v1/im/message`。缺少可识别定义时报告配置错误，不猜路径。一次 POST 失败后绝不切换到另一路径重发。发送记录保存所用路径及实例声明的接口契约版本。

鉴权为 `Authorization: Bearer <API Key>`，请求体为 `{ umo, message }`，`message` 为纯文本。HTTP 成功且响应 `status === 'ok'` 只表示接口接受请求；UI 明确要求用户在接收端确认。已知会话读取 `GET /api/v1/sessions/active-umos` 的 `data.umos` 和可选 `data.umo_infos`；当前列表本地搜索，不需要分页调用 `/api/v1/sessions`。禁止用机器人标识列表替代 UMO。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET / PUT | `/api/control/preferences/notifications` | 读取/保存通知设置，读取不返回密钥 |
| POST | `/api/control/notifications/test` | 显式发送测试，返回最终记录 |
| POST | `/api/control/notifications/targets` | 后端查询当前连接配置的已知 UMO |
| GET | `/api/control/notifications/records` | 最近 100 条发送记录 |
| GET / PUT | `/api/library/novels/:sourceId/:novelId/scheduling` | 单书 `notifyOnUpdate` |
| GET / PUT | `/api/library/scheduling/novels` | 书单批量读取/保存 `notifyOnUpdate` |

设置写入、查询与测试使用同一共享契约：`enabled`、`errorEnabled`、`channel: 'astrbot'`、`baseUrl`、`target: { umo }`、`keyAction: 'keep' | 'replace' | 'clear'` 和可选新 `apiKey`。渠道与目标分别建模，首版仅单选。

## 本地验收与实机边界

本地验收使用模拟 HTTP、模拟渠道、Mock Spider、内存 SQLite，以及迁移/保存重载专用临时数据库和偏好文件，不调用真实 LLM 或 AstrBot。

| 验证范围 | 结果 |
| --- | --- |
| 正常、禁用、去重、有限重试、超时、异常隔离、脱敏、中断记录 | 通过 |
| 两种实例声明路径、鉴权、载荷、业务失败、未知响应、禁止路径切换 | 通过 |
| 偏好迁移、密钥保留/替换/清除、设置和发送记录 API | 通过 |
| UMO 查询、空结果、缺少权限、接口不可用、手写、搜索选择、地址/凭据竞态 | 通过 |
| 更新检查失败、采集全/部分失败、成功重试、取消、开关组合、重复终态 | 通过 |
| 按书开关迁移、保存重载、回收站还原、无更新及下载成功/部分/全部失败 | 通过 |
| Windows 本地测试、类型检查、前后端生产构建 | 通过 |
| 隔离内存服务的窄屏设置页与书单入口 | 已检查 |
| 真实 AstrBot 部署版本、实际目标接收结果 | 待验证；用户选择本轮仅做本地验收 |

实机联调时，另外记录部署版本、实例 OpenAPI 版本/路径、权限、测试时间和接收端结果；报告不得记录 API Key。本轮未发送真实外部通知。
