# gyccode LLM 连接稳定性：超时问题诊断与代码补丁方案

> 日期：2026-09-04
> 状态：诊断完成；运行配置已改；本文件为**代码级补丁方案**（未改源码，待自行合入）
> 现象：`模型响应超时：连接已建立但长时间未收到首个响应事件，可能是网络中断或服务端无响应 [retrying in 12s attempt #4]`

---

## 1. 结论速览

gyccode 的 LLM 运行时**不是**"裸 fetch"，而是一套已经相当完整的分层防护 + 重试体系。
用户遇到的问题本质是**默认模型走的是 OpenCode Zen 免费排队网关**（`opencode.ai/zen/v1`），
服务端"接了连接但不给首个事件/反复返回 retry-after"，客户端按设计重试，于是看到
`[retrying in 12s attempt #4]`。

"彻底解决"分两半：

1. **运行配置（已改，本会话级即时生效）**：把交互默认模型从排队免费网关切到直连稳定
   provider（DeepSeek 直连）、把全局并发流从 6 降到 3、显式设置首事件超时。
2. **代码补丁（本文件给出 file:line + diff，未落盘）**：修复"原生运行时漏接超时"、
   "重试预算封死长排队"、以及"超时文案误导"等真实缺口。

---

## 2. 现状地图（防护已存在）

| 层级 | 位置 | 机制 |
|---|---|---|
| fetch 头超时 | `src/gyccode/provider/provider.ts:46,1757` | `DEFAULT_HEADER_TIMEOUT_MS=60_000`，首个响应字节等待上限，超时 abort → `HeaderTimeoutError` |
| fetch chunk 空闲超时 | `src/gyccode/provider/provider.ts:47,1756` | `DEFAULT_CHUNK_TIMEOUT_MS=120_000`，SSE 两 chunk 间空闲上限（每个 chunk 重置）→ `ResponseStreamError` |
| 首事件超时（快速失败） | `src/gyccode/session/llm-timeout.ts:23` | `LLM_FIRST_TOKEN_TIMEOUT_MS=180_000`（配置 `llm.first_token_timeout_ms`） |
| 流空闲超时 | `src/gyccode/session/llm-timeout.ts:22` | `LLM_STREAM_IDLE_TIMEOUT_MS=600_000`（配置 `llm.stream_idle_timeout_ms`），有值即重置 |
| 全局并发信号量 | `src/gyccode/session/llm-timeout.ts:34`、`src/gyccode/session/llm.ts:99-100` | `LLM_MAX_CONCURRENT_STREAMS=3`（配置 `llm.max_concurrent_streams`），取 permit 超时 30s |
| 低层传输重试 | `src/llm/route/executor.ts:38-40,367-400` | `MAX_RETRIES=2`、指数退避 500ms×2^n 带 ±20% 抖动，封顶 10s；仅 429/503/504/529 等 |
| 会话级重试 | `src/gyccode/session/retry.ts` | 指数退避 2s×2^n；无头 30s/带头 60s 封顶；总预算 120s；最多 5 次；含 fatal/免费额度分类 |
| 超时文案映射 | `src/gyccode/session/message-v2.ts:908-921` | Effect `TimeoutError` → 可重试 `APIError`（即你看到的"模型响应超时…"） |
| 崩溃可恢复分类 | `src/tui/util/crash-classify.ts:19` | `SSE read timed out` 判为可恢复拒绝 |

---

## 3. 根因链（以你的配置为例）

1. `gyccode.json` 默认 `model: opencode/nemotron-3.5-lightning-free` → 打到
   `https://opencode.ai/zen/v1`（**排队式免费网关**）。
2. 高负载/排队时网关：接包但不回首字节 → AI SDK `SSE read timed out`，或回 429 + `retry-after`
   → 客户端按 `retry.ts` 重试（12s ≈ 服务端 retry-after 或退避档位）。
3. 日志佐证：`gyccode.log*` 多次 `ProviderResponseStreamError: SSE read timed out`（worker unhandledRejection）。

> 不是"客户端没设超时"，而是**上游排队网关在排队**。并发越高（`max_concurrent_streams:6` +
> 子代理并行），排队越久，越是恶性循环——这也正是 `llm-timeout.ts` 注释里认定的首要诱因。

---

## 4. 运行配置改动（已应用，无需重建）

文件：`C:\Users\谷勇成\.config\gyccode\gyccode.json`

```diff
-  "model": "opencode/nemotron-3.5-lightning-free",
-  "small_model": "opencode/nemotron-3.5-lightning-free",
+  "model": "deepseek/deepseek-chat",
+  "small_model": "deepseek/deepseek-chat",
   "agent": {
     "build": {
-      "model": "opencode/nemotron-3.5-lightning-free",
+      "model": "deepseek/deepseek-chat",
       ...
   "llm": {
     "stream_idle_timeout_ms": 600000,
+    "first_token_timeout_ms": 300000,     // 显式；慢但活着的 provider 更耐心，减少假超时
-    "max_concurrent_streams": 6
+    "max_concurrent_streams": 3           // 降低排队压力
   },
```

- `opencode/*` 免费模型仍保留在 provider 定义里，可用 `/model` 随时切回。
- DeepSeek 直连（`api.deepseek.com/v1`）国内链路稳定、非排队，作为交互默认最省心。
- 若想保留免费模型只调参：把 `model` 改回 `opencode/nemotron-3.5-lightning-free` 即可，
  并发保持 3、`first_token_timeout_ms` 建议 ≥ 240_000。

---

## 5. 代码补丁方案（按优先级，未应用）

### P0｜G1：原生 LLM 运行时漏接首事件/空闲超时

`src/gyccode/session/llm.ts`

原生路径（`flags.experimentalNativeLlm` 开启且 provider 支持时）在
**line ~418** 直接 `return result.stream`，绕过了 AI SDK 路径在 **429-435** 应用的两个包装
`withFirstEventTimeout` + `streamWithIdleTimeout`。若启用原生运行时，卡死连接会一路挂到 TCP
超时，复现"会话变慢"。

建议：把两个包装抽成 helper，两条路径统一套用：

```diff
  // （在 stream 组装处，对 native 与 ai-sdk 统一收口）
  function guard(stream: Stream.Stream<LLMEvent, unknown, unknown>, cfg: Config) {
    return streamWithIdleTimeout(
      withFirstEventTimeout(stream, resolveFirstTokenTimeout(cfg)),
      resolveStreamIdleTimeout(cfg),
    )
  }
  ...
-           if (result.type === "native") return result.stream
+           if (result.type === "native") return guard(result.stream, cfg)
  ...
-            return streamWithIdleTimeout(
-              withFirstEventTimeout(converted, resolveFirstTokenTimeout(cfg)),
-              resolveStreamIdleTimeout(cfg),
-            )
+            return guard(converted, cfg)
```

### P1｜G2：会话级重试预算封死"长排队但合法"的 retry-after

`src/gyccode/session/retry.ts:36-44`

```ts
export const RETRY_ABANDON_AFTER_MS = 300_000 // 5 min
export const RETRY_TOTAL_CAP_MS = 120_000     // ← 总预算 2 分钟
export const MAX_RETRY_ATTEMPTS = 5
```

`RETRY_TOTAL_CAP_MS=120s` 会在第 4-5 次（服务端 retry-after 各 60s）后**放弃**，即使服务端明确
"请 60s 后再试"。对排队网关这等于必然失败。建议：**服务端显式 retry-after 时不占/放宽总预算**，
只对无头退避保留 120s 封顶：

```diff
  // policy 内（retry.ts ~line 206-217）：
-       if (meta.elapsed > RETRY_TOTAL_CAP_MS) return Cause.done(meta.attempt)
+       // 服务端显式给出 retry-after 时信任其指引，放宽总预算；仅无头指数退避受 RETRY_TOTAL_CAP_MS 约束
+       const hasServerRetryAfter =
+         SessionV1.APIError.isInstance(error) && !!error.data.responseHeaders?.["retry-after" | "retry-after-ms"]
+       if (!hasServerRetryAfter && meta.elapsed > RETRY_TOTAL_CAP_MS) return Cause.done(meta.attempt)
```

可选：把 `MAX_RETRY_ATTEMPTS`/各 `RETRY_*` 常量提升为配置项（`llm.retry_max_attempts` 等），
对齐 `resolveStreamIdleTimeout` 的读取模式（`llm-timeout.ts`）。

### P2｜G3：per-provider `headerTimeout` / `chunkTimeout` 未文档化、默认偏激进

`src/gyccode/provider/provider.ts:1756-1757` 已支持 `options.headerTimeout`（60s 默认）与
`options.chunkTimeout`（120s 默认），schema 侧 `src/core/v1/config/provider.ts:108` 也有
`headerTimeout`。但：

- 用户在 `gyccode.json` 的 provider `options` 里未显式配置，无法覆盖慢网关的 60s 头超时；
- 慢思考模型长"think"间隙超过 chunk 空闲上限会被误杀。

建议：在文档/示例中公开，并针对排队类网关调大：
```json
"provider": {
  "opencode": { "options": { "useInstructions": true,
                             "headerTimeout": 300000, "chunkTimeout": 300000 } }
}
```

### P3｜G4（次要）：文案误导——超时不等于"连接已建立但无响应"

`src/gyccode/session/message-v2.ts:908-921` 把所有 Effect `TimeoutError` 统一映射成
"模型响应超时：连接已建立但长时间未收到首个响应事件…"。实际可能的三类原因被同一文案掩盖：

1. 并发信号量取 permit 超时（`llm.ts:406` 30s `Effect.timeout`）——根本没连出去；
2. 上游排队（retry-after）——是"服务端在排队"不是"无响应"；
3. 真·首事件超时。

建议按错误出处区分文案/错误码：concurrency-wait、provider-queue(retry-after)、no-first-event，
让用户一眼知道该"等"还是该"换 provider/降并发"。

---

## 6. 建议验证步骤（合入后）

1. `bun test src/gyccode/session/llm-timeout.test.ts src/gyccode/session/retry.test.ts`
   （G1/G2 改动后补：native 路径也套超时；retry-after 场景下总预算放宽）
2. `node tsc --noEmit`（或仓库 `typecheck.mjs`）确认类型无回归
3. 用 `experimentalNativeLlm` 开关 + 慢模型实测首事件/空闲超时触发与文案

---

## 7. 已核对的事实（避免误改）

- 仓库 HEAD：`d8caa4f8a`（2026-09-04），工作区干净；`node_modules\gyc-code` 与仓库一致。
- 运行进程 `gyc.exe` → `node_modules\gyc-code\bin\gyc`；配置在会话启动时读取，改配置**无需重建/重启进程**。
- 日志中出现的 `ProviderResponseStreamError: SSE read timed out` 已被
  `crash-classify.ts:19` 判为可恢复，走 retry 路径——与用户看到的重试文案吻合。
