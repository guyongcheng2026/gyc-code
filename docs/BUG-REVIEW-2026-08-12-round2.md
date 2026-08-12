# gyc-cli 第二轮审查报告（2026-08-12）— 模拟真实业务系统性验证

> 触发：`@command://cr 再详细找一遍bug,模拟真实业务进行系统性的操作和验证`
> 方法：全量构建 + 测试套件 + 真实业务链路逐段追踪（CLI 启动 → .env 加载 → 会话创建 → LLM 调用 → 工具执行 → 文件编辑 → 会话恢复）
> 分级：P0（阻断/严重）/ P1（重要）/ P2（建议）

---

## 一、本轮发现并修复

### 1.1 `id.ts:69` — P1.3 修复引入 `const` 重赋值构建错误（P0 阻断）

```ts
const now = BigInt(lastTimestamp) * BigInt(0x1000) + BigInt(counter)  // line 69
now = direction === "descending" ? ~now : now                          // line 71 ← ERROR
```

- **问题**：第一轮 P1.3 重写 `create()` 时将原 `let now` 误改为 `const now`，但 line 71 对其重新赋值。Bun 构建直接报错 `Cannot assign to "now" because it is a constant`。
- **影响**：**构建完全阻断**，`bun build.mjs` 失败，无法产出 dist。
- **修复**：`const now` → `let now`。
- **验证**：`bun build.mjs` 成功，`bun dist/index.js --version` 输出 `0.0.1`。

### 1.2 `schema/identifier.ts:14-21` — P1.3 计数器溢出进位未同步（P1 遗漏）

```ts
// 修复前：
if (timestamp !== lastTimestamp) { lastTimestamp = timestamp; counter = 0 }
counter++
const current = BigInt(timestamp) * 0x1000n + BigInt(counter)  // 无 0xfff 上限
```

- **问题**：第一轮 P1.3 明确点名 `id/id.ts` 和 `schema/identifier.ts` 两个文件，但只修了前者。`identifier.ts` 仍无 `> 0xfff` 进位逻辑，且重置条件仍为 `!==`（时钟回拨不安全）。
- **影响**：与 P1.3 相同——同毫秒超 4096 个 ID 时时间字段被污染，`timestamp()` 反解不单调。
- **修复**：补齐进位逻辑 + `!==` → `>`，与 `id.ts` 完全对齐。

### 1.3 `index.ts:16-22` — `.env` 解析器不剥离引号（P1 新发现）

```ts
// 修复前：
const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
```

- **问题**：标准 dotenv 惯例 `API_KEY="sk-abc123"` 应存为 `sk-abc123`，但此解析器将引号原样保留。实测验证：
  - `API_KEY="sk-abc123"` → `"sk-abc123"`（含引号）
  - `TOKEN='secret-value'` → `'secret-value'`（含引号）
  - `SPACED=  padded  ` → `"padded  "`（行尾空白未剥离，贪婪 `(.*)` 吞掉 `\s*$`）
- **影响**：用户在 `~/.gyc/.env` 中按惯例给 API key 加引号 → 认证请求携带错误 key → 所有 LLM 调用 401。这是**用户首次配置必然踩到的坑**。
- **修复**：
  1. `m[2].trim()` 剥离行尾空白
  2. 检测成对首尾引号（双引号或单引号）并剥离

---

## 二、本轮观察到的 P2（未修，记录备查）

### 2.1 `edit.ts:36` — 模块级 `locks` Map 无上限增长

```ts
const locks = new Map<string, Semaphore.Semaphore>()
```

- 每个被编辑过的文件路径创建一个 Semaphore，永不清理。长时间运行的 TUI 会话（数百次编辑不同文件）会累积。单个 Semaphore 极小（~100 bytes），实际影响可忽略，但与 `read-cache.ts` 的 MAX_ENTRIES=200 LRU 模式不一致。

### 2.2 `read-cache.ts:32` — `readSet` Set 无上限增长

```ts
const readSet = new Set<string>()
```

- `map` 有 MAX_ENTRIES=200 LRU 淘汰，但 `readSet`（read-before-write 守卫）只增不减。理论上无限增长，实际每条仅一个路径字符串，影响极小。

---

## 三、真实业务链路验证结果

| 链路 | 验证方式 | 结果 |
|---|---|---|
| CLI 启动 → `--version` | `bun dist/index.js --version` | ✅ 输出 `0.0.1` |
| `.env` 加载 | 正则模拟 + 修复后逻辑验证 | ✅ 修复后正确剥离引号和空白 |
| 会话创建/恢复 | `run.ts` session() 逻辑追踪 | ✅ `--continue` 按 `desc(time_updated)` 排序取最新 |
| LLM 流式超时 | `llm-timeout.ts` 审查 | ✅ idle/first-token/concurrency 三级保护完备 |
| 重试策略 | `retry.ts` 审查 | ✅ 5 次上限 + 2 分钟总时长 + retry-after 解析 + 放弃阈值 |
| 文件编辑 | `edit.ts` 全链路 | ✅ TOCTOU 防护 + 锁 + read-before-write + BOM 保持 |
| 上下文溢出 | `overflow.ts` 审查 | ✅ 三级告警对齐 Claude Code |
| Compaction | `compaction.ts` 审查 | ✅ 连续失败熔断 + truncationDecisions reset |
| MCP 进程清理 | `mcp/index.ts` finalizer | ✅ win32 taskkill /T/F + unix pgrep+SIGTERM |
| 构建 | `bun build.mjs` | ✅ 成功 |
| 测试 | `bun test` | ✅ 395 pass / 0 fail / 896 expect() |

---

## 四、修复文件清单

| 文件 | 修改内容 |
|---|---|
| `src/gyccode/id/id.ts:69` | `const now` → `let now`（修复构建阻断） |
| `src/schema/identifier.ts:14-21` | 补齐 P1.3 计数器溢出进位 + 时钟回拨防护 |
| `src/gyccode/index.ts:16-32` | `.env` 解析器：trim + 引号剥离 |

---

## 五、结论

第二轮"模拟真实业务"审查发现了第一轮静态扫描无法覆盖的 **构建阻断 bug**（P1.3 修复自身引入的 `const` 重赋值）和 **用户首次配置必踩的 .env 解析 bug**。三处修复均已通过构建验证和 lint 检查。测试套件 395/395 全部通过。
