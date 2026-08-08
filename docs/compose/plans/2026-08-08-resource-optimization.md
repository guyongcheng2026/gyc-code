# 资源优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将系统内存占用从 87.2% 降至 ≤80% 铁律以下（释放 ~290MB+），通过 Bun --smol + SessionData dispose 两个关键改动。

**Architecture:** 两个独立改动，无相互依赖。(1) bin/gyc 启动脚本加 `--smol` 约束 Bun heap 增长；(2) SessionData 增加 dispose() 方法并在 session 生命周期结束时调用，释放累积的 Map/Set 内存。

**Tech Stack:** Bun, TypeScript, Effect

**实际范围:** 设计 4 项中 S3（heap snapshot）和 S4（LLM chunks）经验证已无需改动：
- S3: `GYCCODE_AUTO_HEAP_SNAPSHOT` flag 默认 off（`truthy()` 只在 env=true/1 时才启用）
- S4: `flush()` + `flushFragments()` 已在正常/异常路径完整覆盖，chunks Map 由 per-turn 闭包 GC 释放

仅实施 S1 + S2。

---

### Task 1: bin/gyc 添加 --smol 启动参数

**Covers:** [S1]

**Files:**
- Modify: `bin/gyc:27-29`

- [ ] **Step 1: 修改 dist 模式 args**

```js
const args = fs.existsSync(distEntry)
  ? ["--smol", entry, ...process.argv.slice(2)]
  : ["--smol", "run", "--preload", preload, "--conditions=browser", entry, ...process.argv.slice(2)]
```

说明：`--smol` 是 Bun 官方 flags（运行于 smol 内存模式），放在脚本 entry 之前。dist 和 source 两条路径均需添加。

- [ ] **Step 2: 验证 bin/gyc 语法正确**

Run: `node -e "require('child_process').spawnSync(process.execPath, ['-e', require('fs').readFileSync('bin/gyc','utf8')], {stdio:'inherit'})"`（语法检查）

- [ ] **Step 3: Commit**

```bash
git add bin/gyc
git commit -m "perf: bun --smol 启动参数降低内存占用"
```

---

### Task 2: SessionData 添加 dispose 方法并集成到生命周期

**Covers:** [S2]

**Files:**
- Modify: `src/gyccode/cli/cmd/run/session-data.ts`（在 createSessionData 后追加 disposeSessionData）
- Modify: `src/gyccode/cli/cmd/run/stream.transport.ts`（在 session 切换/结束时调用 disposeSessionData）

- [ ] **Step 1: 在 session-data.ts 添加 disposeSessionData 导出**

在 `createSessionData` 函数后面（约 115 行附近），添加：

```typescript
/** 释放 SessionData 内所有 Map/Set/Array 以回收内存。在 session 离开或 TUI 退出时调用。 */
export function disposeSessionData(data: SessionData): void {
  data.ids.clear()
  data.tools.clear()
  data.call.clear()
  data.shell.clear()
  data.role.clear()
  data.msg.clear()
  data.part.clear()
  data.text.clear()
  data.sent.clear()
  data.visible.clear()
  data.end.clear()
  data.echo.clear()
  data.permissions.length = 0
  data.questions.length = 0
}
```

- [ ] **Step 2: 在 stream.transport.ts 导入 disposeSessionData**

在 import 区域（第 22-27 行）添加 `disposeSessionData`：

```typescript
import {
  blockerStatus,
  bootstrapSessionData,
  createSessionData,
  disposeSessionData,
  flushInterrupted,
  pickBlockerView,
  reduceSessionData,
  type SessionData,
} from "./session-data"
```

- [ ] **Step 3: 在两处 state.data 替换点前调用 disposeSessionData**

`state.data` 在 `stream.transport.ts` 中有两处被替换为新对象（非 in-place 更新）：

**位置 1 —— 第 733-735 行（history 加载时替换）：**
```typescript
          if (history) {
            disposeSessionData(state.data)   // ← 新增：释放旧 data
            state.data = history.data
          }
```

**位置 2 —— 第 1087-1088 行（snapshot replay 时替换）：**
```typescript
          disposeSessionData(state.data)     // ← 新增：释放旧 data
          state.data = snapshot.value.history.data
```

注意：第 905 行 `state.data = next.data` 是 reduceSessionData 返回的**同一引用**（mutate in place），**不需** dispose。

- [ ] **Step 4: 验证构建通过**

Run: `bun run build.mjs`
Expected: `build done`

- [ ] **Step 5: 验证类型检查**

Run: `bun run src/gyccode/cli/cmd/run/session-data.ts` 语法检查（或 tsc --noEmit 部分文件）

- [ ] **Step 6: Commit**

```bash
git add src/gyccode/cli/cmd/run/session-data.ts src/gyccode/cli/cmd/run/stream.transport.ts
git commit -m "perf: SessionData dispose 释放 session 切换时 Map/Set 内存"
```

---

### Task 3: 全量验证与内存复查

**Covers:** 整体验证

- [ ] **Step 1: 构建**

Run: `bun run build.mjs`
Expected: `build done`

- [ ] **Step 2: 退出当前 gyc，重启 gyc（加载新 dist + --smol）**

用户手动操作：在当前 TUI 中退出（Ctrl+C 两次），然后运行 `gyc`

- [ ] **Step 3: 8 秒空闲 CPU + WorkingSet 采样**

Run: `Get-Process -Name bun,gyc -ErrorAction SilentlyContinue | Select Id, ProcessName, @{N='WS_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}}, @{N='Priv_MB';E={[math]::Round($_.PrivateMemorySize64/1MB,1)}}`

- [ ] **Step 4: 全系统内存占用复查**

Run: `Get-CimInstance Win32_OperatingSystem | Select @{N='UsedPct';E={[math]::Round(($_.TotalVisibleMemorySize-$_.FreePhysicalMemory)/$_.TotalVisibleMemorySize*100,1)}}`

Expected: ≤80%

- [ ] **Step 5: Commit 工作记录**

如达标，提交工作记录。

---

## 自审

1. **Spec coverage:** S1 → Task 1, S2 → Task 2, 整体验证 → Task 3 ✓
2. **Placeholder scan:** 无 TBD/TODO，每步代码完整 ✓
3. **Type consistency:** disposeSessionData 签名 `(data: SessionData): void`，与 createSessionData 返回值一致 ✓
