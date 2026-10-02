# 主题 C：成本可视化 —— 现状取证

## 1. append-only 成本账本及字段
- `src/core/session/sql.ts:204` 建表 `cost_ledger`，字段含 `session_id`、`task_id`、`event_type`、`cost_usd`、`tokens_input/output`、`tokens_cache_read/write`、`tokens_reasoning`、`cost_source`、`metadata`、`time_created`（已确认）
- `sql.ts:221-222` 索引 `idx_cost_ledger_session_time(session_id, time_created)`、`idx_cost_ledger_task(task_id)`（已确认）
- `cost_source` 默认 `"estimated"`，即口径分层标注、非单一真值（已确认）

## 2. 定价来源与自动更新
- `src/gyccode/provider/api-models.ts:15` 注释明确：本仓以 **models.dev** 表达「每 1M token」价格，OpenAI 兼容 `/models` 返回的是「每 token」，存在单位换算（已确认）
- `api-models.ts:186-195` `fetchModels` 拉取模型元数据，失败抛 `api-models fetch failed`（已确认）

## 3. CLI 展示命令
- `src/cli/cmd/stats.ts:181` `console.log(formatReport(report, reconcile-limit ?? 50))`——存在独立 stats 命令，且带 **reconcile-limit** 对账参数（已确认）
- `stats.ts:23-42` 报告结构含 input/output/cache read/cache write 分类（已确认）
- `src/cli/cmd/export.ts:345-364` 另有 export 命令（已确认）

## 4. TUI 渲染位置
- `src/tui/component/dialog-cost.tsx`、`dialog-usage.tsx` 为成本/用量独立对话框（已确认）
- `src/tui/routes/session/sidebar.tsx`、`index.tsx`、`subagent-footer.tsx` 侧栏与页脚常驻展示（已确认）

## 5. 历史花费统计维度
- 按 `session_id` + `time_created` 索引 → 支持**按会话与时间窗**聚合（已确认）
- `src/tui/component/dialog-context-info.tsx`、`dialog-summary.tsx` 提供上下文与汇总视角（已确认存在）

## 6. 成本优化建议
- `src/core/session/cost-advisor.ts:23` `cacheOpportunityAdvice(totalTokens)`，基于 token 结构给缓存优化建议（已确认）

## 7. 导出能力
- `src/cli/cmd/export.ts` 存在，但**是否支持 CSV / 图表导出未核实**（未找到）。仅确认有 json/文件导出路径（推断，未确认）。

---

# 主题 D：免费可用性 —— 现状取证

## 1. 免认证 / 零配置
- A-29-1 已落地零配置开箱即用（`free-models.ts` + provider autoload 策略）（已确认）
- `src/gyccode/provider/local.ts` 本机推理：**零 API key、零配额**，实测本机无 Ollama 时 3ms 返回空表而不挂住（已确认）

## 2. 免费模型与额度
- `src/gyccode/provider/free-models.ts:18` `FREE_MODELS` 显式清单数组；`:42` `pickDefaultFreeModel(models)` 供无配置时选默认免费模型（已确认）
- 免费模型成本口径为 0（`pickDefaultFreeModel` 配套标注，避免误称云端计费）（已确认）

## 3. 默认模型
- `src/gyccode/provider/provider.ts:1164` `defaultModelIDs(providers)` 按 provider 推导默认模型集（已确认）
- `provider.ts:2165` 默认模型还读 `Global.Path.state/model.json` 的 `recent`——即**记忆用户最近选择**（已确认）

## 4. 新用户启动门槛
- 零配置 + 免费模型兜底 + 本机推理三条兜底路径，新用户无需任何 key 即可产生首次会话（推断，基于上述已确认项）
- 认证引导：`src/gyccode/provider/local.test.ts` 的 `auth` 相关标注表明 provider 具备 `auth` 概念（已确认存在，具体引导文案未核实）

## 5. 本地推理路径
- `src/gyccode/provider/provider.ts` `ollama` loader：`autoload=false`、`baseURL` 默认 `http://localhost:11434/v1`、`discoverModels` 动态发现（已确认）
- 产出的 Model 声明 `priced=false`、四项 cost 全 0，并通过 `Schema.decodeUnknownEffect(Model)` 校验（已确认）

## 6. 免费额度提示
- 免费模型是否带**额度/速率限制提示**未找到（未找到）。当前仅有清单与 0 成本标注，无额度语义字段。