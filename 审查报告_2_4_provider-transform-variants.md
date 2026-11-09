注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：reasoningToggle 恒返回空对象，toggle 型 reasoning_options 永远生成不了思考开关变体 <3>级
## 问题1分析:
transform.variants.ts:631-633 的 `reasoningToggle` 是恒返回 `{}` 的占位实现，但两条调用路径把它当真：
- transform.variants.ts:590 `if (!budget) return toggle ? nonEmptyVariants(reasoningToggle(target)) : undefined` —— 只有 toggle 型（无 budget_tokens）的模型走这里，`nonEmptyVariants({})` 恒为 `undefined`；
- transform.variants.ts:593 `...(toggle ? reasoningToggle(target) : {})` —— toggle 分支永远贡献零键。

后果：模型的 `reasoning_options` 声明为 `type: "toggle"`（如本地/Ollama 类端点常见的 thinking 开/关）时，`reasoningVariants` 产出的变体里**没有任何开关项**，UI 的思考开关静默消失，用户无法关闭/打开 thinking；且因为返回的是 `{}` 而非报错，该缺陷不会在任何日志或类型层暴露。函数体留空却保留签名，属未完成实现。

### 问题1修复后的代码：
```diff
--- a/src/gyccode/provider/transform.variants.ts
+++ b/src/gyccode/provider/transform.variants.ts
@@ -628,9 +628,21 @@
   return Object.keys(variants).length > 0 ? variants : undefined
 }
 
 function reasoningToggle(model: Provider.Model): NonNullable<Provider.Model["variants"]> {
-  return {}
+  // toggle 型 reasoning_options：按 npm 映射到各家"开/关思考"的最小参数对。
+  switch (model.api.npm) {
+    case "@ai-sdk/anthropic":
+    case "@ai-sdk/google-vertex/anthropic":
+      return {
+        off: { thinking: { type: "disabled" } },
+        on: { thinking: { type: "enabled", budgetTokens: 16_000 } },
+      }
+    case "@ai-sdk/openai-compatible":
+      return { off: { reasoningEffort: "none" }, on: { reasoningEffort: "medium" } }
+    default:
+      // 未适配的 SDK 不编造参数：保持无变体，由上层按模型默认行为处理。
+      return {}
+  }
 }
```

---
# 问题2：openaiReasoningEfforts 用字符串比较发布日期，缺失/异形日期静默降级 <3>级
## 问题2分析:
transform.variants.ts:74-75 用 `releaseDate >= OPENAI_NONE_EFFORT_RELEASE_DATE`（"2025-11-13"）字典序比较决定是否暴露 `none`/`xhigh` 档。数据来源是 models.dev 目录的 `release_date`，而 fromModelsDevModel 对缺失值兜底为 `""`（provider.ts:1358），插件/自建端点发现的模型也常为 `""`：
- `"" >= "2025-11-13"` 为 false → 未知日期的模型一律拿不到 `none`/`xhigh`，即使它实际是 2025-12 之后发布的 gpt-5.2+，用户看到的档位比模型真实能力少；
- 若日期格式混入 `2025-11-13T00:00:00Z` 或 `11/13/2025`，字典序比较直接给出错误结果（前者反而更大、后者完全错序），可能把不支持 `none` 的旧模型暴露出去 → 上游 400。

调用点 transform.variants.ts:289、transform.variants.ts:402、transform.variants.ts:426、transform.variants.ts:566 均直接透传 `model.release_date`，无格式校验。

### 问题2修复后的代码：
```diff
--- a/src/gyccode/provider/transform.variants.ts
+++ b/src/gyccode/provider/transform.variants.ts
@@ -57,8 +57,17 @@
 // Models released before it 400 on `reasoning_effort: "none"`, so we only expose
 // it as a variant for models new enough to accept it.
 const OPENAI_NONE_EFFORT_RELEASE_DATE = "2025-11-13"
 
+// 仅接受 YYYY-MM-DD（允许带时间后缀）；缺失/异形日期归一为 ""，
+// 按"未知日期不追加新档"处理，避免字典序比较把旧模型误判为新模型。
+function normalizeReleaseDate(raw: string): string {
+  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw)
+  return m?.[1] ?? ""
+}
+
 // OpenAI rolled out the `xhigh` reasoning_effort tier on this date. Same reasoning.
 const OPENAI_XHIGH_EFFORT_RELEASE_DATE = "2025-12-04"
@@ -71,8 +80,9 @@
   if (versionedEfforts) return versionedEfforts
   const efforts = [...WIDELY_SUPPORTED_EFFORTS]
   if (GPT5_FAMILY_RE.test(id)) efforts.unshift("minimal")
-  if (releaseDate >= OPENAI_NONE_EFFORT_RELEASE_DATE) efforts.unshift("none")
-  if (releaseDate >= OPENAI_XHIGH_EFFORT_RELEASE_DATE) efforts.push("xhigh")
+  const released = normalizeReleaseDate(releaseDate)
+  if (released !== "" && released >= OPENAI_NONE_EFFORT_RELEASE_DATE) efforts.unshift("none")
+  if (released !== "" && released >= OPENAI_XHIGH_EFFORT_RELEASE_DATE) efforts.push("xhigh")
   return efforts
 }
```
（transform.variants.ts:372 `model.release_date >= "2025-12-04"` 与 transform.variants.ts:84 同源，建议一并走 `normalizeReleaseDate`。）
