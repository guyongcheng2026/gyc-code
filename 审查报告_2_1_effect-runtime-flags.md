# 问题1：enableExa 在 GYCCODE_EXPERIMENTAL=1 时无法被显式 false 关闭，与 enabledByExperimental 语义不一致 3级

## 问题1分析:
`runtime-flags.ts:45-49` 的 `enableExa` 定义为 `flags.experimental || flags.enabled || flags.legacy`，其中 `enabled: bool("GYCCODE_ENABLE_EXA")` 走 `runtime-flags.ts:4` 的 `bool`（`Config.withDefault(false)`），**无法区分「未设置」与「显式 false」**。因此当 `GYCCODE_EXPERIMENTAL=1`（`runtime-flags.ts:10`）且用户显式设置 `GYCCODE_ENABLE_EXA=false` 时，结果仍为 `true`——用户显式关闭被静默忽略。

同文件 `runtime-flags.ts:11-14` 的 `enabledByExperimental` 正是为解决该语义而存在：用 `Config.option` 区分未设置（回退到 experimental 总开关）与显式 `false`（用户优先），且 `runtime-flags.ts:56-65` 的 `experimentalReferences`、`experimentalLspTool`、`experimentalPlanMode` 等全部 experimental 系开关都走它；`enableExa` 是唯一例外。`enableParallel`（`runtime-flags.ts:50-53`）不参与 experimental 总开关，`enabled || legacy` 无此歧义，不属同类问题。

影响面小（仅 EXA 搜索在实验模式下的可关闭性），但属配置语义不一致、行为可预期性受损，定为 3 级。

### 问题1修复后的代码：
```diff
   enableExa: Config.all({
     experimental,
-    enabled: bool("GYCCODE_ENABLE_EXA"),
+    enabled: Config.boolean("GYCCODE_ENABLE_EXA").pipe(Config.option),
     legacy: bool("GYCCODE_EXPERIMENTAL_EXA"),
-  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
+  }).pipe(
+    Config.map((flags) =>
+      Option.getOrElse(flags.enabled, () => flags.experimental || flags.legacy),
+    ),
+  ),
```
修复后：显式 `GYCCODE_ENABLE_EXA=false` → 关闭；未设置 → 回退 `GYCCODE_EXPERIMENTAL || GYCCODE_EXPERIMENTAL_EXA`，与 `enabledByExperimental` 行为对齐。

---
## 核查要点（未列为问题）
- `runtime-flags.ts:75-87` 的 `layer(overrides)` 通过 `ConfigProvider.fromUnknown({})` 读空配置、忽略环境变量——经 rg 核查**全仓无调用方**（仅 `.node`（`runtime-flags.ts:89`）在用，走真实配置），按宁缺毋滥不列问题；若未来启用需注意该语义。
- `runtime-flags.ts:89` `node` 的 `Layer.orDie`：所有字段均有 `withDefault`/`Config.option`/`orElse` 兜底（`runtime-flags.ts:4-9`），配置读取不会产生可恢复错误，orDie 不会误杀，无问题。
- `positiveInteger`（`runtime-flags.ts:5-9`）对非法值（非整数/≤0/非数字）静默回退 `undefined`，属既定容错设计，无错误通道问题。
- `runtime-flags.ts:91-92` 尾部 `export * as` 与 `import { LayerNode }` 倒置：ESM import 提升，运行时无问题，风格项不计。
