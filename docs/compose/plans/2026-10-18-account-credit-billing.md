# gyccode 账号体系 + 积分体系 + 收费机制 实施计划

> **状态**: 已实施（2026-10-18），实施结果与偏差见第八节
>
> **参照**: Claude Code 源码（`D:\AI项目备份\Claude Code 源码泄露资料\extracted-source\`）
> **约束**: 自主性（离线可用）/ 安全性（等保三级）/ 合格性（忠实参照 + 国内用语）

---

## 一、架构总览（忠实参照 Claude Code）

Claude Code 的核心架构结论（均有 `file:line` 证据）：

| 维度 | Claude Code 做法 | gyccode 对应 |
|------|-----------------|-------------|
| 客户端角色 | **纯消费者**：只读服务端返回的额度，不做扣费 | 同：客户端只查询余额 + 异步上报用量 |
| 扣费位置 | 服务端（Stripe/Apple 订阅） | 服务端 `services/account/server.ts` |
| 用量查询 | `GET /api/oauth/usage`（5s 超时、失败静默降级） | `GET /api/usage`（同策略） |
| 订阅类型 | OAuth token 携带 `subscriptionType` + `rateLimitTier` | `/api/user` 返回 `plan` + `balance` |
| 额度耗尽 | 429 → 展示升级链接 → 开浏览器 | 429 → 展示充值/升级链接 → 开浏览器 |
| 组织角色 | `organizationRole` 控制账单可见性 | `role`（admin/user）控制管理 API |
| 客户端缓存 | `getGlobalConfig().oauthAccount` 本地持久化 | `AccountRepo`（SQLite）本地持久化 |

**核心原则**：客户端不存余额、不做扣减、不判断"还能不能跑"——这些全在服务端。客户端只负责：
1. 查询余额（展示用）
2. 异步上报用量（扣减触发）
3. 收到 429/余额不足时展示提示

---

## 二、国内适配

| Claude Code | gyccode（国内） | 说明 |
|-------------|----------------|------|
| credits / balance | **积分** | 1 积分 = 1 元人民币（显示层），内部按 USD 成本换算 |
| subscription (Pro/Max) | **套餐**（基础版/专业版/旗舰版） | 月费制，含月度积分额度 |
| extra usage / overage | **超额积分** | 套餐用尽后可购买额外积分 |
| Stripe/Apple 支付 | **管理端充值**（离线）+ 可插拔支付适配器 | 自建服务无支付牌照，先做 admin 手动充值；预留 `PaymentProvider` 接口 |
| `claude.ai/upgrade` | `GYCCODE_UPGRADE_URL`（已存在） | 指向自建定价页 |
| 美元计价 | 积分（人民币）显示 + USD 成本内部 | `cost_ledger` 保持 USD，展示层换算 |

---

## 三、安全设计（等保三级）

1. **身份鉴别**：argon2id 口令哈希（已有）+ 设备码 OAuth（已有）
2. **访问控制**：
   - 普通用户：查余额、查用量、上报用量
   - admin：管理积分（充值/扣减/查询所有用户）
   - 管理 API 需 admin token（已有 `role` 字段）
3. **安全审计**：所有积分变动写入 `audit_logs`（已有审计表，扩展 action 类型）
4. **通信安全**：生产部署 TLS 终止（反向代理），本地开发 HTTP
5. **输入校验**：所有 API 入参严格校验（金额 ≥ 0、用户 ID 存在性）
6. **防重放**：用量上报带 `session_id + step_id` 去重（幂等）
7. **敏感信息**：token/密码不入日志、不入 URL query

---

## 四、自主性设计

1. **离线可用**：账号服务不可达时，客户端正常执行（不阻断），余额显示"离线"
2. **异步上报**：用量上报 fire-and-forget，失败重试 3 次后放弃（不阻塞 LLM 调用）
3. **本地缓存**：余额/套餐信息缓存 5 分钟（TTL），减少服务端压力
4. **降级策略**：服务端返回错误时，客户端不中断会话，仅记录日志

---

## 五、实施任务

### Task 1: 恢复 + 扩展账号服务（服务端）

**文件**:
- Restore: `services/account/server.ts`（从 git `256f5b7^` 恢复）
- Modify: 扩展积分/套餐/用量 API

**新增数据表**:
```sql
-- 套餐定义（admin 可配置）
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,           -- 'free' | 'pro' | 'max'
  name TEXT NOT NULL,            -- 基础版 / 专业版 / 旗舰版
  monthly_credits REAL NOT NULL, -- 月度积分额度
  price_cny REAL NOT NULL,       -- 月费（人民币）
  created_at INTEGER NOT NULL
);

-- 用户积分账户
CREATE TABLE IF NOT EXISTS credit_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id),
  balance REAL NOT NULL DEFAULT 0,       -- 当前可用积分
  monthly_quota REAL NOT NULL DEFAULT 0, -- 本月套餐额度
  monthly_used REAL NOT NULL DEFAULT 0,  -- 本月已用
  monthly_reset_at INTEGER NOT NULL,     -- 下次重置时间戳
  updated_at INTEGER NOT NULL
);

-- 积分流水（append-only，审计用）
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta REAL NOT NULL,            -- 正=充值/套餐发放，负=消费
  balance_after REAL NOT NULL,
  reason TEXT NOT NULL,           -- 'recharge' | 'plan_grant' | 'usage' | 'admin_adjust'
  ref_id TEXT,                    -- 关联 ID（session_id / 充值单号）
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_time ON credit_ledger(user_id, created_at);

-- 用量上报（幂等去重）
CREATE TABLE IF NOT EXISTS usage_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  credits_charged REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, session_id, step_id)  -- 幂等
);
```

**新增 API**:
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/usage` | 查询余额 + 本月用量 + 套餐信息 | 登录用户 |
| POST | `/api/usage/report` | 上报用量（幂等，触发扣减） | 登录用户 |
| GET | `/api/plans` | 套餐列表 | 公开 |
| POST | `/api/admin/recharge` | 充值积分 | admin |
| POST | `/api/admin/plan` | 变更用户套餐 | admin |
| GET | `/api/admin/credits` | 查询所有用户积分 | admin |
| GET | `/api/admin/ledger` | 积分流水查询 | admin |

**修复 P0 安全缺陷**: `handleConfirmPost` 硬编码 `seedUser.id` → 改为确认页要求输入邮箱+密码验证身份。

### Task 2: 客户端用量服务

**文件**:
- Create: `src/gyccode/billing/usage.ts`（用量查询 + 上报 + 缓存）
- Modify: `src/gyccode/account/account.ts`（Interface 扩展 `usage` 方法）
- Modify: `src/gyccode/effect/app-runtime.ts`（注册新 service）

**设计**:
```typescript
// src/gyccode/billing/usage.ts
export type UsageInfo = {
  readonly balance: number          // 当前可用积分
  readonly monthlyQuota: number     // 本月套餐额度
  readonly monthlyUsed: number      // 本月已用
  readonly plan: string             // 套餐名
  readonly planName: string         // 套餐中文名
  readonly resetAt: number          // 下次重置时间戳
}

export type UsageReportInput = {
  readonly sessionID: string
  readonly stepID: string
  readonly modelID: string
  readonly tokensInput: number
  readonly tokensOutput: number
  readonly tokensCacheRead: number
  readonly tokensCacheWrite: number
  readonly costUSD: number
}

export interface Interface {
  readonly query: () => Effect.Effect<UsageInfo | undefined, never>  // 失败返回 undefined（降级）
  readonly report: (input: UsageReportInput) => Effect.Effect<void, never>  // fire-and-forget
}
```

**降级策略**: 所有方法错误通道为 `never`——服务端不可达/超时时静默降级（`logWarn`），不阻断主流程。

### Task 3: 用量上报接线

**文件**:
- Modify: `src/core/session/projector.ts`（`applyUsage` 后触发上报）
- 或 Modify: `src/core/session/runner/llm.ts`（step 完成后触发）

**策略**: 在 step 完成、cost_ledger 写入后，异步调用 `Usage.report()`。fire-and-forget，不阻塞。

### Task 4: CLI 命令

**文件**:
- Modify: `src/cli/cmd/account.ts`（新增 `balance` / `recharge` 子命令）
- Modify: `src/gyccode/command-registry.ts`（重生）

**命令**:
- `gyc account balance` — 显示当前积分余额、套餐、本月用量
- `gyc account recharge` — 打开充值页面（`GYCCODE_UPGRADE_URL`）

### Task 5: TUI 展示

**文件**:
- Modify: `src/tui/component/dialog-usage.tsx`（增加余额/套餐区块）

**展示**:
```
积分余额：128.5 积分
套餐：专业版（月度 500 积分）
本月已用：371.5 / 500 积分
下次重置：2026-11-01 00:00
```

### Task 6: 额度耗尽处理

**文件**:
- Modify: `src/gyccode/session/retry.ts`（429 时检查本地缓存余额，展示充值提示）

**行为**: 服务端返回 402/429 + `{"error":"insufficient_credits"}` 时，客户端展示：
```
积分不足。当前余额 0.3 积分，本次调用需约 1.2 积分。
充值：gyc account recharge
```

### Task 7: 测试 + 验证

- 服务端 API 测试（bun test）
- 客户端 usage service 测试（mock HTTP）
- 集成测试：登录 → 查余额 → 上报用量 → 余额减少
- `bun run typecheck` + `bun run test` 全量通过

---

## 六、不做的事（边界声明）

1. **不做真实支付网关**：无支付牌照，充值走 admin 手动（预留 `PaymentProvider` 接口）
2. **不做客户端扣费**：客户端永远不判断"能不能跑"，只展示
3. **不做实时推送**：余额查询是拉模式（5min 缓存），不做 WebSocket 推送
4. **不做多币种**：内部 USD，展示积分（人民币），不做汇率换算
5. **不做发票/税务**：超出范围

---

## 七、验证清单

- [x] `bun run typecheck` 0 错误（2026-10-18，tsc --noEmit -p tsconfig.json）
- [x] `bun run test` 全量通过（2026-10-18，2313 pass / 0 fail / 273 files）
- [x] 服务端编译 + 逻辑测试：账号服务集成测试（`services/account/server.test.ts`）、客户端用量服务 mock HTTP 测试（`src/gyccode/billing/usage.test.ts` 6/6，覆盖缓存/降级/幂等上报/未登录）
- [ ] 账号服务启动 → `gyc account login` → `gyc account balance` 显示余额（需实机联调，未做）
- [ ] LLM 调用后 → 服务端 `credit_ledger` 有新记录（需实机联调，未做）
- [ ] 余额为 0 时 → LLM 调用被 402 拒绝 → 客户端展示充值提示（逻辑已接线，行为验证需实机联调）
- [ ] 服务端不可达时 → 客户端正常执行（降级）——测试在 mock HTTP 层验证过，实机未做
- [ ] admin 充值 → 用户余额增加 → 审计日志有记录（`services/account/server.test.ts` 覆盖，实机未做）

---

## 八、实施结果与偏差（2026-10-18）

### 已实施

| Task | 内容 | 落地位置 |
|------|------|---------|
| 1 | 账号服务恢复 + 扩展（积分/套餐/用量/管理 API + 确认页身份验证） | `services/account/server.ts` + `server.test.ts` + README |
| 2 | 客户端用量服务（查询/上报/5min 缓存/静默降级） | `src/gyccode/billing/usage.ts` + `usage.test.ts` |
| 3 | step-finish 后异步上报（forkIn，不阻塞） | `src/gyccode/session/processor.ts:537-549` |
| 4 | `gyc account balance` / `gyc account recharge` | `src/cli/cmd/account.ts` + 命令注册表重生 |
| 5 | TUI Usage 对话框积分区块 | `src/tui/component/dialog-usage.tsx`（经 `experimental.console` 扩展字段，未动协议生成物） |
| 6 | 429/额度耗尽提示中文化 + 充值页链接 | `src/gyccode/session/retry.ts` |
| 7 | 测试 | 客户端 6/6 + 全量 2313 pass |

### 与计划的偏差

1. **Task 2 未扩展 `account.ts` Interface**：原计划在 `Account.Interface` 加 `usage` 方法。实际新建独立 `Usage.Service`（`@gyccode/billing/usage.ts`），通过 `Account.node` 复用登录态。理由：职责单一（Account 只管登录态，Usage 管积分查询），且避免动全景服务接口。
2. **Task 6 未在客户端检查本地缓存余额做精确提示**：原计划"429 时展示当前余额 + 本次调用需多少积分"。实际保留服务端 429 语义（`FreeUsageLimitError` / `GoUsageLimitError`），只中文化提示 + 引导 `gyc account balance` / 充值页。理由：忠实参照 Claude Code"客户端不做扣费判断"，精确"还差几分"需要本地计价模型，超出边界声明。
3. **TUI 不直接消费新生成物类型**：本仓库无 `types.gen.ts` 的代码生成脚本（协议生成属于上游），故 429/console 扩展字段在 TUI 侧做了一次 `unknown` 收窄（`src/tui/context/sync.tsx` 的 `pickCredits`），不手改生成物。
4. **验证清单后半（账号服务↔客户端实机联调）未执行**：涉及真实账号服务 + 真实 LLM 调用，属于运行时联调而非静态验证，本次为代码层交付。联调步骤见 `services/README.md`。

### 拾缺补漏（本计划附带发现并修复）

- `handleConfirmPost` 硬编码 `seedUser.id` 的安全缺陷已在 Task 1 修复（确认页要求邮箱+密码验证身份后才批准），见 `services/README.md`。
- 客户端查询用的 `usage` 查询响应增加 `plan`/`planName`/`resetAt`/`utilization` 字段并按 Schema 严格解码，服务端与客户端契约对齐由 `usage.test.ts` 的 mock 响应固化。

### 触发与配置

- 充值页地址：`GYCCODE_UPGRADE_URL`（未配置时 `gyc account recharge` 打开账号服务 `/plans` 说明页）
- 汇率为 `GYCCODE_USD_CNY_RATE`，默认 7.2；1 积分 = 1 元人民币
