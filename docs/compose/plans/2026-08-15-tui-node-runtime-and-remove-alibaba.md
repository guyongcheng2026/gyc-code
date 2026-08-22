# TUI 迁移 Node 运行时 + 删除 alibaba 提供商 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 gyc TUI 从 Bun 运行时迁移到 Node 运行时（解决 1.6GB 常驻内存），并在迁移过程中删除 alibaba / alibaba-cn 提供商及其全部模型。

**Architecture:**
- 根因：`bin/gyc` 的"进程链扁平化"分支在 `tui`/`--mini`/`-i` 命令下强制 import `dist-bun`（Bun 目标），使 TUI 跑在 Bun 运行时（常驻 1.6GB 私有内存）。已验证 OpenTUI 原生 FFI（`opentui.dll` + `koffi`）、`win32-kernel` 双实现（`#win32-kernel` 条件导出）、`rpc.ts` 的 `worker_threads` 兜底在 Node 下全部可用——即 **TUI 的 Node 兼容障碍已被先前迁移铺平**，只需删除强制 Bun 的分支。
- 删除 alibaba：从 `models-dev-snapshot.ts`（自动生成，通过白名单脚本）+ `transform.ts` 的 alibaba 专属逻辑 + `build.mjs`/`verify-external.mjs` 的 `@ai-sdk/alibaba` 冗余项清理。通用 `qwen` 判断逻辑保留（90+ 提供商含 qwen 模型）。

**Tech Stack:** bun build.mjs（双目标构建）、bin/gyc 启动器、Node v25 + koffi + OpenTUI、models-dev 快照生成脚本。

---

### Task 1: 验证 Node 目标下 TUI 可启动（可行性闸门）

**Covers:** 方案 A 可行性

**Files:**
- Verify: `C:\Users\谷勇成\gyc-cli\dist\index.js`（node 目标已构建）
- Verify: `C:\Users\谷勇成\gyc-cli\dist\cli\tui\worker.js`（node 目标含 TUI worker）
- Verify: `C:\Users\谷勇成\gyc-cli\node_modules\koffi` + `@koromix/koffi-win32-x64`（已装）

- [ ] **Step 1: 用 node 直接运行 dist 的 tui worker，确认 worker_threads 路径可用**

```bash
node -e "import('./dist/cli/tui/worker.js').then(()=>console.log('worker OK')).catch(e=>{console.error('FAIL',e);process.exit(1)})"
```

Expected: 打印 `worker OK`（worker.ts 顶层只注册 RPC，不启动 server，应能 import 成功）

- [ ] **Step 2: 验证 koffi 加载 opentui.dll（Node FFI 路径）**

```bash
node -e "import koffi from 'koffi'; import dll from '@opentui/core-win32-x64'; const lib=koffi.load(dll); console.log('symbols:', Object.keys(lib).slice(0,5).join(','))"
```

Expected: 打印 `symbols: cdecl,stdcall,fastcall,thiscall`（已在项目内验证通过）

- [ ] **Step 3: 结论记录**

如果 Step 1+2 均通过 → 方案 A 可行，继续 Task 2。
如果 Step 1 失败 → 记录错误，方案 A 需回退（保留 dist-bun 分支，仅加 `--smol` + 删除 alibaba），并在报告中说明。

---

### Task 2: 删除 bin/gyc 的 dist-bun 扁平化分支

**Covers:** 方案 A 核心改动

**Files:**
- Modify: `C:\Users\谷勇成\gyc-cli\bin\gyc`

- [ ] **Step 1: 移除 tui/--mini/-i 强制 dist-bun 的分支**

删除 `bin/gyc` 中 `main()` 的这段（Bun 运行时分支内、`readRuntimeMarker(path.dirname(distEntry)) === "bun"` 之后）：

```js
    const args = process.argv.slice(2)
    const first = args.find((a) => !a.startsWith("-"))
    // 进程链扁平化（省 ~300MB 中间层内存）：TUI/mini 依赖 OpenTUI（仅 Bun），
    // 直接在本进程 import dist-bun 运行，跳过 node(dist) 与 bun 跳板两层；
    // dist-bun 缺失时回退到 Node 路径（由 index.ts 再提升到 Bun）。
    const distBunEntry = path.join(here, "..", "dist-bun", "index.js")
    if ((first === "tui" || args.includes("--mini") || args.includes("-i")) && existsSync(distBunEntry)) {
      await import(pathToFileURL(distBunEntry).href)
      return
    }
    spawnBun(findNode(), [distEntry, ...args])
    return
```

替换为（直接走 Node 子进程跑 node 目标 dist）：

```js
    spawnBun(findNode(), [distEntry, ...process.argv.slice(2)])
    return
```

- [ ] **Step 2: 更新文件顶部注释**

将顶部注释中 `// Bun runtime: import the bundle in-process (avoids node->bun double spawn, cold start ~2.9s -> ~0.9s on this machine). Node runtime (npm global shim): spawn the Bun runtime as before.` 更新为说明 TUI 已统一走 Node 目标（OpenTUI 经 koffi 在 Node 下可用），移除对 dist-bun 的引用。

- [ ] **Step 3: 删除 build.mjs 的 dist-bun 双构建**

在 `C:\Users\谷勇成\gyc-cli\build.mjs` 中，将：

```js
if (runtime === "node") {
  await buildOnce("node", "./dist")
  await buildOnce("bun", "./dist-bun")
} else {
  await buildOnce("bun", "./dist")
}
```

改为只构建 node 目标（TUI 已走 Node）：

```js
if (runtime === "node") {
  await buildOnce("node", "./dist")
} else {
  await buildOnce("bun", "./dist")
}
```

同时更新 build.mjs 顶部注释（移除"bun 目标 → dist-bun 跑 TUI"的说明）。

- [ ] **Step 4: 验证构建**

Run: `bun run build`
Expected: 构建成功，`dist/RUNTIME = node`，不再生成 `dist-bun/`

- [ ] **Step 5: 提交**

```bash
git add bin/gyc build.mjs
git commit -m "perf: TUI 迁移 Node 运行时，移除 dist-bun 扁平化分支（OpenTUI 经 koffi 支持 Node）"
```

---

### Task 3: 清理 bin/gyc 的 bun 启动路径（--smol 与统一）

**Covers:** 方案 B（--smol）+ 一致性

**Files:**
- Modify: `C:\Users\谷勇成\gyc-cli\bin\gyc`

- [ ] **Step 1: 保留并统一 --smol**

bin/gyc 已有两处 `--smol`（node 无 dist 回退、bun 无 dist 回退的 dev 路径）。这些保留。Node 目标 dist 直跑路径（`await import(pathToFileURL(distEntry).href)`）不需要 --smol（Node V8 有独立 GC 控制）。

- [ ] **Step 2: 验证 dev 路径**

Run: `bun bin/gyc --help`（无 Bun 时走 node）
Run: `node bin/gyc --help`（有 Bun 时走 node 子进程）
Expected: 两条命令均输出 CLI help，无报错

- [ ] **Step 3: 提交**

```bash
git add bin/gyc
git commit -m "chore: 统一 TUI/CLI 运行时到 Node，保留 --smol dev 回退"
```

---

### Task 4: 从模型快照生成白名单删除 alibaba

**Covers:** 删除 alibaba 数据（自动生成链路）

**Files:**
- Modify: `C:\Users\谷勇成\gyc-cli\scripts\gen-models-snapshot.mjs`
- Regenerate: `C:\Users\谷勇成\gyc-cli\src\core\models-dev-snapshot.ts`
- Modify: `C:\Users\谷勇成\gyc-cli\models-mirror\api.json`（源数据）

- [ ] **Step 1: 从白名单移除 alibaba**

在 `scripts/gen-models-snapshot.mjs` 第 21 行，将：

```js
  "zhipuai", "deepseek", "moonshotai", "moonshotai-cn", "alibaba", "alibaba-cn",
```

改为：

```js
  "zhipuai", "deepseek", "moonshotai", "moonshotai-cn",
```

- [ ] **Step 2: 从 models-mirror/api.json 删除 alibaba / alibaba-cn 键**

用 node 脚本从 `models-mirror/api.json` 删除 `alibaba`、`alibaba-cn` 两个顶层键（含 `alibaba-token-plan`、`alibaba-token-plan-cn`、`alibaba-coding-plan`、`alibaba-coding-plan-cn`？—— 这些是独立提供商，按用户"删除 alibaba 提供商"意图，主 alibaba/alibaba-cn 为准；token-plan/coding-plan 属套餐型，询问用户或一并删除，见 Task 7 决策点）。

Run（仅主 alibaba/alibaba-cn）:
```bash
node -e "
const fs=require('fs');const f='models-mirror/api.json';
const j=JSON.parse(fs.readFileSync(f,'utf8'));
delete j['alibaba'];delete j['alibaba-cn'];
fs.writeFileSync(f, JSON.stringify(j,null,2),'utf8');
console.log('deleted alibaba, alibaba-cn');
"
```

- [ ] **Step 3: 重新生成快照**

Run: `bun scripts/gen-models-snapshot.mjs`
Expected: 输出新的快照文件，供应商数从 32 减到 30，模型数减少约 120

- [ ] **Step 4: 验证快照无 alibaba**

Run: `Select-String -LiteralPath src/core/models-dev-snapshot.ts -Pattern 'alibaba'`
Expected: 无匹配

- [ ] **Step 5: 提交**

```bash
git add scripts/gen-models-snapshot.mjs models-mirror/api.json src/core/models-dev-snapshot.ts
git commit -m "chore: 移除 alibaba/alibaba-cn 提供商及其模型（快照白名单+镜像源）"
```

---

### Task 5: 清理 transform.ts 的 alibaba 专属逻辑

**Covers:** 删除 alibaba 硬编码

**Files:**
- Modify: `C:\Users\谷勇成\gyc-cli\src\gyccode\provider\transform.ts`

- [ ] **Step 1: 删除 alibaba cacheControl 块（L336-338）**

删除：

```ts
    alibaba: {
      cacheControl: { type: "ephemeral" },
    },
```

注意：保留 `openaiCompatible` 块（alibaba 走 openai-compatible，其缓存行为由通用块覆盖）。

- [ ] **Step 2: 删除 alibaba-cn thinking 块（L1169-1181）**

删除：

```ts
  // Enable thinking for reasoning models on alibaba-cn (DashScope).
  // DashScope's OpenAI-compatible API requires `enable_thinking: true` in the request body
  // to return reasoning_content. Without it, models like kimi-k2.5, qwen-plus, qwen3, qwq,
  // deepseek-r1, etc. never output thinking/reasoning tokens.
  // Note: kimi-k2-thinking is excluded as it returns reasoning_content by default.
  if (
    input.model.providerID === "alibaba-cn" &&
    input.model.capabilities.reasoning &&
    input.model.api.npm === "@ai-sdk/openai-compatible" &&
    !modelId.includes("kimi-k2-thinking")
  ) {
    result["enable_thinking"] = true
  }
```

- [ ] **Step 3: 保留 qwen 通用逻辑**

保留 L487（`if (id.includes("qwen")) return 0.55`）、L506（`if (id.includes("qwen")) return 1`）、L757（`id.includes("qwen") ||`）——这些服务于 90+ 提供商的 qwen 模型，与 alibaba 无关，**不删除**。

- [ ] **Step 4: 类型检查**

Run: `bun tsc --noEmit`（或 `node tsc --noEmit`，按项目 tsconfig）
Expected: 0 错误

- [ ] **Step 5: 提交**

```bash
git add src/gyccode/provider/transform.ts
git commit -m "chore: 清理 transform.ts 中 alibaba/alibaba-cn 专属请求逻辑"
```

---

### Task 6: 清理 build.mjs 与 verify-external.mjs 的 @ai-sdk/alibaba

**Covers:** 冗余 external 清理

**Files:**
- Modify: `C:\Users\谷勇成\gyc-cli\build.mjs`
- Modify: `C:\Users\谷勇成\gyc-cli\scripts\verify-external.mjs`

- [ ] **Step 1: 从 build.mjs external 删除 @ai-sdk/alibaba**

删除 build.mjs 第 62 行 `"@ai-sdk/alibaba",`。

- [ ] **Step 2: 从 verify-external.mjs 删除 @ai-sdk/alibaba**

删除 verify-external.mjs 第 36 行 `"@ai-sdk/alibaba",`。

- [ ] **Step 3: 验证**

Run: `bun run build`
Expected: 构建成功（确认无代码引用 @ai-sdk/alibaba）

- [ ] **Step 4: 提交**

```bash
git add build.mjs scripts/verify-external.mjs
git commit -m "chore: 移除 @ai-sdk/alibaba external（源码零引用）"
```

---

### Task 7: 全量验证与回归

**Covers:** 验收

**Files:**
- Verify: 全部改动

- [ ] **Step 1: 全量测试**

Run: `bun run test`
Expected: 全绿（历史基线 460 pass / 3 pre-existing fail，确认无新增失败）

- [ ] **Step 2: 构建产物验证**

Run: `bun run build`
Expected: 成功，dist 为 node 目标，无 dist-bun

- [ ] **Step 3: 冷启动计时**

Run: `node bin/gyc --help` 计时
Expected: 功能正常输出 help

- [ ] **Step 4: 确认内存收益（部署后）**

安装新构建到全局，启动 `gyc tui`，对比私有内存：
Expected: 从 ~1.6GB 降至 ~600-900MB（Node 常驻 + 渲染层）

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: TUI 迁移 Node 运行时并移除 alibaba 提供商"
```

---

### Task 8: 部署全局安装 + 记录

**Covers:** 交付

**Files:**
- Deploy: 全局安装 `C:\Users\谷勇成\.bun\install\global\node_modules\gyc-code`

- [ ] **Step 1: 重新打包并安装全局**

Run（按项目发布流程）: `bun run build && bun link` 或 npm pack + 全局安装
Expected: 全局 bin/gyc 指向新的 node 目标 dist

- [ ] **Step 2: 终止旧 Bun 实例，验证新实例内存**

终止 PID 9008/10592 旧进程，重新 `gyc tui`，采样内存确认下降。

- [ ] **Step 3: 记录到 Obsidian 工作流水 + docs**

按 AGENTS.md 铁律：总结、归纳、学习、进化，记录 Node 迁移收益与 alibaba 删除。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "docs: 记录 TUI Node 迁移与 alibaba 移除结果"
```

---

## 决策点（需用户确认或自主决定）

1. **套餐型 alibaba 提供商**（`alibaba-token-plan`/`alibaba-token-plan-cn`/`alibaba-coding-plan`/`alibaba-coding-plan-cn`）：这些是独立的套餐/令牌提供商，不在模型快照白名单内（不影响内置快照），但存在于 models-mirror/api.json。按用户"删除 alibaba 提供商"意图，建议一并从 api.json 删除（它们依赖 alibaba API）。Task 4 默认只删主 alibaba/alibaba-cn；若用户确认，扩展删除套餐型。
2. **回退策略**：若 Task 1 验证 node 跑 TUI 失败，回退为仅加 `--smol` + 删除 alibaba（保留 dist-bun 分支），并在报告说明。
