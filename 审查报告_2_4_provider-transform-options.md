注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：Azure completions URL 分支对不支持 reasoning_effort 的模型注入该参数 <2>级
## 问题1分析:
transform.options.ts:163-170 的逻辑：用 `/gpt-(\d+)\.(\d+)/` 匹配模型 id，`match` 失败时解构出 `gptMajorVersion/gptMinorVersion` 为 `undefined`，`Number(undefined)` 为 `NaN`，`isGpt55OrNewer` 恒为 `false`；随后只要 `npm === "@ai-sdk/azure"` 且 `useCompletionUrls`，就无差别写入 `result["reasoningEffort"] = "medium"` 并提前 return。

问题在于该分支的进入条件**只看 npm 与 useCompletionUrls，不看模型是否具备推理能力**：
- `gpt-4o`、`gpt-4.1` 等 id 不匹配正则 → `isGpt55OrNewer = false` → 照样注入 `reasoningEffort: "medium"`；
- OpenAI/Azure Chat Completions 对不支持该参数的模型返回 400（Unknown parameter: 'reasoning_effort'），整个请求直接失败；
- 注释（transform.options.ts:161-162）写明意图是"gpt 5.4 以上 + azure 不支持 reasoningEffort 才 return"，但实现把"匹配不到 gpt-x.y"也当成了"支持注入"，与注释语义相反。

### 问题1修复后的代码：
```diff
--- a/src/gyccode/provider/transform.options.ts
+++ b/src/gyccode/provider/transform.options.ts
@@ -160,13 +160,17 @@
 
   // Any gpt version above 5.4 in combination with azure does not support reasoningEffort
   // so we should return early here.
-  const [, gptMajorVersion, gptMinorVersion] = input.model.api.id.match(/gpt-(\d+)\.(\d+)/) ?? []
-  const isGpt55OrNewer = Number(gptMajorVersion) > 5 || (Number(gptMajorVersion) === 5 && Number(gptMinorVersion) >= 5)
+  const gptMatch = input.model.api.id.match(/gpt-(\d+)\.(\d+)/)
+  const gptMajorVersion = gptMatch ? Number(gptMatch[1]) : undefined
+  const gptMinorVersion = gptMatch ? Number(gptMatch[2]) : undefined
+  const isGpt55OrNewer =
+    gptMajorVersion !== undefined &&
+    (gptMajorVersion > 5 || (gptMajorVersion === 5 && (gptMinorVersion ?? 0) >= 5))
   if (input.model.api.npm === "@ai-sdk/azure" && input.providerOptions?.useCompletionUrls) {
-    if (!isGpt55OrNewer) {
+    // 仅 gpt-5.x（非 5.5+）显式声明了该参数；匹配不到版本号的模型不得注入。
+    if (gptMajorVersion !== undefined && gptMajorVersion === 5 && !isGpt55OrNewer) {
       result["reasoningEffort"] = "medium"
     }
     return result
   }
```

---
# 问题2：smallOptions 依赖变体对象插入序取首项，契约无保护 <3>级
## 问题2分析:
transform.options.ts:210 `Object.values(model.variants ?? {})[0] ?? {}` 把变体表的第一个值当作小模型（compact/summarize）的默认参数。该值的正确性完全依赖各 `variants()` 分支把"最弱档"放在对象字面量首位——transform.variants.ts:218-221（glm52 分支 `high` 在 `xhigh` 前）、transform.variants.ts:204-207（minimax 分支 `none` 在 `thinking` 前）、transform.variants.ts:472-485（anthropic 分支 `high` 在 `max` 前）等均为硬编码顺序，无注释、无单测锁定该契约。后续任何人在某个分支中间插入新键或调整顺序，小模型会静默换档（可能切到最强思考档，增加 token 成本），编译期与运行期均无告警。

### 问题2修复后的代码：
```diff
--- a/src/gyccode/provider/transform.options.ts
+++ b/src/gyccode/provider/transform.options.ts
@@ -206,7 +206,10 @@
 }
 
 export function smallOptions(model: Provider.Model) {
+  // 契约：变体表首键必须是"最弱/关闭思考"档（各 variants() 分支按弱→强排列）。
+  // 这里显式取首键并加注释固化；新增分支时必须保持该顺序。
   const small = Object.values(model.variants ?? {})[0] ?? {}
   if (
     model.providerID === "openai" ||
     model.api.npm === "@ai-sdk/openai" ||
     model.api.npm === "@ai-sdk/github-copilot"
```
（配套建议：为 `variants()` 各分支补一条单测，断言首键属于最低 effort 档，把隐式契约变成门禁。）
