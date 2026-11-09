# 问题1：会话记忆快速压缩路径用「项目级全局记忆」充当会话摘要，压缩后本会话前文可能整体丢失 2级
## 问题1分析:
`processCompaction` 在 `cfg.compaction?.session_memory_compaction !== false`（默认开启，src/gyccode/session/compaction.ts:786）时走快速路径：`readMemories()`（compaction.ts:787）读取的是**记忆文件里的项目级条目**（src/gyccode/memory/memory-bridge.ts:65，全局 `getMemoryPath()`，与本会话 transcript 无关），随后 `buildMemorySummary(memories, previousSummary)`（compaction.ts:788，定义在 compaction.ts:259-270）直接拼出 `<summary>`，`result = "continue"`（compaction.ts:839）跳过 LLM 摘要调用。

后果链：
1. 首次压缩（`previousSummary === undefined`，compaction.ts:766 取不到）时，摘要内容 = 纯记忆列表，**被 `select()` 选中丢弃的 `selected.head` 对话内容一条都不进摘要**；而 `selected.head`（compaction.ts:767-772）正是本会话要被压缩掉的历史。
2. `previousSummary` 存在时虽经 `stripNestedPrevious`（compaction.ts:246-250）保留上轮摘要，但记忆条目若与本会话无关（同项目其他会话写入的记忆），摘要会夹带无关事实，模型据此复述即产生偏差。
3. 该路径只受配置开关保护，没有任何「记忆是否覆盖本会话」的校验；`readMemories()` 失败返回 `[]` 时自动回退 LLM（compaction-evidence 侧无影响），但**记忆非空恰恰是最容易触发错误摘要的条件**。

对照：LLM 路径（compaction.ts:841-866）会把 `selected.head` 序列化后交给模型生成摘要，信息来源正确；快速路径绕过了这一步。压缩是数据不可逆操作（`selected.head` 之后不再进入上下文），因此判为 2级。

### 问题1修复后的代码：
```diff
       let fastPathSummary: string | undefined
       if (cfg.compaction?.session_memory_compaction !== false) {
         const memories = yield* Effect.promise(() => readMemories())
-        fastPathSummary = buildMemorySummary(memories, previousSummary)
+        // 仅在已有上一轮摘要时才用记忆拼装：无 previousSummary 时记忆是项目级
+        // 全局内容，与本会话被丢弃的 selected.head 无对应关系，直接当摘要会把
+        // 本会话前文整体丢掉。此时回退 LLM 路径，由模型基于真实历史生成摘要。
+        fastPathSummary = previousSummary ? buildMemorySummary(memories, previousSummary) : undefined
         if (fastPathSummary) {
```
---
# 问题2：截断原文 7 天后被清理，但摘要中永久写死该路径，模型按提示回读必然失败 3级
## 问题2分析:
`markCompacted` 对超长工具输出先 `truncate.write(full)` 落盘（compaction.ts:492），成功后 `summarizeToolOutput(full, saved, part.tool)` 把**绝对路径**拼进持久化的摘要文本（compaction.ts:92 `完整原文已保存到 ${fullPath}`，最终写入 `part.state.output` 并由 compaction.ts:500 `session.updatePart` 落库）。

但落盘文件受 Truncate 服务 7 天保留期约束：`RETENTION = Duration.days(7)`（src/gyccode/tool/truncate.ts:12），`cleanup` 每小时删除超过保留期的文件（truncate.ts:57-58，仅过滤 `tool_` 前缀，而 `Truncate.write` 生成的正是 `ToolID.ascending()`，src/gyccode/tool/schema.ts:6 + `Identifier.ascending("tool", …)`，可被匹配）。

因此：压缩发生 7 天后，DB 里的摘要仍提示「完整原文已保存到 <path>」，模型按 compaction.ts:93 的指引去 Read 该文件必然 404，而 compaction.ts:94 又要求「不要仅凭片段断言」——指引与现实冲突，模型只能凭截断片段作答，与本文件注释（compaction.ts:54-59）要防的幻觉场景正好撞上。属次要健壮性缺陷，判 3级。

### 问题2修复后的代码：
```diff
     `[输出已截断：此处省略了 ${omitted} 个字符（共 ${output.length}）。`,
-    `完整原文已保存到 ${fullPath}`,
+    `完整原文已保存到 ${fullPath}（该临时文件仅保留 7 天，过期后请让模型重新执行原工具获取，或以会话历史中的片段为准）。`,
     `如需后半段内容，请用 Read 配合 offset 读取该文件，或用 Grep 在其中检索。`,
```
---
# 问题3：`microcompact()` 与两个阈值常量为零引用死代码，且尾部条数硬编码 -5，与 microcompact-select.ts 的实现重复漂移 3级
## 问题3分析:
- `export function microcompact(...)`（compaction.ts:115-146）：全仓 `rg "microcompact\(" --type ts src` 仅命中定义行本身，**无任何调用方**；真正的微压缩已由 `microcompactIfNeeded`（compaction.ts:514）+ `selectMicrocompactParts`/`selectTimeBasedParts`（./microcompact-select.ts）实现。
- `MICROCOMPACT_THRESHOLD`（compaction.ts:99）与 `CACHE_PREFIX_KEEP`（compaction.ts:100）在 compaction.ts 内仅被死函数 `microcompact` 引用（compaction.ts:123、132），而 microcompact-select.ts:20-21 另有一份同名同值导出并被测试断言（microcompact-select.test.ts:24-25）——两份常量一旦有人只改一边即产生阈值漂移（compaction 侧 0.9 / 20 与选择侧失去同步）。
- 死函数内部 `i >= messages.length - 5`（compaction.ts:132）把尾部保留条数硬编码为 5，而真实实现用具名 `TAIL_KEEP = 5`（microcompact-select.ts:22），且该死函数的 `contextLimit<=0` 保护（compaction.ts:121）与选择侧重复。

属「代码包存在多余代码」的极简主义违规 + 潜在漂移源，无运行时危害，判 3级。

### 问题3修复后的代码：
```diff
 export const TOOL_OUTPUT_MAX_CHARS = 2_000
@@
-export const MICROCOMPACT_THRESHOLD = 0.9 // Start microcompact at 90% context usage
-export const CACHE_PREFIX_KEEP = 20 // Keep first 20 messages for cache preservation
 export const MAX_CONSECUTIVE_COMPACTION_FAILURES = 3 // Auto-compaction circuit breaker
-
-export interface MicrocompactBlock {
-  index: number
-  content: string
-  expired: boolean
-}
-
-/** Simple message type for microcompact operations */
-interface Message {
-  role: string
-  content: string
-}
-
-export function microcompact(
-  messages: readonly Message[],
-  contextUsed: number,
-  contextLimit: number,
-): readonly Message[] {
-  if (contextLimit <= 0) return messages
-  const ratio = contextUsed / contextLimit
-  if (ratio < MICROCOMPACT_THRESHOLD) return messages
-  const result: Message[] = []
-  for (let i = 0; i < messages.length; i++) {
-    const msg = messages[i]
-    if (msg === undefined) continue
-    if (i < CACHE_PREFIX_KEEP || i >= messages.length - 5) {
-      result.push(msg)
-    } else if (msg.role === "tool") {
-      result.push({
-        ...msg,
-        content: "[This tool output has been compacted. The result was processed in earlier context.]",
-      })
-    } else {
-      result.push(msg)
-    }
-  }
-  return result
-}
```
（删除前请复核：当前 `rg "microcompact\(|MICROCOMPACT_THRESHOLD|CACHE_PREFIX_KEEP" --type ts src` 仅命中 compaction.ts:99-146 自身与 microcompact-select.ts 的独立定义；若后续补测需引用阈值，统一从 `./microcompact-select` 导入。）
