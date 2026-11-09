# 问题1：`evaluate` 用 await 前读取的过期 `entry` 整体回写 store，判官运行期间的 `set`/`bumpReact`/`clear` 更新被覆盖，会话已删除时还会重新插入幽灵状态 2级
## 问题1分析:
`GoalService.evaluate`（src/gyccode/session/goal.ts:195-221）的读改写不是原子的：

1. **读**：`const entry = store.get(sessionID)`（goal.ts:197）；
2. **await**：`await Effect.runPromise(options.judge(...))`（goal.ts:204）——LLM 判官调用，秒级耗时，且 `Effect.runPromise` 脱离当前 fiber 运行（goal.ts:204，发布侧同样 goal.ts:162），外层 `Effect.forkIn(scope)`（src/gyccode/session/prompt.ts:1947）**无法中断**它；
3. **写**：`store.set(sessionID, { ...entry, lastVerdict: verdict })`（goal.ts:216）——用第 1 步的**旧快照整体覆盖**。

窗口内的三类并发写入全部被回滚：
- `set`（goal.ts:172-178）在 judge 运行中换了 `condition`/`react: 0` → 216 行用旧 `condition`、旧 `react` 覆盖，**新目标被旧目标顶回**，且对旧 condition 的裁决被挂到新目标上（`attempt` 也基于旧 `entry.lastVerdict` 计算，goal.ts:200）；
- `bumpReact`（goal.ts:188-192）在 judge 运行中 +1 → 被 216 行回退，`decideGoalAction` 的 `state.react >= MAX_GOAL_REACT`（goal.ts:109）计数失真；
- `clear`（goal.ts:182-185）或 `Session.remove` 的 `Goal.clearSession`（src/gyccode/session/session.ts:650）在 judge 运行中删除了该 key → 216 行 `store.set` **把已删除的条目重新插回**，形成无人清理的幽灵 goal 状态（只可能被 instance disposer 按 directory 兜底，goal.ts:59-64；`Session.remove` 已不会再跑第二次），并还会 `publish` 一条面向已删除会话的 `session.goal` 事件（goal.ts:218）。

根因是「脱离 fiber 的 `Effect.runPromise` + 非原子读改写」，两条候选问题（竞态回写、runPromise 失联导致的删除后复活）同源，合并为本条，判 2级。

### 问题1修复后的代码：
```diff
       const changed = !sameVerdict(entry.lastVerdict, verdict)
-      store.set(sessionID, { ...entry, lastVerdict: verdict })
+      // judge 是脱离当前 fiber 的 runPromise，期间 set/bumpReact/clear 都可能
+      // 改写 store：必须基于「最新」状态合并，且丢弃过期裁决。
+      const latest = store.get(sessionID)
+      if (!latest) return verdict // 目标已被 clear/Session.remove，裁决作废，禁止复活
+      if (latest.condition !== entry.condition) return verdict // 目标已更换，旧裁决不得挂到新目标
+      store.set(sessionID, { ...latest, lastVerdict: verdict })
       if (changed) {
         await publish(sessionID, { condition: entry.condition }, verdict)
       }
```
（配套建议：把 `publish` 也改用当前 fiber 内的 `yield*` 执行，或至少用 `latest.condition` 发布，避免 218 行把旧 condition 广播出去。）
---
# 问题2：`bumpReact` 每轮无条件累加，与「judge-driven re-entries」语义不符，判官首份裁决到达前就可能已耗尽 `MAX_GOAL_REACT` 提前退出 2级
## 问题2分析:
`GoalState.react` 的注释定义为「Number of **judge-driven** re-entries so far; bounded by MAX_GOAL_REACT」（goal.ts:29），`MAX_GOAL_REACT = 5`（goal.ts:90），`decideGoalAction` 在 `state.react >= MAX_GOAL_REACT` 时返回 `exhausted`（goal.ts:109-115）。

但实际接线是每轮主循环**无条件** `goal.bumpReact(sessionID)`（src/gyccode/session/prompt.ts:1951），紧接 `Goal.decideGoalAction(goal.get(sessionID))`（prompt.ts:1952）。问题在于：

1. `evaluate` 是 `Effect.forkIn(scope)` 异步执行的（prompt.ts:1945-1948），裁决**下一轮**才可能可见（prompt.ts:1949-1950 注释自述）；而 `bumpReact` 不等裁决就 +1。于是「等待判官」的轮次同样计入 react；
2. 判官慢或失败时，`verdict.error` 分支让 `decideGoalAction` 返回 `continue`（goal.ts:106），但 react 已在累加——等首份有效裁决（`ok:false`、非 impossible）真正到达时，`react` 可能已 `>= 5` → 立刻 `exhausted`（goal.ts:109），**判官实际只驱动了 0~1 次重入**就终止；
3. `set` 会把 react 归零（goal.ts:175），但目标一旦设定后没有其它重置入口，因此上述偏差无法被调用方纠正。

结果是「目标漂移控制」的重入预算被非判官轮次挤占，goal 提前被判死（表现为 `kind: "exhausted"`，prompt.ts:1954-1959 记 debug 后 break），与注释承诺的语义不一致。判 2级（逻辑错误，非崩溃）。

### 问题2修复后的代码：
```diff
           if (goal.get(sessionID)) {
             yield* Effect.promise(() => goal.evaluate({ sessionID })).pipe(
               Effect.ignore,
               Effect.forkIn(scope),
             )
-            const react = goal.bumpReact(sessionID)
+            // 仅在本轮确实消费到上一轮判官裁决时才计数，否则「等判官」的轮次
+            // 会挤占 MAX_GOAL_REACT 预算，导致首份裁决到达即 exhausted。
+            const hadVerdict = goal.get(sessionID)?.lastVerdict !== undefined
+            const react = hadVerdict ? goal.bumpReact(sessionID) : (goal.get(sessionID)?.react ?? 0)
             const action = Goal.decideGoalAction(goal.get(sessionID))
```
（若判官长期不返回，react 不再增长、不会 exhausted，此时由 prompt 循环既有的 `maxSteps`/token budget 上限兜底，不会造成无限循环。）
---
# 问题3：`publish` 用 `Effect.runPromise` 在 service 内另起运行时，`/goal` 命令的 `set`/`clear` 一旦事件发布失败会把错误直接抛给命令调用方 3级
## 问题3分析:
`make` 内的 `publish`（goal.ts:158-162）用 `Effect.runPromise(publishGoalUpdated(...))` 独立运行，脱离调用方 fiber：
- `set`（goal.ts:179）`await publish(...)`：失败会 reject → 在 prompt.ts:2000 被 `Effect.promise` 包装后成为 **defect**，直接打断 `/goal` 命令（此时 store 已写入，但用户看到报错）；
- `clear`（goal.ts:184）同样 `return publish(...)`；
- `evaluate` 里 `await publish`（goal.ts:218）在 `try` 之外，失败会 reject `evaluate`——好在 prompt.ts:1945-1946 用 `Effect.ignore` 兜住，但**同一条发布失败在三处的可见性不一致**（一处炸命令、一处被忽略），排查时容易误判。

与问题1 同根（脱离 fiber 的 `runPromise`），但影响面独立且可单独修复，故拆出，判 3级。

### 问题3修复后的代码：
```diff
   const publish = (
     sessionID: SessionID,
     goal: { readonly condition: string } | undefined,
     lastVerdict: SessionGoalVerdict | undefined,
-  ) => Effect.runPromise(publishGoalUpdated(events, sessionID, goal, lastVerdict))
+  ) =>
+    // 事件发布失败只应降级为日志，不应让 /goal 命令因「广播失败」而报错：
+    // store 状态已写成功，发布是尽力而为的副作用。
+    Effect.runPromise(publishGoalUpdated(events, sessionID, goal, lastVerdict).pipe(Effect.ignore))
```
