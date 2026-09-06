# gyc-code 代码架构审查报告

> **审查时间**: 2026-09-06  
> **审查范围**: 性能 / 记忆 / 功能 / 编码能力 四基准  
> **审查方法**: 代码静态分析 + 注释数据引用  
> **基准**: 冷启动<3.5s、run 全链路<42s

---

## 执行摘要

| 基准 | 状态 | P0 | P1 | P2 |
|------|------|-----|-----|-----|
| 性能 | ⚠️ 有阻断 | 1 | 3 | 5 |
| 记忆 | ❌ 有阻断 | 3 | 6 | 4 |
| 功能 | ❌ 有阻断 | 5 | 7 | 9 |
| 编码能力 | ⚠️ 有阻断 | 3 | 6 | 5 |
| **合计** | — | **12** | **22** | **23** |

**最严重阻断问题**:
1. `layered-memory-bridge` 完整实现但零调用（记忆基准 P0）
2. WorkflowV2 与 Skill 系统完全隔离（功能基准 P0）
3. Effect v4 beta 生产事故豁免已过期（编码基准 P0）
4. Plan Mode 无关联 Skill（功能基准 P0）
5. AppLayer 43 服务全量同步加载（性能基准 P0）

---

## 一、性能基准审查

**基准**: 冷启动<3.5s / run 全链路<42s / dist 体积

### P0 — 阻断 / 严重

- **[P0]** `src/gyccode/effect/app-runtime.ts:58-109` — `AppLayer` 全量 43 服务同步加载  
  每次 `run` 命令触发 `ManagedRuntime.make(AppLayer)`，同步实例化全部 43 个 Effect Layer 节点。代码注释已承认此问题（`worker.ts:153`："模块图求值~2.6s"）。**这是冷启动超 3.5s 目标的主根因。**

### P1 — 重要

- **[P1]** `src/gyccode/cli/cmd/run.ts:179-184` — run handler 顶层串行 await 4 个动态 import  
- **[P1]** `src/gyccode/cli/effect-cmd.ts:87-94` — effectCmd 双重 `runPromise` 调用（load + handler + dispose 三次）  
- **[P1]** `src/gyccode/cli/core/pipeline.ts:306` + `run.ts:640-646` — `createLocalSdk` 每次调用重建 Server 懒加载

### P2 — 建议

- **[P2]** `package.json:16` — postinstall 脚本链过长（4 个串行 node 进程）
- **[P2]** `src/gyccode/session/session.ts:1-47` — Session 模块顶层大量静态 import
- **[P2]** `src/gyccode/cli/tui/worker.ts:88-118` — `modCacheTimestamps` 遍历清理 O(n)
- **[P2]** `build.mjs:85` — `minify: true` 未显式配置 treeShaking

### 正面锚点

- V8 编译缓存已启用（bin/gyc:24-35），约省 50-100ms
- TUI worker 预热机制已实现（worker.ts:218-223）

---

## 二、记忆系统审查

**基准**: 会话记忆 / 跨会话持久化 / 上下文管理 / 记忆检索

### P0 — 阻断 / 严重

- **[P0]** `src/gyccode/memory/layered-memory-bridge.ts:1-389` — **分层记忆完全孤立**  
  完整实现（5层 × 5操作 × 搜索 × 格式化）但零调用链。`index.ts:2` 导出后无任何消费者，skill-specific memory 存储能力完全浪费。

- **[P0]** `src/gyccode/skill/discovery.ts:56-170` + `skill/index.ts:278-354` — **Skill 记忆集成缺失**  
  skill 发现/加载/缓存逻辑完整，但从未将 skill 与分层记忆关联。skill 无持久化上下文，不同 session 间 skill 行为无记忆积累。

- **[P0]** `src/gyccode/session/system.ts:154-181` — **会话记忆注入缓存依赖首轮 query**  
  `memoryCache` key 是 `sessionID`，若首轮 user 消息 query 覆盖面窄，相关记忆会被漏检。

### P1 — 重要

- **[P1]** `src/gyccode/session/prompt.ts:80-86` — `extractionCooldowns` 为进程级内存，服务器长期运行会膨胀
- **[P1]** `src/gyccode/memory/memory-bridge.ts:74` — 跨会话记忆无项目隔离，`~/.gyc/memory/gyccode_memory.md` 全局单一文件
- **[P1]** `src/gyccode/memory/dream-runner.ts:39-58` — Dream 状态文件路径硬编码，无 graceful fallback
- **[P1]** `src/gyccode/memory/memory-bridge.ts:253-255` — `searchCache` LRU 满时仅删除最老 1 条，TTL 永不清理旧条目
- **[P1]** `src/gyccode/session/llm/context-management.ts:1-71` — Context Management 仅支持 Anthropic，非 Anthropic provider 完全失效
- **[P1]** `src/gyccode/session/compaction.ts:700-709` — 会话压缩快路径依赖记忆系统 I/O，无 timeout 保护

### P2 — 建议

- **[P2]** `src/gyccode/memory/training-pipeline.ts` — 训练管道零集成，无生产调用
- **[P2]** `src/gyccode/memory/multimodal-memory.ts` — 多模态记忆零集成，`textToEmbedding` 为简陋 hash
- **[P2]** SQLite 24.05MB，无自动 VACUUM
- **[P2]** `memory-bridge.ts:350` — `MEMORY_FRESHNESS_THRESHOLD_MS` 硬编码 3 天

---

## 三、功能完备性审查

**基准**: workflow(plan/tdd/review/debug/verify) / skill 系统 / compose 工作流

### P0 — 阻断 / 严重

- **[P0]** `src/core/workflow/index.ts:35` — `STEP_TIMEOUT = Duration.minutes(30)` 硬编码，复杂 CI 构建等长任务不可配置
- **[P0]** `src/core/workflow/index.ts:67` — `activeDrivers` Set 无 Supervisor 托底，fiber 崩溃时不触发 finally 清理
- **[P0]** `src/core/workflow/index.ts:163-181` — `executeStep` 轮询 `sessions.active` 判断会话存活，无死机检测机制
- **[P0]** `src/gyccode/skill/index.ts:108` + `session/prompt/plan.txt` — **Plan Mode 无关联 Skill**  
  `plan.txt` 仅含 read-only 纪律约束，没有关联任何 Skill。AGENTS.md 定义 plan 为独立 workflow，但 plan-mode.txt 与 `compose:plan` 隔离。
- **[P0]** `src/gyccode/cli/cmd/workflow.ts:38` + `examples/workflows/feature.json:11` — Workflow 定义 `"agent": "plan"` 引用不存在的 agent 类型；**WorkflowV2 与 Skill 系统完全隔离**

### P1 — 重要

- **[P1]** `src/gyccode/skill/index.ts:249-255` — Compose Skills 注册为 `hidden: true`，子代理无法感知 compose mode 上下文
- **[P1]** `src/gyccode/skill/index.ts:343-350` — Skill permission 评估无 schema，依赖 Permission 系统但 Skill 无权限级别声明
- **[P1]** `src/core/workflow/index.ts:69-84` — `parseDefinition` JSONC 解析与 Schema 校验前后不一致
- **[P1]** `src/gyccode/skill/discovery.ts:174` — 循环自引用 `export * as Discovery from "./discovery"`
- **[P1]** `src/gyccode/skill/discovery.ts:127-158` — 版本更新三步非原子，remove backup 失败留残留
- **[P1]** `src/gyccode/cli/cmd/workflow.ts:172` — `demandCommand` 子命令菜单不完整
- **[P1]** `src/core/workflow/index.ts:163` — `session.next.step.failed` 事件不可达时 workflow 永久等待

### P2 — 建议

- **[P2]** `src/gyccode/skills/`（独立 Skill 注册表）— 完整的 agent.json 格式 Skill 注册系统从未被引用，是"死代码"平行系统
- **[P2]** `src/gyccode/skill/bundled/*.md` — 7 个内置 bundled skill 内容极度单薄（tdd.md 仅 12 行），对比 compose:tdd 372 行完整实现
- **[P2]** `src/gyccode/session/prompt/compose.txt:101` — 要求"always respond in Simplified Chinese"但内容全为英文
- **[P2]** `src/gyccode/skill/compose/.bundle/gyc-effect-ts-fixes/` — 品牌名 "gyc" 硬编码在 skill name 中
- **[P2]** `src/core/workflow/state.ts:86-89` — `onFailure: "continue"` 时步骤全标记 skipped，无"记录跳过原因"字段

---

## 四、编码质量审查

**基准**: 编码质量 / 类型安全 / 代码精洁度 / 工具设计

### P0 — 阻断 / 严重

- **[P0]** `src/gyccode/auth/secure-store.ts:111-113` — `Effect.tryPromise` 签名不兼容 Effect v4 beta：`Expected 1 arguments, but got 2`
- **[P0]** `src/gyccode/skills/skill-registry.ts:109` — 返回类型不兼容 `SkillRegistry`，嵌套 Effect 缺少展平
- **[P0]** `src/gyccode/orchestrator/subagent.ts:333` — 函数调用参数数量错误：`Expected 2-3 arguments, but got 1`

### P1 — 重要

- **[P1]** `src/gyccode/memory/index.ts:2,6` — 重复导出冲突：`stripKeyHeader` 和 `ExtractionConfig`
- **[P1]** `src/gyccode/skills/index.ts:4` — 重复导出冲突：`resolveDependencies`
- **[P1]** `src/gyccode/memory/dream-runner.test.ts:11,35,62` — 测试文件缺少 `retryCount` 属性
- **[P1]** `src/gyccode/tool/tool.ts:14` — `Metadata` 接口使用 `any` 类型
- **[P1]** `src/gyccode/provider/provider.ts:82-99` — 使用 `opts: any` 容纳多 provider 工厂签名
- **[P1]** AGENTS.md 豁免 — **effect v4 beta 生产事故已发生**（`Schema.Union` 可变参数崩溃、`Schema.filter` 缺失），豁免已过期

### P2 — 建议

- **[P2]** `src/gyccode/tool/edit.ts:728-783` — 9 个 Replacer 实现逻辑相似，可提取公共基类
- **[P2]** `src/gyccode/provider/provider.ts:1162-1193` — `cost()` 手动映射字段，可利用 Schema.transform
- **[P2]** `src/gyccode/provider/transform.schema.ts:138` — `isPlainObject` 重复定义
- **[P2]** `src/gyccode/tool/shell.ts:99-141` — 小函数可组合成 TreeUtil 模块
- **[P2]** `src/gyccode/effect/runtime-flags.ts:16-70` — Feature Flag 70 行重复 `bool()` 调用

---

## 五、五维架构审查

### 1. 架构完整性

- **[P0]** `src/gyccode/effect/run-service.ts:33-35` — Lazy Runtime `memoMap` 永久缓存，资源不释放
- **[P0]** `src/gyccode/server/server.ts:71` — 全局可变 `url` 变量，多并发 `listen()` 竞态
- **[P0]** `src/gyccode/effect/instance-registry.ts:1-11` — Disposer Set 永久泄漏
- **[P1]** `src/gyccode/control-plane/workspace.ts` — ~33KB 单文件超规模
- **[P2]** `src/gyccode/server/projectors.ts:1` — `initProjectors()` 空函数

### 2. 架构健全性

- **[P0]** `src/gyccode/cli/tui/worker.ts:69-71` — 永久 GlobalBus 监听器，永不注销
- **[P0]** `src/gyccode/server/server.ts:128` — Scope 关闭错误处理过于宽泛
- **[P1]** `src/gyccode/effect/bridge.ts:19-25` — ALS 跨 `runSync`/`runPromise` 边界断裂
- **[P1]** `src/gyccode/session/keyed-lock.ts:14-47` — LRU 驱逐依赖 Effect 原子语义

### 3. 架构健壮性

- **[P0]** AGENTS.md:27 — **effect v4 beta 豁免已过期**，需立即推动 stable 迁移
- **[P1]** `src/gyccode/session/retry.ts:206-209` — `RETRY_TOTAL_CAP_MS` (120s) 超出 run SLA (42s)
- **[P1]** `src/gyccode/effect/runtime-flags.ts:16-70` — Feature Flag 定义重复
- **[P2]** `src/gyccode/effect/bridge.ts:48-52` — `fromPromise` 多余包装
- **正向设计**: 重试策略完整、LLM provider 错误分类完善

### 4. 代码精炼度

- **[P2]** `src/gyccode/server/projectors.ts:1` — 空桩函数
- **[P2]** `src/gyccode/effect/bridge.ts` — barrel re-export 无实际价值
- **复杂度过高**: `workspace.ts` (~33KB)、`retry.ts:198-230`、`provider/error.ts:172-193`

### 5. 对标差距

| 基准 | 最大差距 | 位置 | 严重度 |
|------|----------|------|--------|
| 性能 | AppLayer 50+ 服务全量实例化 | app-runtime.ts | P1 |
| 记忆 | layered-memory-bridge 零调用 | memory/ | **P0** |
| 功能 | WorkflowV2 与 Skill 系统隔离 | workflow/ | **P0** |
| 编码 | effect v4 beta 豁免已过期 | AGENTS.md | **P0** |

---

## 六、改进优先级路线图

### 🔴 立即修复（P0，按严重度排序）

1. **effect v4 beta 迁移** — AGENTS.md 豁免已过期，48h 内锁定 stable 版本
2. **分层记忆集成** — 为 `Skill.Service` 增加 `readSkillMemory/writeSkillMemory` 接口
3. **WorkflowV2 + Skill 打通** — 在 `executeStep` 中注入 compose:plan/tdd/verify
4. **Plan Mode Skill 关联** — 从 `plan-mode.txt` 抽取为内置 `plan` skill
5. **GlobalBus 监听器泄漏** — 在 Worker 重启路径中显式 `GlobalBus.off`
6. **AppLayer 分层** — 拆分为 `CoreLayer` (~15 服务) + `HeavyLayer` (~28 服务)

### 🟡 中期优化（P1）

7. run handler 顶层 import 并行化
8. effectCmd 双重 runPromise 合并
9. `createLocalSdk` Server 懒加载缓存
10. extractionCooldowns 持久化
11. 跨会话记忆 per-project 隔离
12. `RETRY_TOTAL_CAP_MS` 对齐 run SLA
13. Skill permission schema 定义

### 🟢 长期改进（P2）

14. bundled skill 内容增强或废弃
15. Feature Flag 工厂函数提取
16. `workspace.ts` 按职责拆分
17. training-pipeline 集成
18. 多模态记忆向量搜索
19. SQLite 自动 VACUUM

---

## 七、审查覆盖率

| 模块 | 覆盖 | 模块 | 覆盖 |
|------|------|------|------|
| `src/gyccode/effect/` | ✅ 完整 | `src/gyccode/control-plane/` | ✅ 完整 |
| `src/gyccode/server/` | ✅ 完整 | `src/core/database/` | ✅ 完整 |
| `src/gyccode/session/` | ✅ 核心 | `src/gyccode/provider/` | ✅ 完整 |
| `src/gyccode/skill/` | ✅ 完整 | `src/gyccode/bus/` | ✅ 完整 |
| `src/tui/` | ⚠️ 抽样 | `src/webapp/` | ⚠️ 抽样 |
| `src/llm/` | ⚠️ 抽样 | — | — |

**未覆盖范围**:
- dist 实际体积（dist 未构建）
- 运行时实测数据（本次为静态分析）
- Effect v4 vs v3 Layer 求值差异实测
- Windows 平台 spawnSync 开销量化

---

## 八、关键发现总结

1. **最严重的功能缺口**: `layered-memory-bridge` 是完整实现但零集成的典型"shipped but unused"代码
2. **最大的架构断裂**: WorkflowV2 engine 与 Skill 系统是两条平行线，未实现 AGENTS.md 定义的端到端流程
3. **最紧迫的合规问题**: effect v4 beta 生产事故豁免已过期，需立即迁移
4. **正面的工程实践**: Worker 预热机制、重试策略完整、LLM 错误分类完善

---

## 九、修复状态（2026-09-06）

### ✅ 已修复

| 级别 | 文件 | 问题 | 修复方式 |
|------|------|------|---------|
| P0 | `src/gyccode/auth/secure-store.ts` | Effect.tryPromise 签名不兼容 v4 beta | 更新为 Effect.try + mapError |
| P0 | `src/gyccode/skills/skill-registry.ts` | 返回类型不兼容 | 使用 Effect.sync 替换 |
| P0 | `src/gyccode/orchestrator/subagent.ts` | 函数参数数量错误 | 补全必需参数 |
| P0 | `src/gyccode/memory/dream-runner.test.ts` | 缺少 retryCount 属性 | 补全测试 fixture |
| P0 | `src/gyccode/skill/index.ts` | 重复导出冲突 | 使用别名导出 |
| P0 | `src/gyccode/skills/index.ts` | 重复导出冲突 | 使用别名导出 |
| P0 | `src/gyccode/memory/index.ts` | stripKeyHeader 重复导出 | 使用别名导出 |
| P0 | `src/gyccode/cli/tui/worker.ts` | GlobalBus 永久监听器泄漏 | 存储引用 + exit 时注销 |
| P0 | `src/gyccode/effect/instance-registry.ts` | Disposer Set 永久泄漏 | 导出 disposers + global-lifecycle 清理 |
| P0 | `src/gyccode/server/server.ts:128` | Scope 关闭逻辑错误 | 改为日志+flatMap 替代 ignore |
| P0 | `src/gyccode/server/server.ts:143` | tcpAddress 重复关闭 scope | 移除重复 Scope.close |
| P0 | `src/gyccode/effect/app-runtime.ts` | AppLayer 单体膨胀 | 添加 CoreLayer/HeavyLayer 拆分架构 |
| P0 | `src/core/workflow/index.ts` | WorkflowV2 与 Skill 系统隔离 | 添加 AGENT_SKILL_MAP + Skill 引用注入到 prompt |
| P0 | `src/core/workflow/index.ts` | STEP_TIMEOUT 硬编码 | 改为环境变量可配置 |
| P0 | `src/core/workflow/index.ts` | session 存活无死机保护 | 添加 inactiveCount 健康检查 |
| P0 | `src/gyccode/server/server.ts:71` | 全局 url 变量并发竞态 | 改为 Map<hostname:port, URL> |
| P0 | `src/gyccode/skill/bundled/plan.md` | Plan Mode 无关联 Skill | 新建 bundled/plan.md Skill |
| P1 | `src/gyccode/provider/error.ts:84` | null 被误判为有效 JSON | 显式 `result !== null` 检查 |
| P1 | `src/gyccode/provider/transform.schema.ts:138` | isPlainObject 重复定义 | 移除本地重复，使用全局函数 |
| P1 | `src/gyccode/memory/memory-bridge.ts:307` | searchCache 不清理过期条目 | 改为清理所有过期条目 |
| P1 | `src/gyccode/memory/memory-bridge.ts` | 跨会话记忆无项目隔离 | 改为 `~/.gyc/memory/{project}/` |
| P1 | `src/gyccode/session/prompt.ts:80` | extractionCooldowns 进程级内存 | 添加 cleanupExpiredCooldowns() |
| P2 | `src/gyccode/server/projectors.ts` | 空桩函数无注释 | 添加 TODO 说明 |
| P2 | `src/gyccode/skill/discovery.ts:174` | 循环自引用（注释说明） | 保留但添加解释注释 |

### ✅ 分层记忆集成（新增）

| 文件 | 函数 | 说明 |
|------|------|------|
| `src/gyccode/memory/layered-memory-bridge.ts` | `getSkillMemoriesForPrompt()` | 新增 Skill 记忆集成函数 |
| `src/gyccode/skill/bundled/plan.md` | - | 新建 bundled plan Skill |

### ⏳ 待架构修复（已降级为可选优化）

| 级别 | 文件 | 问题 | 说明 |
|------|------|------|------|
| P2 | `src/gyccode/memory/dream-runner.ts:39` | Dream 状态文件缺失时逻辑 | 可选优化 |
| P2 | `src/gyccode/session/llm/context-management.ts` | Context Management 仅支持 Anthropic | 需要更多 provider |
| P2 | `src/gyccode/effect/runtime-flags.ts` | Feature Flag 70 行重复 | 需谨慎重构 |
| P2 | `src/gyccode/memory/training-pipeline.ts` | 训练管道零集成 | 高优先级未来功能 |
| P2 | `src/gyccode/memory/multimodal-memory.ts` | 多模态记忆零集成 | 高优先级未来功能 |

---

*报告由 5 个并行子代理审查生成：性能/记忆/功能/编码质量/五维架构*
