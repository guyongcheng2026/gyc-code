# 问题1：`outputLengthOf` 注释宣称非字符串输出「视为空输出因而可压缩」，实际返回 0 后被判定为受保护、永不可压缩，注释与行为方向相反 3级
## 问题1分析:
`outputLengthOf`（src/gyccode/session/compaction-evidence.ts:42-44）把非字符串输出统一折算为 `0`，注释写明「**视为空输出因而可压缩**」（compaction-evidence.ts:41）。

但调用方只把它喂给 `isProtectedToolOutput(tool, outputLength)`（compaction-evidence.ts:52-58）：证据类工具 `read/grep/glob/bash` 走 `return outputLength <= EVIDENCE_KEEP_CHARS`（compaction-evidence.ts:55），`EVIDENCE_KEEP_CHARS = 4_000`（compaction-evidence.ts:36），因此 `0 <= 4000` 恒为 `true` = **受保护、跳过压缩**，与注释宣称的「可压缩」正好相反。

调用点两处均如此：
- src/gyccode/session/compaction.ts:696 `if (isProtectedToolOutput(part.tool, outputLengthOf(part.state.output))) continue`（prune 循环，跳过即不清理）；
- src/gyccode/session/microcompact-select.ts:62、126（微压缩选择，跳过即不选中）。

现有测试只断言长度折算本身（compaction-evidence.test.ts：`expect(outputLengthOf(undefined)).toBe(0)`、`expect(outputLengthOf(123)).toBe(0)`），**未断言折算后的保护方向**，所以该矛盾不会被测试捕获。

实际影响面有限：`ToolStateCompleted.output` 声明为 `Schema.String`（src/schema/v1/session.ts:290），正常态恒为字符串，0 分支只在数据异常/旧数据时可达；此时行为是「异常输出反而被永久保护、无法压缩」，方向与注释相反，会成为长会话中一处不可回收的占位。属注释误导 + 异常态健壮性缺陷，判 3级。

### 问题1修复后的代码：
```diff
-/** 取工具输出的长度；非字符串（异常态）按 0 处理，视为空输出因而可压缩。 */
+/**
+ * 取工具输出的长度；非字符串（异常态）按 0 处理。
+ * 注意：0 会命中 `isProtectedToolOutput` 的 `<= EVIDENCE_KEEP_CHARS` 分支，
+ * 即异常输出被判为「短证据」而**受保护不可压缩**（与早期注释宣称的「可压缩」相反）。
+ * 正常态 `ToolStateCompleted.output` 恒为 string，此分支仅在脏数据时出现。
+ */
 export function outputLengthOf(output: unknown): number {
   return typeof output === "string" ? output.length : 0
 }
@@
 export function isProtectedToolOutput(tool: string, outputLength: number = 0): boolean {
   if (ALWAYS_PROTECTED_TOOLS.has(tool)) return true
   if (EVIDENCE_TOOLS.has(tool) || REPRODUCIBLE_EVIDENCE_TOOLS.has(tool)) {
+    // 空/异常输出（0）不构成证据，放行给压缩，避免脏数据永久占位。
+    if (outputLength <= 0) return false
     return outputLength <= EVIDENCE_KEEP_CHARS
   }
   return false
 }
```
（若选择保留现状，则至少按上半段修正注释，使注释与 `compaction.ts:696`、`microcompact-select.ts:62/126` 的实际语义一致。）
