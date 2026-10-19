# Scale Commander

**Amazon PPC autopilot for DeepSeek Harness** — a native dual-half plugin that turns your advertising strategy into audited automation.

**亚马逊 PPC 自动化插件，为 DeepSeek Harness 而生** —— 原生双端插件，把你的广告策略变成可审计的自动化。

---

[English](#english) · [中文](#中文)

---

## English

Scale Commander is a production-grade DeepSeek Harness plugin for Amazon
advertising. It implements the full operational surface a seller expects from a
dedicated PPC tool: eleven stackable algorithms, reusable criteria profiles,
dayparting with hourly bid modifiers, negative and whitelist management, keyword
harvesting, a mass campaign builder, budget and placement rules, sales
attribution, and a **preview → apply → rollback** pipeline that records every
change it makes.

It talks to the real Amazon Advertising API, and ships a sandbox provider that
generates a realistic account locally — so every workflow can be exercised and
verified without credentials.

### Why it exists

A PPC automation tool has one requirement ordinary software does not: **the plan
a person reviews must be exactly the plan that executes.** Scale Commander
enforces this by computing previews and applied plans with the same pure
evaluation pass. A preview cannot drift from execution, and the audit trail
never shows an action the reviewer did not see.

### The eleven algorithms

Every algorithm is a pure function over already-aggregated metrics, and each
proposed action carries the step-by-step arithmetic behind it.

| Algorithm | What it does |
|---|---|
| **Bidding** | Moves keyword and product-target bids toward a target ACOS, one capped step at a time, using the documented optimum-bid formulas. |
| **Dayparting** | Turns ad groups on or off by hour and applies hourly percentage bid modifiers; an optimum-hours mode derives the plan from observed performance. |
| **Import** | Harvests converting search terms into new keywords or product targets, priced as a percentage of their average CPC. |
| **Negative** | Negates search terms that meet the criteria, as negative exact or phrase. |
| **Negative word** | Splits search terms into single words, aggregates them, and negates non-performing words as phrase. |
| **Blacklist / whitelist** | Forces a maintained list to negatives, and protects whitelisted terms from the negative algorithms. |
| **Revive** | Raises bids on dead keywords that used to perform, until traffic returns. |
| **Default bid** | Optimises an ad group default bid for legacy auto campaigns. |
| **Status** | Pauses or enables campaigns and ad groups on criteria. |
| **Daily budget** | Applies a baseline, a day-of-week multiplier, then each matching criterion in sequence. |
| **Placement** | Adjusts top-of-search, product-page and rest-of-search modifiers toward a target, one increment per run. |

Stackable rules run in priority order. Mutually exclusive kinds (dayparting,
blacklist, default bid, daily budget) keep one rule per ad, and a directly
assigned rule overrides an inherited one of the same kind.

### Safety model

1. **Preview writes nothing.** Every action shows its before → after values and
   the maths behind it.
2. **Applying requires `confirm: true`** — enforced identically in the UI and in
   the agent tools, so an assistant cannot apply a plan you have not approved.
3. **Every applied action is recorded** with the exact Amazon request body.
4. **Rollback restores before values, newest first**, and is itself audited.
5. **Sandbox accounts never touch Amazon.**

### Install

**From the DSH Plugin Marketplace (recommended).** The repository carries the
`dsh-plugin` topic, so it is indexed automatically and appears in the
marketplace's Discover tab:

```
Settings → Plugins → Discover → search "Scale Commander" → Install
```

The marketplace clones the repository, runs `npm run build` inside `package/`
(the build needs no installed dependency — esbuild is invoked as a binary), and
registers the bundle patch. Restart DeepSeek Harness afterwards.

**From a local checkout**, with the plugin manager tool:

```sh
plugin_manager action=install_bundle target=<absolute path>/package
```

Configuration lives in the bundle row. The package name is now
`dsh-scale-commander` (unscoped, so it cannot collide on npm):

```yaml
- insert:
    - id: scale-commander
      name: 'dsh-scale-commander'
      config:
        dataDir: ''              # defaults to <DSH_HOME>/scale-commander
        schedulerEnabled: true
        schedulerTickSeconds: 60
        requestTimeoutMs: 45000
```

Requires Node 22.5+ for `node:sqlite`. No native modules, no install scripts.

> **After installing, restart DeepSeek Harness.** The browser half is loaded by
> the `clientModules` service, which caches its per-package scan for the life of
> the process; a freshly installed package is only picked up at the next start.
> The Host half — engine, scheduler, HTTP API, agent tools, database — is live
> immediately.

### Privacy

This plugin sends advertising data to Amazon, because that is what it automates.
It contacts nothing else. The endpoints and credential handling are declared in
`package.json` under `disclosure`, so the marketplace card shows them before you
install:

| | |
|---|---|
| Network | `advertising-api.amazon.com` and its EU/FE mirrors, plus `api.amazon.com/auth/o2/token` for the token exchange |
| Offline mode | Yes — a sandbox account generates its data locally and contacts nothing |
| Credentials | Amazon LWA client id, client secret, refresh token; AES-256-GCM encrypted at rest in a `0600` file, mirrored into the Harness credential service when mounted, never returned to the browser, never logged |
| Data at rest | SQLite plus the encrypted sidecar, both inside the plugin data directory |
| Retention | Local only; nothing is sent to a third-party server |

### Quick start

1. **Accounts → Add account → Sandbox.** No credentials; it generates ~120 days
   of realistic campaigns, keywords, targets, search terms and hourly data.
2. **Sync**, then create a **strategic objective** from a preset (Bulk Auto,
   Sales Exact, Ranking Exact…) and assign it to a few campaigns.
3. Open **Preview** — every action with its arithmetic — then **Apply**.
4. Watch the **Change log**, and roll a run back to see the before values return.

To connect a real account: create a Login with Amazon application, authorize it
for your advertising profile, then paste the client id, client secret and
refresh token into the Credentials dialog. They are AES-256-GCM encrypted at
rest and never returned to the browser.

### Agent tools

Twelve tools are registered, so an assistant in the same profile can work the
account conversationally — `scale_commander_accounts`, `_overview`, `_preview`,
`_apply`, `_rollback`, `_runs`, `_rules`, `_create_rule`, `_assign`,
`_insights`, `_audit`, `_sync`. Every tool calls the same service method the
browser calls.

### Develop

```sh
node scripts/build.mjs   # bundle both halves
node scripts/test.mjs    # 62 assertions in 3 suites + 22 end-to-end checks
```

### Documentation

- [User Guide](docs/USER-GUIDE.md) — a walkthrough of all 14 screens
- [Architecture](docs/ARCHITECTURE.md) — the design decisions and why
- [Acceptance](docs/ACCEPTANCE.md) — every requirement with the command that verifies it

### License

MIT

---

## 中文

Scale Commander 是一个生产级的 DeepSeek Harness 插件，用于亚马逊广告投放。它实现了专业 PPC 工具应有的完整操作面：11 种可叠加算法、可复用的条件档案、带小时竞价系数的分时策略、否词与白名单管理、关键词收割、批量广告创建、预算与广告位规则、销售归因，以及一套**预览 → 应用 → 回滚**流程，记录它做出的每一次改动。

它对接真实的 Amazon Advertising API，并附带一个沙箱提供器，在本地生成一个逼真的账户 —— 因此每条工作流都可以在没有凭证的情况下被完整演练和验证。

### 为什么做这个

PPC 自动化工具有一个普通软件没有的硬性要求：**给人审阅的计划，必须和执行的计划完全一致。** Scale Commander 用同一次纯函数评估 pass 同时计算预览计划和执行计划来保证这一点。预览不会与执行产生偏差，审计流水里也永远不会出现审阅者没看过的操作。

### 11 种算法

每种算法都是作用于已聚合指标的纯函数，每个建议操作都附带一步步的计算过程。

| 算法 | 作用 |
|---|---|
| **Bidding 竞价** | 按文档所述的最优出价公式，以受控步长把关键词和商品投放出价推向目标 ACOS。 |
| **Dayparting 分时** | 按小时开关广告组，并按小时应用竞价系数；"最优时段"模式从实际小时表现推导计划。 |
| **Import 收割** | 把有转化的搜索词导入为新关键词或商品投放，初始出价取其平均 CPC 的百分比。 |
| **Negative 否词** | 把满足条件的搜索词加为否定精准或否定词组。 |
| **Negative word 否词-词根** | 把搜索词拆成单词、聚合表现，把无效单词加为否定词组。 |
| **Blacklist / whitelist 黑/白名单** | 把维护的无关词列表强制转为否定，并保护白名单词不被否定。 |
| **Revive 复活** | 对曾经有效、现在没有流量的"死词"提价，直到流量恢复。 |
| **Default bid 默认出价** | 为传统自动广告优化广告组默认出价。 |
| **Status 状态** | 按表现暂停或启用广告活动和广告组。 |
| **Daily budget 日预算** | 先乘基线，再乘星期系数，然后依次应用每个满足的条件。 |
| **Placement 广告位** | 把搜索顶部、商品页、搜索其他的修饰符推向目标，每次运行只走一档增量。 |

可叠加算法按优先级依次执行；互斥类型（分时、黑白名单、默认出价、日预算）每个广告只保留一条规则，直接指派的规则会覆盖继承来的同类型规则。

### 安全模型

1. **预览不写任何数据。** 每个操作都展示改动前后的值和背后的计算。
2. **应用必须传 `confirm: true`** —— UI 和智能体工具执行同一条规则，所以助手无法应用你没批准的计划。
3. **每个已应用的操作都被记录**，连同发给 Amazon 的确切请求体。
4. **回滚从最新开始恢复改动前的值**，并且回滚本身也进审计。
5. **沙箱账户绝不触碰 Amazon。**

### 安装

**从 DSH 插件市场安装（推荐）。** 仓库已打上 `dsh-plugin` topic，会被市场自动收录，出现在 Discover 标签页里：

```
Settings → Plugins → Discover → 搜索 "Scale Commander" → Install
```

市场会克隆仓库、在 `package/` 内执行 `npm run build`（构建不依赖任何已安装包 —— esbuild 以二进制方式调用），然后注册 bundle patch。之后重启 DeepSeek Harness。

**从本地检出安装**，用插件管理器工具：

```sh
plugin_manager action=install_bundle target=<绝对路径>/package
```

配置写在 bundle 行里。包名已改为 `dsh-scale-commander`（不带 scope，避免 npm 撞名）：

```yaml
- insert:
    - id: scale-commander
      name: 'dsh-scale-commander'
      config:
        dataDir: ''              # 默认 <DSH_HOME>/scale-commander
        schedulerEnabled: true
        schedulerTickSeconds: 60
        requestTimeoutMs: 45000
```

需要 Node 22.5+（使用内置 `node:sqlite`）。无原生模块，无安装脚本。

> **安装后请重启 DeepSeek Harness。** 浏览器端由 `clientModules` 服务加载，它把每个包的扫描结果缓存到进程生命周期；新装的包要到下次启动才会被发现。而 Host 端 —— 引擎、调度器、HTTP API、智能体工具、数据库 —— 立即生效。

### 隐私

这个插件会把广告数据发到 Amazon，因为它自动化的就是这件事。除此之外它不联系任何端点。网络端点和凭据处理方式都声明在 `package.json` 的 `disclosure` 字段里，安装前就能在市场卡片上看到：

| | |
|---|---|
| 网络 | `advertising-api.amazon.com` 及其 EU/FE 镜像，加 `api.amazon.com/auth/o2/token` 用于令牌交换 |
| 离线模式 | 支持 —— 沙箱账户本地生成数据，不联系任何端点 |
| 凭据 | Amazon LWA 的 client id、client secret、refresh token；以 AES-256-GCM 加密存放在 `0600` 文件里，同时镜像到 Harness 凭据服务（若已挂载），永不返回浏览器，永不写日志 |
| 落地数据 | SQLite 加加密边车文件，都在插件数据目录内 |
| 保留策略 | 仅本地；不上传任何第三方服务器 |

### 快速上手

1. **Accounts → Add account → Sandbox。** 不需要凭证，它会生成约 120 天的真实广告活动、关键词、投放、搜索词和小时数据。
2. **Sync**，然后从一个预设创建**战略目标**（Bulk Auto、Sales Exact、Ranking Exact……），指派给几个广告活动。
3. 打开 **Preview** —— 每个操作连计算过程一起看 —— 然后 **Apply**。
4. 看 **Change log**，回滚一次运行，看改动前的值回来。

接入真实账户：创建一个 Login with Amazon 应用，为你的广告 profile 授权，然后把 client id、client secret、refresh token 粘进 Credentials 对话框。它们以 AES-256-GCM 加密存储，永不返回浏览器。

### 智能体工具

注册了 12 个工具，同一 profile 里的助手可以对话式地操作账户 —— `scale_commander_accounts`、`_overview`、`_preview`、`_apply`、`_rollback`、`_runs`、`_rules`、`_create_rule`、`_assign`、`_insights`、`_audit`、`_sync`。每个工具调用的都是浏览器调用的同一个服务方法。

### 开发

```sh
node scripts/build.mjs   # 打包双端
node scripts/test.mjs    # 3 个套件 62 条断言 + 22 项端到端检查
```

### 文档

- [用户指南](docs/USER-GUIDE.md) —— 14 个界面逐一走查
- [架构](docs/ARCHITECTURE.md) —— 设计决策及理由
- [验收](docs/ACCEPTANCE.md) —— 每项需求配一条可复现的验证命令

### 许可

MIT
