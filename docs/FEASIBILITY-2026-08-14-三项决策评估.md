# 三项决策可行性评估报告
日期：2026-08-14
评估对象：① composer/index.ts 占位代码去留；② executeStream 未实现声明；③ 品牌替换 URL 一致性审计
评估方式：全库静态扫描 + effect 类型定义核对 + CLI 注册链路追踪

---

## ① composer/index.ts：完善 or 删除？

### 现状定位（已核实）

`src/gyccode/composer/index.ts`（71 行）是**纯占位代码**，四类问题：

| 问题 | 位置 | 说明 |
|------|------|------|
| 假 skill 发现 | `listSkills()` L43-46 | 注释声称"扫描 SKILL.md"，实际返回硬编码数组 `["compose","gyc-agent",...]` |
| 无 LLM 的假 plan | `plan()` L17-31 | 仅模板填充 6 个固定步骤，不调用 LLM、不做真实需求分析 |
| 未用导入 | L6 | `readFileSync`、`existsSync` 导入后从未使用 |
| 死代码 | `composeCommands` L49-70 | 全库无任何导入方，与 `cli/cmd/compose.ts` 内联实现完全重复 |

### 关键事实：真实 compose 系统已存在

`src/gyccode/skill/compose/index.ts` 才是**真实且完整**的 Compose 系统：
- `composeRoot()`：版本化提取目录（`Global.Path.data/compose/<version>`）
- `extractComposeSkills()`：从 `bundle.gen.ts`（构建期编译）提取 `compose:*` 技能，带 marker 文件防重复
- `composeSkillsBlock()`：将技能注入 prompt
- 真实工作流 Plan→TDD→Execute→Review→Debug→Verify→Merge 由 `compose:*` skills 驱动

**两套体系完全独立**，`composer/index.ts` 与真实系统无任何调用关系。

### 引用链路（影响面）

```
src/gyccode/index.ts:77  compose: { load: () => import("./cli/cmd/compose"), name: "ComposeCommand" }
        └─> src/gyccode/cli/cmd/compose.ts  (import { Composer } from "../../composer/index")
                └─> src/gyccode/composer/index.ts  (唯一被引用点)
```
- `composer/index.ts` 仅被 `cli/cmd/compose.ts` 引用
- `composeCommands` 导出无任何引用方（死代码）
- footer/types 中的 "composer" 是 UI prompt composer，**无关概念**，不受影响

### 方案对比

| 方案 | 工作量 | 风险 | 价值 |
|------|--------|------|------|
| **A. 删除占位 + CLI 下线** | 极小（删 3 文件 + 1 行注册） | 低（移除未用的 `gyc-code compose` 命令） | 高：消除误导，符合"简洁优先" |
| **B. 删除占位 + CLI 接线真实系统** | 中（重写 compose.ts 调 `extractComposeSkills`） | 中（需处理技能提取的 Effect 上下文） | 中：保留 CLI 入口但价值有限 |
| **C. 完善为真实 LLM 工作流** | 大（LLM 调用 + 技能发现 + 状态管理，与 skill/compose 重复造轮子） | 高（与既有系统职责重叠） | 低：真实系统已存在，属重复建设 |

### 推荐：方案 A（删除）

**理由**：真实 compose 工作流已由 `skill/compose/` + 会话内 compose 模式承载，独立 CLI `compose plan/skills` 命令只是生成静态 markdown，价值有限且是假实现。保留它会误导用户以为存在独立的 compose CLI 能力。符合用户信条"简洁优先、外科手术式修改、不写超出需求的功能"。

**执行计划**（方案 A）：
1. 删除 `src/gyccode/composer/index.ts`
2. 删除 `src/gyccode/cli/cmd/compose.ts`
3. 移除 `src/gyccode/index.ts:77` 的 `compose` 命令注册
4. 全库搜索 `Composer`/`composeCommands`/`cli/cmd/compose` 确认零残留
5. `bun run typecheck`（或等价）验证无编译错误

> 若用户希望保留 `gyc-code compose skills` 作为查看已提取技能的入口，则改选方案 B，将 handler 改为调用 `extractComposeSkills()` 列出真实技能。**需用户拍板 A/B。**

---

## ② executeStream not implemented：实现 or 移除？

### 现状定位（已核实）

两处相同实现：
- `src/core/database/sqlite.node.ts:102`
- `src/core/database/sqlite.bun.ts:101`

```ts
executeStream() {
  return Stream.die("executeStream not implemented")
}
```

### 关键事实

1. **全库零调用方**：`executeStream` 仅这两处定义，无任何调用点
2. **非接口契约**：核对 effect v4 类型定义——
   - `node_modules/effect/dist/unstable/sql/SqlClient.d.ts` 的 `SqlClient` 接口**不含** `executeStream`
   - 其继承的 `Statement.Constructor`（Statement.d.ts:271）也**不含** `executeStream`
   - 本地 `SqliteClient` 接口（sqlite.node.ts:23-28）仅扩展 TypeId/config/loadExtension/updateValues，同样**不要求** executeStream
3. 结论：这是一个**既无人调用、又非类型契约**的多余方法，`Stream.die` 一旦被误触会直接导致 fiber 死亡

### 方案对比

| 方案 | 工作量 | 风险 | 说明 |
|------|--------|------|------|
| **A. 移除声明**（推荐） | 极小（删 2 处方法 + 可能清理 Stream 导入） | 极低 | 消除潜在 die 隐患，符合精炼目标 |
| B. 实现真实流式查询 | 中-大 | 中 | 无需求驱动，属超前设计 |

### 推荐：方案 A（移除声明）

**执行计划**：
1. 删除 `sqlite.node.ts` 与 `sqlite.bun.ts` 中的 `executeStream()` 方法
2. 检查 `Stream` 导入是否仍被其他代码使用，若否则一并移除导入
3. **必须验证**：`bun run typecheck` 确认移除后无类型错误（若某隐藏接口仍要求该方法，编译会报错，届时回退保留）
4. 全库搜索 `executeStream` 确认零残留

> 风险兜底：因已确认 `SqlClient`/`Constructor`/本地 `SqliteClient` 三层接口均不要求该方法，移除大概率安全，但以 typecheck 结果为最终依据。

---

## ③ 品牌替换审计：URL vs 品牌名一致性

### 审计范围与方法

对全库 `https?://` 进行扫描（276+ 命中），重点核对 commit `375317e` 品牌替换后 URL 与品牌文案是否同步，区分三类 URL：功能数据源、品牌标识、schema 标识。

### 审计结论：**基本一致，无严重错配**

#### 1. 合法保留的上游数据源（正确，无需改动）
- `src/core/models-dev.ts:163` `https://models.opencode.ai`
  - 这是**公共中立模型清单数据源**，非品牌服务，已有明确注释说明，且支持 `GYCCODE_MODELS_URL` 指向自建镜像
  - 与 OpenCode Zen/Go 同理：属上游真实数据源，**保留是正确的**，符合品牌诚实原则

#### 2. 自有品牌 gyccode.ai 的使用（合法，属自有品牌）
`gyccode.ai` 用于以下场景，均为**自有产品品牌标识**，非冒用：
- `$schema` 标识：`theme.json`/`config.json`/`tui.json`（theme assets、config.ts、tui-migrate.ts、customize-gyccode.md）——JSON Schema 标识符，编辑器用于补全，不实际请求
- `HTTP-Referer` 头：openrouter/nvidia/kilo/llmgateway/zenmux 等 provider 及 provider.ts——作为产品来源标识发给 LLM 网关
- MCP OAuth `client_uri`：`oauth-provider.ts:47`

> 与 OpenCode Zen/Go 的本质区别：`gyccode.ai` 是用户**自有产品 gyc-code 的品牌域名**，使用它是正当的品牌建设，不属于"冒用不属于自己的品牌"。

#### 3. 需用户确认的一项（非 bug，仅提示）
- `gyccode.ai` 域名是否已实际注册/可控？
  - 若仅作 `$schema` 标识符与 Referer 头，**无需真实解析**，无风险
  - 若未来要让 `https://gyccode.ai/config.json` 等真实可访问（提供在线 schema），则需确保域名可控
  - **当前不构成品牌诚实问题**，仅作为后续域名规划提示

### 遗留 opencode 引用核查
全库除 `models.opencode.ai`（合法数据源）外，**无其他 opencode.ai/opencode.dev/opencode.io 残留**。此前恢复的 OpenCode Zen（6 处）、OpenCode Go（3 处）均为对上游品牌的诚实引用，正确。

### 推荐：无需代码改动
品牌替换审计通过。唯一可选动作：在 `MEMORY.md` 记录"gyccode.ai 为自有品牌域名，用于 schema 标识与 Referer 头，属合法品牌使用"，避免后续审查误判为冒用。

---

## 汇总与决策点

| 项 | 推荐方案 | 工作量 | 需用户拍板 |
|----|----------|--------|-----------|
| ① composer/index.ts | **A 删除**（或 B 接线真实系统） | 极小 / 中 | **是**（A/B 二选一） |
| ② executeStream | **A 移除声明** | 极小 | 否（可直接执行 + typecheck 验证） |
| ③ 品牌审计 | 无需改动，仅记录结论 | 无 | 否 |

**下一步**：待用户确认 ① 选 A 还是 B 后，①② 可一并落地（均为删除型外科手术修改），随后统一 typecheck + 全库残留扫描 + 更新工作记忆。
