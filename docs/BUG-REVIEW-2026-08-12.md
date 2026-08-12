# gyc-cli 逐行代码审查报告（2026-08-12）

> 触发：`@command://cr 阅读gyc cli的每一行代码，查找可能的每一个bug`
> 审查范围：`src/` 下 1158 个 TS/TSX 文件，约 18 万行
> 方法：全量 lint + 反模式扫描（catch/setTimeout/as any/structuredClone/Promise.all/sql.raw…）+ 核心文件深拷
> 分级：P0（阻断/严重）/ P1（重要）/ P2（建议）/ P3（理论风险）
> 说明：本报告仅含**确证的代码缺陷或高风险反模式**；大量防御性代码（TUI 的 catch(()=>{})、JSON 解析 try/catch）已逐一排查确认无害，不计入。

---

## 一、P1（重要，建议优先修复）

### 1.1 `prompt.ts:456-492` — catchCause 返回 void 污染 result 类型（唯一编译器 ERROR）

```ts
const result = yield* taskTool.execute(taskArgs, {...})
  .pipe(
    Effect.catchCause((cause) => {
      ...
      return Effect.logError("subtask execution failed", {...})  // ← 返回 Effect<void>
    }),
    Effect.onInterrupt(() => ...),   // ← 返回 Effect<void>
  )
const attachments = result?.attachments?.map(...)  // ← line 487 报错
```

- **问题**：`Effect.catchCause` 的 handler 返回 `Effect.logError`（类型 `Effect<void>`），与成功分支的 `Effect.Effect<ExecuteResult>` 联合后，`result` 类型变为 `void | ExecuteResult<...>`。`line 487` `result?.attachments` 在 void 分支访问属性，触发 **TS2339 ERROR**（全项目唯一编译器错误，已由 `read_lints` 确证）。附带 `attachment` 参数隐式 any 的 HINT。
- **运行时影响**：低 — `void` 分支实际不产生值（logError 忽略），`const attachments` 实际要么是 map 结果要么 undefined，不会崩溃。
- **建议**：catchCause handler 改为 `return Effect.succeed(undefined)` 保持类型一致；或把 `const attachments` 提到 catch 之外只对 `result !== undefined && typeof result === "object"` 分支执行。

### 1.2 `mcp/index.ts:578-585` — Windows 下 MCP 子进程树不清理（进程泄漏）

```ts
if (process.platform === "win32") return [] as number[]   // line 457，直接跳过
...
const pids = yield* descendants(pid)
for (const dpid of pids) { process.kill(dpid, "SIGTERM") }
```

- **问题**：`descendants()` 在 Windows 上直接返回 `[]`，且即便拿到 pid 也只用 `process.kill(SIGTERM)`（Windows 下 `SIGTERM` 语义是"礼貌请求"，Node 下对没有控制台句柄的进程常常无效）。而项目 `util/process.ts:157` 已有现成的 `taskkill /pid X /T /F` 强杀进程树方案（`core/shell.ts:36`、`core/cross-spawn-spawner.ts:299` 也都有 win32 分支），MCP 这块没有复用。
- **影响**：Windows 上连接 `stdio` 类型 MCP server（通常会拉起 node/npx 等子进程）后退出 gyccode，MCP 子进程树残留，占用端口/内存。
- **建议**：win32 分支改用 `taskkill /pid <pid> /T /F`；非 win32 保留 pgrep+SIGTERM 下游清理。

### 1.3 `id/id.ts:54-58` / `schema/identifier.ts:15-19` — 同毫秒 ID 计数器无上限

```ts
if (currentTimestamp !== lastTimestamp) { lastTimestamp = currentTimestamp; counter = 0 }
counter++
const now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)   // 12bit 空间
```

- **问题**：`counter` 只在毫秒变化时清零，同毫秒内可无限递增。超过 `0xFFF`（4096）后 `counter` 溢出并入 `now` 的高位——**时间字段被污染**，`timestamp()` 反解出的毫秒值不再单调（`now / 0x1000` 会被抬高），`latest()` / `filterCompacted()` 依赖 ID 排序的逻辑可能错序。正常流量打不到 4096/ms，但并发 fork/part 批量生成场景存在理论触发。
- **建议**：`if (++counter > 0xFFF) { lastTimestamp++; counter = 0 }`（进位到下一毫秒）。

### 1.4 `id/id.ts:46` / `schema/identifier.ts:29` — `bytes[i] % 62` 模偏差

- **问题**：`randomBytes` 产生 0-255 均匀分布，`% 62` 使 0-7（前 8 个）多映射一次，字符 `"01234567"` 出现概率略高于其余 54 个（约 4.23% vs 4.03%）。非安全场景（ID 不用于加密），影响可忽略，但 `crypto.getRandomValues` 说明作者在意随机性，值得用经典 `rejection sampling` 消除。
- **影响**：极低。列为 P2/P3 边界。

---

## 二、P2（建议，低风险但值得修）

### 2.1 `compaction.ts:276` — `input.messages[start]!` 非空断言依赖循环不变式

```ts
for (let start = input.turn.start + 1; start < input.turn.end; start++) {
  ...
  return { start, id: input.messages[start]!.info.id }
}
```

- `start < input.turn.end` 且消息数组下标与 turn 区间一致时安全；若上层 `turn` 与 `messages` 长度不同步（compaction 重排后）可能越界。当前调用方保证一致，列为防御性加固点。

### 2.2 `provider.ts:880` / `snowflake-cortex.ts:397` / `core/plugin/provider/snowflake-cortex.ts:24` — `!response.ok && response.status === 400` 冗余

- `!ok` 已蕴含 status ∈ {4xx, 5xx}，`&& status === 400` 是重复判断。无逻辑错误（意图是"仅在 400 时特判 conversation complete"），但写成 `response.status === 400` 更清晰。三处同款，建议统一。

### 2.3 `memory/dream-runner.ts:16` / `hermes-bridge.ts:57` — 原子写失败遗留 `.tmp` 孤儿文件

- `writeFile(tmp)` 成功后 `rename(tmp, final)` 失败（如目标被占用）会遗留 `.tmp.<ts>` 临时文件，且不重试。长期运行会累积垃圾文件。建议失败时 `rm(tmp, {force:true})` 兜底清理。

### 2.4 `lsp/server.ts:858` — SourceKit 扩展名 `"objcpp"` 缺少点号

```ts
extensions: [".swift", ".objc", "objcpp"],   // line 858
```

- 应为 `".objcpp"`（文件匹配会按 `file.endsWith(ext)` 之类逻辑判断，无点号导致 `.objcpp` 文件永远匹配不上）。其它所有 entry 的 extensions 都带点号，此处是笔误。

### 2.5 `lsp/server.ts:1246` — JDTLS `mkdtemp` 临时数据目录不清理

- `dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "gyccode-jdtls-data"))` 每次 spawn 创建，进程退出/崩溃后目录残留（Java 工程缓存可达数百 MB）。建议退出时 `rm(dataDir, {recursive:true, force:true})`。

### 2.6 `mcp/browser.ts:19-30` — `open()` 竞态吞错

- `setTimeout 500ms` 兜底 resume void 后，若 subprocess 在 500ms 后以非 0 码退出，错误被吞（callback 已 resolve）。`open` 库通常很快退出，影响极小；可将超时后置 `subprocess.removeAllListeners()` 防止误吞。

### 2.7 `mcp/transport-ide.ts:63-74` — `getEditorCommand` 直接把 `args.line/column` 拼进 shell 命令

- `code --goto "${args.file}:${args.line}:${args.column}"` — 若 `args` 含 `"; rm -rf ~"` 之类内容会拼出恶意命令。当前 **没有证据表明 args 会来自不可信输入**（IDE 扩展内部调用），但作为"可执行字符串拼接"应加参数化/白名单校验。

---

## 三、P3（理论风险 / 风格）

### 3.1 `message-v2.ts:77` — 模块级 `truncationDecisions` Map 跨会话理论串扰

```ts
const truncationDecisions = new Map<string, { cutoff: PartID | undefined }>()
```

- 按 callID 冻结截断决策以保证 prompt-cache 前缀字节稳定。callID 为 ulid 全局唯一，实际碰撞概率极低；但多会话并行时该 Map 不清理即可无限增长（取决于是否有清理路径）。compaction/microcompact 已调用 `resetTruncationDecisions()`，建议确认该 reset 覆盖所有退出路径。

### 3.2 `prompt.ts:1298` — Resume 提示文案含乱码字符

```ts
text: "Output token limit hit. Resume directly from where you left off  no apology, no repetition."
```

- 中间的 `` 是 UTF-8 编码损坏的连字符（应为 `—` 或 `–`）。会原样注入模型提示词，属于显示质量问题，不影响功能。

### 3.3 `id.ts` `randomBase62` 与 `schema/identifier.ts` 重复实现

- 两处 26 位 ID 生成逻辑几乎一致（hex 时间 + base62 随机），但 `schema/identifier.ts` 用 `crypto.getRandomValues`、`gyccode/id/id.ts` 用 `randomBytes`。若未来改 one 不改 other，两套 ID 语义会漂移。建议收敛为单一实现。

---

## 四、已排查确认「无 bug」的高频模式（防止误报）

| 模式 | 结论 |
|---|---|
| `src/gyccode/session` 下 `Promise.all`（prompt.ts:1872 shell 并行） | `${!}`/`bashRegex` 正则无 lastIndex 状态残留，`replace` 回调顺序 == `Promise.all` 完成顺序，无错序 |
| 全项目 `catch{}` 空捕获（138+ 处） | 均为 JSON 解析/防御性清理（`parseMessage`/`readHermesMemories` 等），无异常吞没 |
| `.clear()`（176 处） | 多为 TUI dialog 状态机合理用法 |
| `setTimeout`/`setInterval`（66+ 处） | 均有 onCleanup/clearTimeout 配对；`acp/service.ts:968` 的 `setTimeout(0)` 是刻意延迟 |
| `as any`（99+ 处） | 集中在测试文件（`*.test.ts`）与插件边界（`registry.ts:168` 的 `args as any` 是刻意兼容） |
| `structuredClone`（25 处） | 事件发布防变异，正确 |
| `sql.raw`（10 处） | 仅 CLI 管理命令（`db.ts`）与 ORM 内部，无用户输入直达 |
| `@ts-expect-error`（session.ts:353/355、message-v2.ts:528） | 跨 provider 元数据（bedrock/venice 缓存 token）的结构性降级访问，均有注释说明 |
| `Effect.catchCause` 作为 fire-and-forget 日志（其余 40+ 处） | 仅 prompt.ts:456 这一处污染了返回值类型，其余位置不使用返回值或类型消解正确 |
| codemode interpreter | 无 eval/new Function/with 逃逸；三重限制（timeoutMs / maxToolCalls / maxOutputBytes）完备；`copyBounded` 防深度/循环/原型篡改；`for...in/of` 限定类型 |
| lsp/client.ts debounce/timeout | `finished` 标志 + 双定时器清理 + 监听器反注册，无泄漏 |
| MCP OAuth（oauth-callback.ts） | state 参数强制校验 + 5min 超时 + 反向索引，防 CSRF 完备 |
| server 认证（authorization.ts） | PTY ticket 绕过有 handler 端消费校验兜底，非裸绕过 |

---

## 五、审查覆盖矩阵

| 区域 | 文件 | 深拷/扫描 | 结论 |
|---|---|---|---|
| 会话核心 | prompt.ts(2066)/compaction.ts/message-v2.ts/session.ts/processor.ts/llm.ts | ✅ 逐段 | 见 P1.1 / P2.1 |
| 记忆 | summary.ts/instruction.ts/hermes-bridge.ts/dream-runner.ts | ✅ | P2.3 |
| 工具 | tools.ts/shell.ts/edit.ts/todo.ts/webfetch.ts/code-mode.ts/task.ts/swarm.ts/grep/glob/read | ✅ | code-mode 权限链完整 |
| MCP | index.ts/transport-ws/oauth-provider/callback/auth/catalog/browser | ✅ 逐行 | P1.2 / P2.6 / P2.7 |
| codemode | interpreter/runtime.ts(140KB)/tool-runtime/tool-schema/values/stdlib | 抽查核心 | 防御完备，无逃逸 |
| LSP | server.ts(1983)/client.ts/lsp.ts/launch | ✅ 逐行 server | P2.4 / P2.5 |
| 协议/LLM | openai-chat/openai-responses/provider.ts | ✅ | P2.2 |
| server 路由 | routes.ts/handlers/middleware | ✅ | 认证正确 |
| plugin | loader.ts/install/shared/github-copilot/snowflake | ✅ | 加载/重试严谨 |
| TUI | routes/session(88KB)/keybind/theme/component | 抽查核心 | 防御性 catch 为主，无害 |
| 基础 | id.ts/identifier.ts/flock.ts/process.ts | ✅ | P1.3 / P1.4 / P3.3 |

---

## 六、修复优先级建议

1. **P1.1**（唯一编译器 ERROR）→ 立即可修，影响构建置信度与后续 lint。
2. **P1.2**（Windows MCP 进程泄漏）→ 复用 `util/process.ts` 的 `taskkill /T /F`，改动小收益明确。
3. **P1.3 / P1.4**（ID 模块）→ 顺手修，改动 3 行。
4. P2 各项均为小改动，可随重构批次消化。