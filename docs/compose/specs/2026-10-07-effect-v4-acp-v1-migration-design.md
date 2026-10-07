# 立项设计：effect 4.0.0-beta.83 → 4.0.1 与 ACP SDK 0.21 → 1.7 迁移

日期：2026-10-07
状态：设计已获谷总批准（分批推进 effect；effect 与 ACP 均落本文档待办）

## 一、背景

2026-10-07 的依赖盘点（129 项，0 查询失败）发现两条此前被 `AGENTS.md` 豁免的依赖现已越过升级门槛：

- **effect**：`4.0.0-beta.83` 的锁定理由写的是「beta 不稳定」，但 effect v4 已转正（dist-tags `latest=4.0.1`，另有 `rc=4.0.0-rc.118`）。**锁定的前提已失效。**
- **ACP SDK**：0.21.0 → 1.7.0 跨越 1.0 大版本。

同批盘点中其余 16（T1）+ 13（T3 AI SDK）+ 20（T4 major）个依赖已完成升级并推送，见 §五。

## 二、实测基线（本文档的决策依据）

以下数字为 2026-10-07 在本仓库实测所得，非估算：

### effect 4.0.0-beta.83 → 4.0.1

**2058 个类型错误，涉及 461 个文件**（全仓 1620 个源文件的 28%）。

| 破坏性变更 | 错误码 | 数量 | 影响面 |
|---|---|---|---|
| `Schema.TaggedErrorClass` 被移除 | TS2551 / TS2339 | 180 | **48 个文件、181 处**——每个自定义错误类型 |
| `effect/unstable/*` 全部重组 | TS2307 | 212 | **93 个文件、210 处**——httpapi/http/process/sql/socket/encoding |
| 可迭代 Effect 被移除 | TS2488 | 206 | `for (const x of effect)` 写法全部失效 |
| 构造签名收紧 | TS2554 | 381 | `Expected 0 arguments, but got 1` |
| 其余类型不匹配 | 混合 | 1079 | — |

失效的 effect 子模块清单（由实测错误反查）：

```
effect/unstable/httpapi        92      effect/unstable/encoding/Sse        4
effect/unstable/http          60      effect/unstable/reactivity/…        2
effect/unstable/process        16      effect/unstable/sql/…              16（分 5 个文件）
effect/unstable/socket/…        6      effect/unstable/observability       2
effect/unstable/process/Child…  7      effect/unstable/http/…              4
```

**结论：这不是依赖升级，是框架迁移。** 2058 个错误里没有一组是机械替换能收的——`TaggedErrorClass` 需要重写全部错误类型定义，可迭代 Effect 的移除需要改写全部消费 effect 的循环，`unstable/*` 搬家需要逐处重新映射导入。

### ACP SDK 0.21.0 → 1.7.0

**协议重构，不是改名。** 类型层错误看似只是 `SetSessionModelRequest` → `SetSessionModeRequest`，但实测 SDK 1.x 的导出面显示：

- 方法名 `session/set_model` → `session/set_mode`
- 新增整套 provider 与配置层：`SetProviderRequest/Response`、`ListProvidersRequest/Response`、`SetSessionConfigOptionRequest/Response`、`SessionConfigOption`、`SessionModeState`、`CurrentModeUpdate`
- `PromptRequest` 移除 `messageId`（另有独立 `MessageId` 类型）
- `McpServer` 联合新增 `McpServerStdio`、`McpServerAcpId`，`url`/`headers` 不再位于联合顶层

盲改名能过编译但会发错协议，比不升更糟。**且本仓库无 ACP 对端可验证**——没有真实 peer 跑一轮，任何改动都无法证伪。

## 三、范围

### 在范围内

| 项 | 内容 |
|---|---|
| effect | `effect` + `@effect/{platform-node,sql-sqlite-bun,opentelemetry}` 四包同升 |
| ACP | `@agentclientprotocol/sdk` 0.21.0 → 1.7.0 |

### 不在范围内

- `drizzle-orm`：保持 `1.0.0-rc.2`。稳定版是 0.45.3，rc.5 是预发布，当前 rc.2 **本就领先于稳定线**
- `koffi` 3.1.6 → 3.3.2：`apply-opentui-ffi-patch.cjs` 适配层用了 8 个 koffi API（`load`/`proto`/`register`/`pointer`/`address`/`decode`/`array`/`unregister`），补丁注释已记录一处 koffi 与 node:ffi 的行为差异。当前版本无已知缺陷，原生库升级风险换零收益
- `@lydell/node-pty`：其 `latest` dist-tag 竟指向 `1.2.0-beta.15` 预发布；最新**稳定**版就是当前的 `1.1.0`，按 `latest` 盲升反而会降到 beta
- 承继内核 `src/{core,tui,llm,schema,protocol,codemode}`：**保持与上游逐字节一致**。本仓库已连续升级内核四次（1.18.26→32→34→35），任何为迁就依赖而改内核的做法都会持续抬高后续内核升级的合并成本

## 四、分批计划（effect）

每批的验收门槛一致，**四道全绿才允许进入下一批**：

```
bun run typecheck            # 错误数不高于该批开始时的基线
bun run test                 # 2079 pass / 9 skip / 0 fail
cd src/webapp && bun run typecheck
bun run test:web             # 14 文件 / 58 测试
```

### 批次划分（按依赖顺序，不按错误数）

| 批次 | 内容 | 规模 | 前置 |
|---|---|---|---|
| B0 | 建立基线：固定当前 2058 错误快照，按文件归类 | 无代码改动 | — |
| B1 | `Schema.TaggedErrorClass` 迁移 | 48 文件 / 181 处 | B0 |
| B2 | `effect/unstable/*` 导入重映射 | 93 文件 / 210 处 | B1 |
| B3 | 可迭代 Effect 移除（`TS2488`） | 206 处 | B1 |
| B4 | 构造签名收紧（`TS2554`） | 381 处 | B1、B3 |
| B5 | 残余类型不匹配收口 | 1079 处 | B2、B4 |

B1 是首批。`TaggedErrorClass` 之所以排第一：它是**自底向上**的——所有错误类型定义都依赖它，先解决它才能让后续批次的错误信息可读；反过来先改调用方，只会把错误淹没在级联里。

### 每批的产出要求

- 一批一个提交，`bun run typecheck` 走 pre-commit 门禁
- 提交信息写明：本批消除的错误码与数量、**未消除的部分及原因**、验收四道门的真实输出
- 任一批次出现「需要改动承继内核才能收口」的情况，**立即停止该批并上报**，不得顺手改内核

## 五、B1/B2 实测结果与批次模型修正（2026-10-07 下午）

### 批次模型的前提是错的

原 §四 假设「每批四道门全绿才进下一批」。**实测证明该前提不成立**：

B1（`TaggedErrorClass` 改名）单独做完，类型错误 2058 → 831（消除 60%），但 `bun run test` **失败**：110 fail / 101 errors，且 2088 个测试只跑出 1396 个——大量文件在加载期就崩。失败原因是 `Cannot find module 'effect/unstable/http'`（B2 的活）与 `Schema.isStartsWith is not a function`，**与 B1 无关**。

即：effect v4 的迁移在运行时是**原子的**。模块解析失败会让依赖它的测试文件整体无法加载，因此任何「只做了一半」的中间态都无法通过运行时验收。

**修正后的批次模型**：

- 分批只验收**类型错误数下降**这一项指标
- 运行时四道门只在**全部批次完成**后统一验收
- 中间态不得提交——`pre-commit` 的 typecheck 门禁本就会拦截（暂存区含 265 个错误的 TS 改动时直接拒绝提交），且 `AGENTS.md` 禁止 `--no-verify` 绕过。**这道防线是正确的，不应规避**
- 故 B1/B2 的产出以「可复现配方」形式记入本文档 §五.3，而非以提交形式落库

### B1：`Schema.TaggedErrorClass` → `Schema.TaggedError`

**性质：纯改名。** 已比对 `effect@4.0.1/dist/Schema.d.ts` 的声明，泛型签名与旧版逐字一致：

```ts
export declare const TaggedError: {
  <Self = never, Brand = {}>(identifier?: string): {
    <Tag extends string, const Fields extends Struct.Fields>(tag, fields, annotations?): ...
    <Tag extends string, S extends Struct<Struct.Fields>>(tag, schema, annotations?): ...
  }
}
```

规模：**62 个文件、180 处**。效果：2058 → 831。

配方（全仓 `src/**` 下 `.ts`/`.tsx`，跳过 `node_modules`，字符串替换，不含中文故无编码风险）：

```
"Schema.TaggedErrorClass"  ->  "Schema.TaggedError"
```

### B2：`effect/unstable/*` 导入重映射

v4 的 `exports` 从平铺改为按领域划分（28 项，含 `./http`、`./http-api`、`./process`、`./socket`、`./sql`、`./encoding`、`./reactivity`、`./observability` 等），不再有 `./Schema` 这类顶层命名空间入口。`dist/` 亦按同名目录重组。

模块仍以 `export * as X` 形式导出符号（如 `effect/http` 导出 `HttpClientError`、`FetchHttpClient`、`HttpServerResponse`），故只需改路径、不用改符号名。

规模：**158 个文件、203 处**（16 个不同路径）。效果：831 → **265**。

配方：

```
"effect/unstable/httpapi"  ->  "effect/http-api"
"effect/unstable/"         ->  "effect/"
```

### 累计

**2058 → 265，消除 87%；涉及文件 461 → 76。**

### 剩余 265 个错误的性质（已不是机械替换）

| 错误码 | 数量 | 性质 |
|---|---|---|
| TS2769 | 77 | `effect/http-api` 路由定义：`Struct<{directory?: string…}>` 不再满足 `QueryConstraint`；错误类型不再满足 `Top` 约束。**需逐端点重做** |
| TS2339 | 43 | socket API 变化（`Socket.runRaw` 移除）；部分收窄到 `never` 后的属性访问 |
| TS2345 | 37 | 参数类型不匹配 |
| TS2551 | 27 | 属性移除（`Schema.UnknownFromJsonString` → `fromJsonString` 等） |
| TS2322 | 21 | 类型不匹配 |
| TS2554 | 16 | 构造签名收紧 |
| TS2349 | 12 | 表达式不可调用（`proxy.ts`） |
| TS2741 | 3 | `SqliteConnection` 新增必需方法 `executeValuesUnprepared` |
| 其他 | 29 | — |

文件集中在 httpapi 与 pty：`groups/session.ts` 44、`middleware/proxy.ts` 20、`handlers/pty.ts` 15、`shared/handlers/pty.ts` 14、`handlers/mcp.ts` 12。

**结论：B3 之后的工作不再是替换，而是按 v4 新 API 逐端点、逐接口重做。** 需要先读懂 `effect/http-api` 的新路由定义模型，再动手。

### 迁移中踩到的两个坑（留给下一次）

1. **Node 遍历脚本里的 `return` 写错位置**：`for` 循环体内的 `return` 退出的是整个递归函数，而非当前迭代，导致遇到第一个不匹配的文件就静默停止遍历。第一次跑 B2 只改了 4 个文件（真实值 158），且脚本**没有报错**。修法：用 `if` 包裹而非 `return`。教训：批量改写脚本必须**事后校验残留计数**，不能信脚本自己打印的改动数。
2. **`git_diff` 工具会把整文件渲染出来**，看起来像行尾被整体改写；用 `git diff --numstat` 复核才是真实改动量（当时为 +23/-10）。本仓库 `core.autocrlf=true`，工作区 CRLF 与仓库 LF 并存属正常。

## 六、已完成部分（2026-10-07，随本文档一并归档）

| 提交 | 内容 |
|---|---|
| `905c70f` | T1：16 个依赖（patch/minor）+ webapp `USE_PROFILES` 的 `mathml`→`mathMl` 修复 |
| `cbfb8b8` | opencode 内核 1.18.34→1.18.35：xAI 非白名单图片格式导致整请求失败 |
| `1a3fc12` | T3：AI SDK 全家桶 v4（13 包），ACP 保留 0.21 |
| `daaf92e` | T4：20 个 major 逐包量化后升级，仅 `@actions/github` 一处源码适配 |
| 本文档 | 立项文档 |

其中三处判断值得留档：

- **内核 1.18.35 的修复落点与上游不同**。上游在 `toModelMessagesEffect` 的 attachments 处过滤，但上游 `supportsMediaInToolResult` 对 xAI 返回 `true`、媒体内联，那一行成立；本仓库该函数对 xAI 无分支返回 `false`，媒体必然先被抽出走 `modelAcceptsMedia`——照抄上游那一行等于修一条走不到的路径。改在真正的判定中枢 `src/gyccode/session/media-notice.ts`，并沿用本仓库既有的 `droppedMedia + buildMediaNotice`（上游是静默丢弃，本仓库明令禁止，因其头注说明该机制正是为消除此类幻觉而加）。
- **AI SDK v4 的模型类型收窄在自研层而非内核**。v4 工厂产出 `LanguageModelV4`，而内核 `src/core/aisdk.ts` 的缓存仍按 `LanguageModelV3` 声明。选在唯一写入点 `s.models.set` 收窄，不改内核的 4 处类型。前提已核实：全仓无 `doGenerate`/`doStream`/`specificationVersion` 直接调用，模型只作为对象交给 `ai` 包，而 `ai` 7.0.130 的 `LanguageModel` 形参本身就是 `GlobalProviderModelId | LanguageModelV4 | LanguageModelV3 | LanguageModelV2`。
- **`@actions/github` v9 用值推类型**。v9 是 ESM 重构，不再从深层路径导出 `Context` 类型。改为 `type Context = typeof github.context`，从已有的 `import * as github` 推导，与版本解耦，将来再升不必再改。

## 七、风险

| 风险 | 应对 |
|---|---|
| **中间态无法绿灯**（已实测确认） | 分批只验类型错误下降；运行时四道门在全部批次完成后统一验收。见 §五 |
| 中间态被误提交 | `pre-commit` typecheck 门禁会自动拦截，**不得用 `--no-verify` 规避** |
| 改着改着碰到承继内核 | **硬停止并上报**，见 §四 |
| 迁移后运行时行为变化未被类型系统或测试覆盖 | 收口时必须跑全量 `bun run test`；测试覆盖不到的路径（如真实 provider 调用、真实 ACP 对端）需在提交信息中显式声明未覆盖 |
| ACP 无对端可验证 | 排在 effect 全部批次完成之后，且需谷总提供 ACP 对端环境才启动 |

## 八、验收标准

- effect 四包升至 `4.0.1` 且 `bun run typecheck` 错误数为 **0**
- 全量测试不低于 2079 pass / 0 fail
- webapp typecheck 0 错误、test:web 14 文件 58 测试全过
- `bun run build` 通过；opentui 补丁链 5 项校验全 OK
- 承继内核 `src/{core,tui,llm,schema,protocol,codemode}` 与上游 v1.18.35 逐字节一致（可用 diff 复核）
- ACP SDK 的启动以「拿到对端环境」为前置，未启动前在文档中保持待办状态