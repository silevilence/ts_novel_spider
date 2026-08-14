# syosetu.org: parse-only adapter, production transport via browser bridge or proxy

syosetu.org 是独立于 HinaProject syosetu.com 系（syosetu / syosetu18）的小说浏览站。其全部页面（含首页）位于 Cloudflare 之后：对部署网络直接返回 HTTP 403（IP 级封锁，带浏览器 UA 亦无法通过，本机实测首页与三个示例作品页均被拦）。因此 SyosetuOrg 适配器只做解析、不做任何访问绕过（无验证码/挑战处理、无代理内置）；取数一律经 `SpiderHtmlFetcher` 接缝注入传输实现。生产传输路径为：用户授权的浏览器桥接（浏览器传输采集），或 Cloudflare 放行的网络代理。

本适配器任务与「浏览器插件采集桥接」任务联合交付：桥接任务新增注册表 browser-transport 能力标记，并以 syosetu.org 三本示例书（353455 / 391203 / 286002）的端到端采集作为验收载体；适配器声明该能力并消费桥接传输。两任务互为依赖、协同验收。

## Considered Options

- **内置 Cloudflare 绕过** — rejected：违反 ADR-0001 传输层隔离原则；绕过手段脆弱易失效，且有合规风险。
- **仅直连取数（defaultFetchHtml）** — rejected：部署网络被 403，生产不可用。
- **解析器 + 桥接/代理传输（chosen）** — 与既有 ADR-0001/0002 架构一致，站点接入点仍是服务端适配器。

## Consequences

- syosetu-org 的端到端可用性取决于 Cloudflare 放行的传输；解析测试 fixture 驱动、不依赖网络。
- 新增站点仍按「服务端适配器 + 传输接缝」模型接入（ADR-0001 的站点扩展点）。
- 桥接任务验收标准以 syosetu.org 采集为准，适配器与桥接两任务互为依赖。
