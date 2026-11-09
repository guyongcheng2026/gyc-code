注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：JSON Schema 布尔形式 true/false 一律降级为 {type:"string"}，语义被篡改 <3>级
## 问题1分析:
transform.schema.ts:16 `if (typeof value === "boolean") return { type: "string" }` 把 JSON Schema 的布尔形式统一转成字符串类型：
- `true` 的语义是"任意值都合法"，降级为 `{type:"string"}` 后 number/boolean/object 全部变成非法，工具参数里的自由字段被错误收窄；
- `false` 的语义是"任何值都不合法"（如配合 `not` 使用），降级后反而放行任意字符串，校验语义完全反转。

出现位置：递归入口 transform.schema.ts:17、`items` 分支 transform.schema.ts:37、`additionalProperties` 分支 transform.schema.ts:39-44 都会把布尔子节点送进来。注释（transform.schema.ts:15）只说明"OpenAI 工具 schema 不支持布尔形式"，但正确降级应是 `true → {}`（开放）、`false → {"not":{}}` 或最小闭集，而非一刀切 `string`。属低频但确定的语义错误，定 3 级。

### 问题1修复后的代码：
```diff
--- a/src/gyccode/provider/transform.schema.ts
+++ b/src/gyccode/provider/transform.schema.ts
@@ -13,7 +13,11 @@
   const compositionKeys = ["anyOf", "oneOf", "allOf"]
 
   // JSON Schema's boolean form (`true`/`false`) is unsupported by OpenAI tool schemas.
-  if (typeof value === "boolean") return { type: "string" }
+  // true = 任意值合法 → 空 schema（开放）；false = 无值合法 → 用 not+空 schema 表达闭集。
+  if (value === true) return {}
+  if (value === false) return { not: {} }
   if (Array.isArray(value)) return value.map(sanitizeOpenAISchema)
   if (!isPlainObject(value)) return value
```

---
# 问题2：`const` 非字符串字面量被推断成 {enum:[v], type:"string"}，与值类型矛盾 <3>级
## 问题2分析:
transform.schema.ts:24 `if ("const" in value) result.enum = [value.const]` 把 const 转为单元素 enum，但此时若原 schema 未声明 `type`，后续类型推断链 transform.schema.ts:73-84 走到 `"enum" in result ? ["string"]`，产出 `{enum: [5], type: "string"}`（const 为数字）或 `{enum: [true], type:"string"}`（const 为布尔）——enum 值与 type 直接矛盾：
- 严格模式下 OpenAI 校验 enum ⊆ type，矛盾 schema 可能被 400 拒绝；
- 宽松端点则按 type 生成字符串 `"5"`，与调用方期望的 number 5 不符，工具入参类型漂移。

### 问题2修复后的代码：
```diff
--- a/src/gyccode/provider/transform.schema.ts
+++ b/src/gyccode/provider/transform.schema.ts
@@ -21,7 +21,15 @@
 
   if (typeof value.$ref === "string") result.$ref = value.$ref
   if (typeof value.description === "string") result.description = value.description
-  if ("const" in value) result.enum = [value.const]
+  if ("const" in value) {
+    result.enum = [value.const]
+    // const 的字面量类型即真实类型：补上 type，避免后面按 enum 误推断成 string。
+    if (result.type === undefined) {
+      const t = typeof value.const
+      if (t === "string" || t === "number" || t === "boolean") result.type = t
+      else if (value.const === null) result.type = "null"
+    }
+  }
   else if (Array.isArray(value.enum)) result.enum = value.enum
```
（注意：原代码 24-25 行为 `if/else if`，补丁保持该结构；若 const 已带 type 则不覆盖。）
