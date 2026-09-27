# opencode 内核 v1.18.26 → v1.18.32 升级实施计划

> [!NOTE]
> This document may not reflect the current implementation.
> See the final report for up-to-date state:
> [Final Report](../reports/2026-09-27-opencode-kernel-1.18.32-升级报告.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 gyc-code 承继的 opencode 内核从 v1.18.26 全量对齐到 v1.18.32（逐文件移植上游 hunk，保留全部本地化），并以 `bunx tsc --noEmit` + `bun run test` 验证通过。

**Architecture:** 上游是独立仓库（`anomalyco/opencode`，原 `sst/opencode`）。做法：在临时目录保留上游参考 checkout，逐文件取 `v1.18.26..v1.18.32` 的 diff hunk，手工合并进 gyc 对应文件；冲突按「本地化 > 自研层契约 > 上游语义」裁决。

**Tech Stack:** Bun + TypeScript + effect v4 beta + OpenTUI；Windows / PowerShell 5.1。

---

## 映射表（已实测确定）

| 上游路径 | gyc 路径 |
|---|---|
| `packages/core/src/**` | `src/core/**` |
| `packages/tui/src/**` | `src/tui/**` |
| `packages/opencode/src/acp/**` | `src/gyccode/acp/**` |
| `packages/opencode/src/provider/**` | `src/gyccode/provider/**` |
| `packages/opencode/src/plugin/**` | `src/gyccode/plugin/**` |
| `packages/opencode/src/session/**` | `src/gyccode/session/**` |
| `packages/opencode/src/server/**` | `src/gyccode/server/**` |
| `packages/opencode/src/cli/cmd/tui.ts` | `src/cli/cmd/tui.ts` |

包名替换规则：`@opencode-ai/<pkg>` → `@gyccode/<pkg>`；`opencode`/`OpenCode` 品牌字样 → `GycCode`（用户可见文案改中文，遵循铁律）。

## 范围与已定决策（谷总拍板）

1. 范围：全量对齐内核映射文件源码。
2. 路线：逐文件移植（不做整目录覆盖、不做三方合并）。
3. 测试：**仅源码**。上游 `packages/*/test/**` 不入库（gyc 无 `test/` 目录，测试与源码同目录）；仅当 gyc 已有同名测试文件时才同步其用例。
4. 依赖：bump `@ai-sdk/azure` 3.0.88→3.0.93、`@ai-sdk/gateway` 3.0.104→3.0.191、`@ai-sdk/openai` 3.0.84→3.0.88、`@ai-sdk/provider` 3.0.8→3.0.16、`@ai-sdk/provider-utils` 4.0.23→4.0.51、`gitlab-ai-provider` 6.12.1→6.15.0；`effect` / `drizzle-orm` 锁死不动；gyc 无 `@ai-sdk/togetherai`，跳过。
5. 上游新增 SDK 补丁（`@ai-sdk/openai@3.0.88.patch`）**不引入**，登记为已知差异。
6. 验证：`bunx tsc --noEmit` → `bun run test`（全量）。

## 已知差异（本次不移植，须在收尾登记）

| 上游改动 | 不移植理由 |
|---|---|
| `provider/transform.ts` 的 `anthropicBlockBinding` 重写（`blockBinding` + thinking-binding-controls） | 依赖上游打的 AI SDK 补丁；gyc 无 `patches/` 机制，本地 `transform.variants.ts` 已用自有 `anthropicUsesModernAdaptiveThinking` 达成等价路径 |
| `patches/@ai-sdk%2Fopenai@3.0.88.patch` | 谷总裁决不引入（gyc 自研 `src/llm` 直构请求，另有 vendored copilot 语言模型自带 serviceTier 逻辑） |
| 上游全部测试文件 | 谷总裁决仅源码（gyc 测试体系独立） |
| `package.json` 的 togetherai bump | gyc 未依赖该包 |

## 任务 ↔ spec 覆盖对照

| 任务 | 覆盖 spec 章节 |
|---|---|
| Task 1 上游参考仓库 | 七（风险：映射错位的前置准备） |
| Task 2 core 内核 | 二（范围）、三（逐文件移植）、四（冲突裁决） |
| Task 3 ACP | 二、三、四 |
| Task 4 provider | 二、三、四、七（依赖漂移） |
| Task 5 plugin | 二、三、四 |
| Task 6 session + server | 二、三、四 |
| Task 7 CLI | 二、三 |
| Task 8 TUI | 二、三、四（本地化优先） |
| Task 9 依赖 bump | 三（依赖变更单独评估）、七（依赖漂移） |
| Task 10 文档版本号 | 六（收尾 1） |
| Task 11 全量验证与收尾 | 五（验证）、六（收尾 2）、七（回退） |

---

## Task 1: 上游参考仓库就绪

**Files:**
- 外部临时目录：`C:\Users\Administrator\AppData\Local\Temp\gyccode\opencode-up`（不写入仓库）

- [ ] **Step 1: 确认参考仓库与两个 tag 存在**

```powershell
$UP = "C:\Users\Administrator\AppData\Local\Temp\gyccode\opencode-up"
git -C $UP rev-parse v1.18.26 v1.18.32
```

Expected（前 10 位）：`774cc7c191` 与 `545f51d26c`。

- [ ] **Step 2: 若目录不存在或 tag 缺失，用 gh-proxy 重新克隆**

```powershell
$UP = "C:\Users\Administrator\AppData\Local\Temp\gyccode\opencode-up"
git clone --filter=blob:none --no-checkout https://gh-proxy.com/https://github.com/anomalyco/opencode.git $UP
git -C $UP fetch --tags origin
git -C $UP tag -l "v1.18.32"
```

Expected: 输出 `v1.18.32`（直连 github.com 会超时，必须走 gh-proxy）。

- [ ] **Step 3: 校验差异面命令可用**

```powershell
git -C $UP diff --numstat v1.18.26..v1.18.32 -- packages/core/src packages/tui/src packages/opencode/src
```

Expected: 约 25 行（含 `aisdk.ts 1/1`、`acp/service.ts 157/36`、`tui/src/routes/session/index.tsx 15/26`）。

---

## Task 2: core 内核移植（5 文件）

**Files:**
- Modify: `src/core/aisdk.ts:44`
- Modify: `src/core/filesystem/search.ts:8,71,96,98,119,164,182,183,232`
- Modify: `src/core/npm.ts`（`resolveEntryPoint`，约 50-58 行）
- Replace: `src/core/plugin/provider/amazon-bedrock.ts`（本地与上游 1.18.26 逐字节一致）
- Replace: `src/core/v1/config/provider.ts`（本地与上游 1.18.26 逐字节一致）

- [ ] **Step 1: `src/core/aisdk.ts` —— SSE 取消不吞异常**

第 44 行 `          void reader.cancel(err)` 改为：

```ts
          reader.cancel(err).catch(() => {})
```

- [ ] **Step 2: `src/core/filesystem/search.ts` —— Entry/Match 改由 schema 包导入**

第 8 行 `import { FileSystem } from "../filesystem"` 替换为：

```ts
import { Entry, Match } from "@gyccode/schema/filesystem"
import type { FileSystem } from "../filesystem"
```

随后 8 处构造调用改名（`FileSystem.FindInput` 等类型引用不动）：

| 行 | 现在 | 改为 |
|---|---|---|
| 71 | `FileSystem.Entry.make({` | `Entry.make({` |
| 96 | `FileSystem.Match.make({` | `Match.make({` |
| 98 | `entry: FileSystem.Entry.make({` | `entry: Entry.make({` |
| 119 | `return FileSystem.Entry.make({` | `return Entry.make({` |
| 164 | `FileSystem.Entry.make({` | `Entry.make({` |
| 182 | `return FileSystem.Match.make({` | `return Match.make({` |
| 183 | `entry: FileSystem.Entry.make({` | `entry: Entry.make({` |
| 232 | `return FileSystem.Entry.make({` | `return Entry.make({` |

- [ ] **Step 3: `src/core/npm.ts` —— Node 分支用 require 解析入口**

`import path from "path"` 之后加：

```ts
import { createRequire } from "module"
import { pathToFileURL } from "url"
```

`resolveEntryPoint` 内 `entrypoint = typeof Bun !== "undefined" ? import.meta.resolve(name, dir) : import.meta.resolve(dir)` 替换为：

```ts
    // Node 仅在 --experimental-import-meta-resolve 下才接受 parent 参数，
    // 且 import() 裸包目录会抛 ERR_UNSUPPORTED_DIR_IMPORT；
    // require 解析到 "require"/"default" 导出目标，import() 可正常加载。
    entrypoint =
      typeof Bun !== "undefined"
        ? import.meta.resolve(name, dir)
        : pathToFileURL(createRequire(path.join(dir, "package.json")).resolve(name)).href
```

- [ ] **Step 4: 覆盖两个与上游 1.18.26 逐字节一致的文件**

```powershell
$UP = "C:\Users\Administrator\AppData\Local\Temp\gyccode\opencode-up"
git -C $UP show v1.18.32:packages/core/src/plugin/provider/amazon-bedrock.ts | Set-Content D:\00MyAI\gyc-code\src\core\plugin\provider\amazon-bedrock.ts -Encoding UTF8
git -C $UP show v1.18.32:packages/core/src/v1/config/provider.ts | Set-Content D:\00MyAI\gyc-code\src\core\v1\config\provider.ts -Encoding UTF8
```

语义变化（核对用）：`amazon-bedrock.ts` 增加 `if (modelID.startsWith("arn:")) return modelID`，前缀列表 `"deepseek"` → `"deepseek.r1"`；`v1/config/provider.ts` 的 `chunkTimeout` 支持 `Schema.Literal(false)`，描述补 `(default: 300000)`。

- [ ] **Step 5: 去 BOM 并校验**

```powershell
$f = "D:\00MyAI\gyc-code\src\core\plugin\provider\amazon-bedrock.ts"
[System.IO.File]::ReadAllBytes($f)[0..2] -join ","
```

Expected: `97,114,110`（无 BOM）。若为 `239,187,191`，执行：

```powershell
[System.IO.File]::WriteAllText($f, ([System.IO.File]::ReadAllText($f)), (New-Object System.Text.UTF8Encoding($false)))
```

- [ ] **Step 6: 类型自查**

```powershell
bunx tsc --noEmit 2>&1 | Select-String -Pattern 'core/aisdk.ts|core/filesystem/search.ts|core/npm.ts|core/plugin/provider/amazon-bedrock.ts|core/v1/config/provider.ts'
```

Expected: 空输出。

---

## Task 3: ACP 移植（3 文件）

**Files:**
- Modify: `src/gyccode/acp/config-option.ts:70-74`
- Modify: `src/gyccode/acp/event.ts`（两处 `messageId`）
- Modify: `src/gyccode/acp/service.ts`（新增 7 个函数 + 改 4 处调用点）

- [ ] **Step 1: `config-option.ts` —— effort 选项支持 default 哨兵**

`buildEffortSelectOption` 内第 70-74 行改为：

```ts
    currentValue:
      input.currentVariant === DEFAULT_VARIANT_VALUE
        ? DEFAULT_VARIANT_VALUE
        : (selectVariant(input.currentVariant, input.variants) ?? ""),
    options: [...new Set([...input.variants, DEFAULT_VARIANT_VALUE])].map((variant) => ({
      value: variant,
      name: formatVariantName(variant),
    })),
```

（`DEFAULT_VARIANT_VALUE` 已在第 3 行定义；`?? ""` 是本地类型契约，保留。）

- [ ] **Step 2: `acp/event.ts` —— reasoning 分片用 part.id**

第一处（reasoning 分片的 `update.sessionUpdate`）：`messageId: message.info.id,` 改为：

```ts
          messageId: part.type === "reasoning" ? part.id : message.info.id,
```

第二处（`sessionUpdate: "agent_thought_chunk"`）：`messageId: props.messageID,` 改为 `messageId: props.partID,`。

- [ ] **Step 3: `acp/service.ts` —— 会话恢复语义重构**

3a. 导入：sdk 类型追加 `Session`；`import { buildConfigOptions, parseModelSelection } from "./config-option"` 改为：

```ts
import { buildConfigOptions, DEFAULT_VARIANT_VALUE, parseModelSelection } from "./config-option"
```

3b. 三个调用点（本地约 239 / 339 / 407 行）统一改为（`forkSession` 用 `forked` 作第二参、`id` 用 `forked.id`）：

```ts
    const backing = yield* request(
      () => input.sdk.session.get({ directory: params.cwd, sessionID: params.sessionId }, { throwOnError: true }),
      "session",
    )
    // ...（messages 拉取保持不变）
    const restored = restoreSession(
      snapshot,
      backing,
      messages.map((item) => item.info),
    )
    const state = yield* session.load({
      id: params.sessionId,
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      model: restored.model,
      variant: restored.variant,
      modeId: restored.modeId,
    })
```

同时把三处返回体 `model: state.model ?? model,` 改为 `model: state.model ?? restored.model,`。

3c. `setSessionConfigOption` 的 model 分支（本地约 418-430 行）改为：

```ts
    if (params.configId === "model") {
      const selected = yield* parseSelectedModel(snapshot, params.value)
      const variant = selectModelVariant(snapshot, current, selected)
      const state = yield* session
        .setVariant(params.sessionId, Directory.variants(snapshot, selected.model) ? variant : undefined)
        .pipe(Effect.andThen(session.setModel(params.sessionId, selected.model)))
      const options = configOptions(snapshot, {
        model: state.model ?? selected.model,
        variant: state.variant,
        modeId: state.modeId,
      })
      yield* sendConfigOptionUpdate(input.connection, params.sessionId, options)
      return {
        configOptions: options,
      }
    }
```

3d. effort 分支：`if (!variants || !Object.keys(variants).includes(params.value))` 改为 `if (!variants || !hasVariant(variants, params.value))`。

3e. 在 `selectVariant`（本地约 916 行）之后新增：

```ts
function selectModelVariant(
  snapshot: Directory.Snapshot,
  current: ACPSession.Info,
  selected: { model: Directory.DefaultModel; variant?: string },
) {
  const variants = Directory.variants(snapshot, selected.model)
  if (!variants) return
  if (selected.variant) return selected.variant
  if (sameModel(selected.model, current.model) && current.variant && hasVariant(variants, current.variant))
    return current.variant
  return selectVariant(snapshot, selected.model)
}

function hasVariant(variants: Directory.ModelVariants, variant: string) {
  // "default" 也是「未显式指定变体」的持久化哨兵值。
  return variant === DEFAULT_VARIANT_VALUE || Object.hasOwn(variants, variant)
}
```

在 `configOptions` 之后新增：

```ts
function sendConfigOptionUpdate(
  connection: ServiceConnection | undefined,
  sessionId: string,
  options: ReturnType<typeof configOptions>,
) {
  if (!connection) return Effect.void
  return Effect.tryPromise({
    try: () =>
      connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "config_option_update",
          configOptions: options,
        },
      }),
    catch: () => undefined,
  }).pipe(Effect.ignore)
}
```

在 `stableStringify` 之后、`restoreFromMessages` 之前新增：

```ts
function restoreSession(
  snapshot: Directory.Snapshot,
  backing: Pick<Session, "agent" | "model">,
  messages: MessageInfo[],
) {
  const history = restoreFromMessages(messages)
  const durable = restoreDurableModel(backing.model)
  const model = restoreModel(snapshot, durable.model, history.model)
  return {
    model,
    variant: restoreVariant(snapshot, model, durable, history),
    modeId: restoreMode(snapshot, backing.agent, history.modeId),
  }
}

function restoreDurableModel(model: Session["model"] | undefined) {
  if (!model) return {}
  return {
    model: {
      providerID: ProviderV2.ID.make(model.providerID),
      modelID: ModelV2.ID.make(model.id),
    },
    variant: model.variant,
  }
}

function restoreModel(
  snapshot: Directory.Snapshot,
  durable: Directory.DefaultModel | undefined,
  history: Directory.DefaultModel | undefined,
) {
  if (durable && hasModel(snapshot, durable)) return durable
  if (history && hasModel(snapshot, history)) return history
  return selectDefaultModel(snapshot)
}

function restoreVariant(
  snapshot: Directory.Snapshot,
  model: Directory.DefaultModel,
  durable: { model?: Directory.DefaultModel; variant?: string },
  history: { model?: Directory.DefaultModel; variant?: string },
) {
  const variants = Directory.variants(snapshot, model)
  if (!variants) return
  if (sameModel(model, durable.model) && durable.variant && hasVariant(variants, durable.variant))
    return durable.variant
  if (sameModel(model, history.model) && history.variant && hasVariant(variants, history.variant))
    return history.variant
  return selectVariant(snapshot, model)
}

function restoreMode(snapshot: Directory.Snapshot, durable: string | undefined, history: string | undefined) {
  if (hasMode(snapshot, durable)) return durable
  if (hasMode(snapshot, history)) return history
  if (snapshot.availableModes.length > 0) return snapshot.defaultModeID
}

function hasModel(snapshot: Directory.Snapshot, model: Directory.DefaultModel) {
  return Boolean(snapshot.providers[model.providerID]?.models[model.modelID])
}

function hasMode(snapshot: Directory.Snapshot, modeId: string | undefined) {
  return Boolean(modeId && snapshot.availableModes.some((mode) => mode.id === modeId))
}

function sameModel(left: Directory.DefaultModel, right: Directory.DefaultModel | undefined) {
  return left.providerID === right?.providerID && left.modelID === right.modelID
}
```

注意：`ProviderV2` / `ModelV2` 若未导入按本文件现有风格补；`ServiceConnection` 用本地 `input.connection` 的既有类型别名。

- [ ] **Step 4: 类型自查**

```powershell
bunx tsc --noEmit 2>&1 | Select-String -Pattern 'acp/config-option.ts|acp/event.ts|acp/service.ts'
```

Expected: 空输出。

---

## Task 4: provider 移植（2 文件）

**Files:**
- Modify: `src/gyccode/provider/transform.variants.ts:667-668`
- Modify: `src/gyccode/provider/provider.ts:350-353,372,1830-1831`

- [ ] **Step 1: `transform.variants.ts` —— gitlab provider 分级推理**

第 667-668 行改为：

```ts
    case "gitlab-ai-provider":
      if (model.family?.startsWith("gpt")) return { reasoningEffort: effort }
      if (model.family?.startsWith("claude")) return { thinking: { type: "adaptive", effort } }
      return
```

- [ ] **Step 2: `provider.ts` —— ARN 模型 ID 直通**

在 `const crossRegionPrefixes = ["global.", "us.", "eu.", "jp.", "apac.", "au."]`（第 350 行）之前插入：

```ts
          if (modelID.startsWith("arn:")) {
            return sdk.languageModel(modelID)
          }
```

（`sdk.languageModel` 沿用本地相邻 return 的写法。）

- [ ] **Step 3: `provider.ts` —— Bedrock 前缀列表收窄**

第 372 行 `                "deepseek",` 改为 `                "deepseek.r1",`。

- [ ] **Step 4: 超时默认值核对（本地已实现）**

本地第 1830-1831 行已是 `?? DEFAULT_CHUNK_TIMEOUT_MS` / `?? DEFAULT_HEADER_TIMEOUT_MS`，上游为 `?? 300_000`。核对常量值：

```powershell
rg -n -F "DEFAULT_CHUNK_TIMEOUT_MS" D:\00MyAI\gyc-code\src\gyccode\provider\provider.ts
rg -n -F "DEFAULT_HEADER_TIMEOUT_MS" D:\00MyAI\gyc-code\src\gyccode\provider\provider.ts
```

Expected: 定义均为 `300_000`。若不等，把定义改为 `300_000` 并在收尾登记。

- [ ] **Step 5: 类型自查**

```powershell
bunx tsc --noEmit 2>&1 | Select-String -Pattern 'provider/transform.variants.ts|provider/provider.ts'
```

Expected: 空输出。

---

## Task 5: plugin 移植（3 文件）

**Files:**
- Modify: `src/gyccode/plugin/github-copilot/copilot.ts:385`
- Modify: `src/gyccode/plugin/github-copilot/models.ts:176`
- Modify: `src/gyccode/plugin/openai/codex.ts:282-283`

- [ ] **Step 1: `copilot.ts` —— 交互 ID 头**

第 385 行 `output.headers["X-GitHub-Api-Version"] = API_VERSION` 之后加：

```ts
      output.headers["X-Interaction-Id"] = incoming.sessionID
```

- [ ] **Step 2: `models.ts` —— thinking 一律 summarized**

第 176 行改为：

```ts
            display: "summarized",
```

- [ ] **Step 3: `codex.ts` —— GPT 版本过滤按 major/minor**

第 282-283 行改为：

```ts
              const match = model.api.id.match(/^gpt-(\d+)(?:\.(\d+))?/)
              if (!match) return false
              const major = Number(match[1])
              const minor = Number(match[2] ?? 0)
              return major > 5 || (major === 5 && minor > 4)
```

- [ ] **Step 4: 类型自查**

```powershell
bunx tsc --noEmit 2>&1 | Select-String -Pattern 'plugin/github-copilot|plugin/openai/codex.ts'
```

Expected: 空输出。

---

## Task 6: session 与 server 移植（3 改 + 1 新建）

**Files:**
- Modify: `src/gyccode/session/system.ts:10,36`
- Create: `src/gyccode/session/prompt/gpt-astra.txt`
- Modify: `src/gyccode/session/message-v2.ts:384`
- Modify: `src/gyccode/server/routes/instance/httpapi/middleware/error.ts:24`

- [ ] **Step 1: `system.ts` —— GPT-6 走 ASTRA 提示词**

第 10 行 `import PROMPT_GPT from "./prompt/gpt.txt"` 之后加：

```ts
import PROMPT_ASTRA from "./prompt/gpt-astra.txt"
```

`provider()` 第 36 行后插入分支，结果：

```ts
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("gpt-6")) return [PROMPT_ASTRA]
    if (model.api.id.includes("codex")) {
```

- [ ] **Step 2: 新建 `src/gyccode/session/prompt/gpt-astra.txt`**

```powershell
$UP = "C:\Users\Administrator\AppData\Local\Temp\gyccode\opencode-up"
$out = "D:\00MyAI\gyc-code\src\gyccode\session\prompt\gpt-astra.txt"
(git -C $UP show v1.18.32:packages/opencode/src/session/prompt/gpt-astra.txt) -replace 'OpenCode','GycCode' | Set-Content $out -Encoding UTF8
[System.IO.File]::WriteAllText($out, ([System.IO.File]::ReadAllText($out)), (New-Object System.Text.UTF8Encoding($false)))
rg -n -F "OpenCode" $out
```

Expected: `rg` 空输出；首行 `You are an AI agent powered by GycCode, a coding agent harness. ...`（英文，与同目录 `gpt.txt` 风格一致）。

- [ ] **Step 3: `message-v2.ts` —— Bedrock 附件仅限支持图像的模型**

第 384 行改为：

```ts
    if (model.api.npm === "@ai-sdk/amazon-bedrock") {
      if (!attachment.mime.startsWith("image/")) return false
      const id = model.api.id.toLowerCase()
      return id.includes("anthropic.") || id.includes("nova") || id.includes("llama4") || id.includes("llama-4")
    }
```

- [ ] **Step 4: `middleware/error.ts` —— RemoteAuthError 归为 400**

第 24 行改为：

```ts
        ConfigErrorV1.DirectoryTypoError.isInstance(error) ||
        ConfigErrorV1.RemoteAuthError.isInstance(error)
```

（`RemoteAuthError` 已定义于 `src/core/v1/config/error.ts:36`。）

- [ ] **Step 5: 类型自查**

```powershell
bunx tsc --noEmit 2>&1 | Select-String -Pattern 'session/system.ts|session/message-v2.ts|middleware/error.ts'
```

Expected: 空输出。

---

## Task 7: CLI 移植（1 文件）

**Files:**
- Modify: `src/cli/cmd/tui.ts:292`

- [ ] **Step 1: `process.exit(0)` → `process.exit()`**

第 292 行 `    process.exit(0)` 改为 `    process.exit()`（退出码交由 `process.exitCode` 决定，与 TUI 错误路径 `exitCode = 1` 配合）。

- [ ] **Step 2: 类型自查**

```powershell
bunx tsc --noEmit 2>&1 | Select-String -Pattern 'cli/cmd/tui.ts'
```

Expected: 空输出。

---

## Task 8: TUI 移植（行为 1 处 + 省略号核查）

**Files:**
- Modify: `src/tui/app.tsx`（第 863-867 行区域）
- Modify: `src/tui/component/error-component.tsx`（issue URL marker）

- [ ] **Step 1: `app.tsx` —— 错误退出码**

第 863-867 行区域改为：

```ts
    win32FlushInputBuffer()
    if (result.reason !== undefined) {
      process.stderr.write((cliErrorMessage(result.reason) ?? errorFormat(result.reason)) + "\n")
      process.exitCode = 1
    }
    if (result.epilogue) process.stdout.write(result.epilogue + "\n")
```

- [ ] **Step 2: `error-component.tsx` —— issue URL 截断标记**

```ts
  const marker = "\n... (truncated)"
```

改为：

```ts
  const marker = "\n… (truncated)"
```

（issue URL 面向 GitHub，保留英文即可。）

- [ ] **Step 3: 省略号核查（其余 TUI 文件）**

上游在 12 个 TUI 文件把用户可见英文串的 `...` 改成 `…`；gyc 这些串大多已本地化为中文且已用 `…`。核查残留：

```powershell
rg -n --no-heading '"[^"]*\.\.\.[^"]*"' D:\00MyAI\gyc-code\src\tui\app.tsx D:\00MyAI\gyc-code\src\tui\component D:\00MyAI\gyc-code\src\tui\feature-plugins D:\00MyAI\gyc-code\src\tui\routes D:\00MyAI\gyc-code\src\tui\ui D:\00MyAI\gyc-code\src\tui\util
```

Expected: 每处若是**用户可见英文串**则改为 `…`；若是中文串/注释/正则/测试夹具，保持原样并在收尾说明。

- [ ] **Step 4: 类型自查**

```powershell
bunx tsc --noEmit 2>&1 | Select-String -Pattern 'tui/app.tsx|tui/component/error-component.tsx'
```

Expected: 空输出。

---

## Task 9: 依赖 bump

**Files:**
- Modify: `D:\00MyAI\gyc-code\package.json:33,34,37,39,40,103`

- [ ] **Step 1: 改版本号**

| 行 | 包 | 现在 | 改为 |
|---|---|---|---|
| 33 | `@ai-sdk/azure` | `3.0.88` | `3.0.93` |
| 34 | `@ai-sdk/gateway` | `3.0.104` | `3.0.191` |
| 37 | `@ai-sdk/openai` | `3.0.84` | `3.0.88` |
| 39 | `@ai-sdk/provider` | `3.0.8` | `3.0.16` |
| 40 | `@ai-sdk/provider-utils` | `4.0.23` | `4.0.51` |
| 103 | `gitlab-ai-provider` | `6.12.1` | `6.15.0` |

- [ ] **Step 2: 安装并核对锁文件**

```powershell
bun install
git diff --stat bun.lock
```

Expected: 安装成功；锁文件仅这 6 个包版本变化。**不得**改动 `effect` / `drizzle-orm` 条目。

- [ ] **Step 3: 类型自查（依赖变更可能触发类型漂移）**

```powershell
bunx tsc --noEmit 2>&1 | Select-String -Pattern 'gyccode/provider|gyccode/plugin|core/'
```

Expected: 空输出。若有报错，按「本地化 > 自研层契约 > 上游语义」就地修正并记录文件:行号。

---

## Task 10: 文档版本号

**Files:**
- Modify: `AGENTS.md:34`
- Modify: `README.md:117`

- [ ] **Step 1: 更新内核基线版本**

`AGENTS.md` 第 34 行：`来自 opencode 1.18（MIT）` → `来自 opencode 1.18.32（MIT）`。

`README.md` 第 117 行：`**opencode 1.18（MIT）**` → `**opencode 1.18.32（MIT）**`。

- [ ] **Step 2: 核对品牌残留**

```powershell
rg -n -F "OpenCode" D:\00MyAI\gyc-code\AGENTS.md D:\00MyAI\gyc-code\README.md
```

Expected: 仅剩「上游品牌诚实」类既有说明（如 OpenCode Zen / OpenCode Go 真实品牌引用）。

---

## Task 11: 全量验证与收尾

- [ ] **Step 1: 类型检查（排除 src/webapp）**

```powershell
bunx tsc --noEmit
```

Expected: 零错误输出。

- [ ] **Step 2: 全量测试**

```powershell
bun run test
```

Expected: 全部通过（基线 843 pass / 0 fail）。任何 fail 必须定位到具体 hunk：修复或回退该 hunk，不得放行。

- [ ] **Step 3: 源码直跑冒烟（避开 dist 陷阱）**

```powershell
bun run dev --version
```

Expected: 正常输出版本号、无崩溃（不要直接跑 `gyc`，会命中旧 dist）。

- [ ] **Step 4: 已知差异登记**

把「已知差异」表补进 `docs/compose/reports/2026-09-27-opencode-kernel-1.18.32-升级报告.md`，逐条写明：上游改动、gyc 处置、影响面。

- [ ] **Step 5: 任务收尾 4 步（铁律）**

① 总结 ② 归纳 ③ 学习（沉淀 docs/记忆/SKILL） ④ 进化（可改进项立即落地或记待办）。

- [ ] **Step 6: 提交（待谷总确认后执行）**

```powershell
git add -A
git commit -m "chore(kernel): 对齐上游 opencode v1.18.26 → v1.18.32（逐文件移植，保留本地化）"
```

不要 push、不要建 PR，除非谷总明确要求。
