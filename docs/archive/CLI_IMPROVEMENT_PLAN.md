# gyc CLI vs pi agent - 全面差异分析与改进计划

> 目标：让 gyc CLI 达到 pi agent 的功能完整性、性能极速、交互极好、简单易用的 100% 水准

---

## 1. 现状对比总览

| 维度 | pi agent | gyc CLI | 差距评级 |
|------|----------|---------|----------|
| **启动速度** | <200ms (无冷启动) | ~3-5s (Node/Bun 启动+模块加载) | 🔴 巨大 |
| **内存占用** | ~50-100MB | ~200-500MB (RSS) | 🔴 大 |
| **交互模式** | 统一会话式 | 单轮 `run` + 交互 `default` 分离 | 🟡 中等 |
| **流式输出** | 原生 SSE + 实时渲染 | 依赖 `streamLoop` 手动处理 | 🟡 中等 |
| **斜杠命令** | 完整补全/搜索/执行 | 仅基础列表选择 | 🟡 中等 |
| **多模型支持** | 动态切换/推理档位 | 静态配置 | 🟡 中等 |
| **Agent/技能系统** | 插件化技能市场 | 硬编码 agent 列表 | 🔴 巨大 |
| **MCP 集成** | 原生工具调用 | 仅列表显示 | 🔴 巨大 |
| **浏览器自动化** | 内置 Playwright | 无 | 🔴 巨大 |
| **调试/诊断** | 系统级诊断工具 | 仅基础 `--log-level` | 🔴 大 |
| **会话管理** | 持久化+分叉+压缩 | 基础创建/继续 | 🟡 中等 |
| **权限系统** | 细粒度规则引擎 | 简单 deny 列表 | 🟡 中等 |
| **配置管理** | 分层配置+环境变量 | 单文件 JSON | 🟡 中等 |
| **插件/扩展** | WASM/JS 插件热加载 | 仅静态命令注册 | 🔴 巨大 |

---

## 2. 核心架构问题

### 2.1 启动链路过长
```
gyc CLI 启动流程：
index.ts (环境变量加载 50ms)
  → yargs 解析 (30ms)
  → 动态 import 命令模块 (100-300ms)
  → Effect 运行时初始化 (200ms)
  → Agent/Config/Server 服务树构建 (500-1000ms)
  → 本地 HTTP 服务器启动 (300-500ms)
  → 首次请求建立连接 (100ms)
总计：~1.5-3s 冷启动
```

**pi agent 参考**：预热进程池 + 模块懒加载 + 核心功能内置 → <200ms

### 2.2 双轨制交互架构导致体验割裂
- `gyc run`：非交互单轮，服务端推流
- `gyc` (default.ts)：交互模式，本地 readline + 手动菜单
- **问题**：两套代码路径、两套渲染逻辑、两套错误处理、无法无缝切换

### 2.3 本地服务器模式引入不必要复杂度
- `createLocalClient` 创建内存 HTTP 服务器
- 每次 CLI 调用都启动完整服务栈
- 进程间通信开销大、调试困难、资源占用高

### 2.4 硬编码命令规格表维护成本高
```typescript
// default.ts 第 1100+ 行：SLASH_SPECS 硬编码 80+ 个命令
// 与 TUI 的 appCommands/sessionCommandList 完全重复
// 新增命令需改 3 处：TUI + CLI default + CLI run
```

---

## 3. 逐文件深度分析与改进方案

### 3.1 `src/gyccode/index.ts` - 入口文件

**现状问题**：
- 环境变量加载逻辑 80 行，阻塞主线程
- yargs 配置 120 行，命令注册逻辑分散
- 无预热机制，每次调用全量初始化

**改进方案**：
```typescript
// 1. 环境变量异步预加载（后台并行）
// 2. 命令元数据静态注册表（编译期生成）
// 3. 核心命令内置，非核心懒加载
// 4. 单进程模式：默认不启动 HTTP 服务器，直接调用内部 API
```

### 3.2 `src/gyccode/cli/cmd/default.ts` - 交互模式核心 (1600+ 行)

**现状问题**：
- 单文件 1600 行，违反单一职责
- `interactiveLoop` 500+ 行，包含：输入处理、菜单渲染、命令执行、会话管理
- 手工实现的原始菜单系统（ANSI 转义序列手写）
- fuzzysort 模糊匹配每次重新构建菜单
- 无历史记录持久化、无补全缓存
- 子代理记录内存泄漏风险（仅限制 100 条）

**改进方案**：
```
拆分为独立模块：
├── cli/interactive/
│   ├── input.ts          # 原始输入处理（raw mode、UTF-8 解码、光标控制）
│   ├── menu.ts           # 斜杠菜单（虚拟列表、滚动、高亮、搜索）
│   ├── completer.ts      # 补全引擎（Trie + LRU 缓存、增量搜索）
│   ├── history.ts        # 历史记录（SQLite 持久化、Ctrl+R 搜索）
│   ├── executor.ts       # 命令执行器（统一入口、错误边界、重试）
│   ├── session.ts        # 会话管理（创建/继续/分叉/压缩）
│   └── renderer.ts       # 流式渲染（复用 TUI 的 streamLoop 核心）
```

**关键优化**：
- 复用 `@gyccode/tui/component/prompt/autocomplete.tsx` 的核心逻辑（fuzzysort 配置、键盘绑定）
- 引入 `Ink` 或 `blessed` 替代手写 ANSI，获得跨平台一致性
- 会话状态持久化到 SQLite，支持跨进程恢复

### 3.3 `src/gyccode/cli/cmd/run.ts` - 单轮运行模式

**现状问题**：
- 与 default.ts 大量重复：文件解析、会话创建、streamLoop 调用
- `--attach` 模式与本地模式双维度分支，代码膨胀
- JSON 格式输出与默认格式双维度渲染

**改进方案**：
- 统一为 `executeTurn(sdk, sessionID, input)` 纯函数
- `run` 和 `default` 共享同一执行管道
- 格式化器插件化：`DefaultFormatter` / `JsonFormatter` / `StreamFormatter`

### 3.4 `src/gyccode/cli/cmd/tui.ts` - TUI 启动命令

**现状问题**：
- 仅作启动器，不共享 CLI 交互状态
- 无法从 CLI 无缝切换到 TUI（需退出重进）

**改进方案**：
- 实现 `attach` 协议：CLI 进程把会话 ID 传给 TUI 进程
- 共享会话状态（通过共享 SQLite 或 IPC）

### 3.5 `src/gyccode/cli/cmd/serve.ts` - 服务器模式

**现状问题**：
- 仅暴露 HTTP API，无 WebSocket 实时推送
- 无认证/授权细粒度控制
- 无负载均衡/集群支持

**改进方案**：
- WebSocket 双向通道（实时事件推送）
- JWT + RBAC 权限模型
- 支持多实例注册发现

---

## 4. 核心能力补齐清单

### 4.1 启动性能优化 (P0)

| 任务 | 目标 | 方案 |
|------|------|------|
| 冷启动 < 500ms | 当前 3s → 500ms | 1. 编译期命令元数据注册表 2. 核心模块内置打包 3. 惰性加载非核心命令 4. 移除本地 HTTP 服务器依赖 |
| 预热进程池 | 后续调用 < 50ms | `--daemon` 模式常驻内存，Unix socket 通信 |
| 模块加载优化 | 减少 60% import | 打包为单文件 ESM (bun build --compile) |

### 4.2 交互体验重构 (P0)

| 任务 | 目标 | 方案 |
|------|------|------|
| 统一交互管道 | 单轮/多轮/附着/命令 共享代码 | `ExecutionPipeline` 类封装完整流程 |
| 斜杠命令系统 | 补全/搜索/执行/帮助一体化 | 复用 TUI autocomplete 核心，Trie 索引 |
| 历史记录 | 持久化 + Ctrl+R 搜索 | SQLite + fuzzysort |
| 语法高亮 | 输入行实时高亮 | 集成 `shiki` 或简单正则高亮 |
| 多行编辑 | Enter 换行、Alt+Enter 发送 | readline/promises 扩展 |
| 粘贴检测 | 大段粘贴自动换行/确认 | bracketed paste mode |

### 4.3 会话管理增强 (P1)

| 任务 | 目标 | 方案 |
|------|------|------|
| 会话分叉 | `/fork` 创建分支 | 复用 `session.fork` API |
| 上下文压缩 | `/compact` 自动摘要 | 调用 `session.compact` |
| 会话导出/导入 | JSON/Markdown 导出 | 复用 `export/import` 命令 |
| 会话搜索 | 全文搜索历史 | SQLite FTS5 索引 |

### 4.4 模型/Provider 管理 (P1)

| 任务 | 目标 | 方案 |
|------|------|------|
| 动态模型切换 | `/model` 实时生效 | 会话级模型覆盖配置 |
| 推理档位 | `/variant high/max` | 同步到 `input.variant` |
| Provider 认证 | `/auth` 交互式配置 | OAuth/Key 统一管理 |
| 模型缓存 | 离线可用模型列表 | 本地缓存 + 定期刷新 |

### 4.5 Agent/技能系统 (P1)

| 任务 | 目标 | 方案 |
|------|------|------|
| 技能市场 | `gyc skill install <name>` | npm 风格注册表 + 本地缓存 |
| 技能开发 | `gyc skill create` 脚手架 | TypeScript 模板 + 热重载 |
| 子代理管理 | `/subagents` 可视化 | 复用 TUI 的子代理面板 |
| 并行子任务 | 一个 prompt 启动多子代理 | `task` 工具批量调度 |

### 4.6 MCP 集成 (P1)

| 任务 | 目标 | 方案 |
|------|------|------|
| MCP 服务器管理 | 安装/启动/配置/日志 | `gyc mcp` 完整生命周期 |
| 工具自动发现 | 会话自动加载 MCP 工具 | 连接时 `tools/list` 缓存 |
| 工具调用可视化 | 流式显示工具调用/结果 | 复用 TUI 工具调用渲染 |

### 4.7 调试/诊断工具 (P1)

| 任务 | 目标 | 方案 |
|------|------|------|
| 环境体检 | `gyc doctor` 一键诊断 | Node版本/依赖/网络/权限/磁盘 |
| 性能分析 | `--profile` CPU/内存 | `--cpu-prof` `--heap-prof` |
| 网络调试 | `--debug-network` 请求日志 | 打印完整 HTTP 往返 |
| 会话回放 | `gyc replay <session>` | 事件流重放调试 |

---

## 5. 架构重构路线图

### Phase 1: 基础设施 (Week 1-2)
```
目标：启动 < 500ms，统一交互管道，消除代码重复

1. 创建 `src/gyccode/cli/core/` 核心层
   - ExecutionPipeline: 统一执行入口
   - SessionManager: 会话 CRUD
   - ModelResolver: 模型/变体解析
   - FileAttachment: 文件解析统一

2. 重构 default.ts → interactive/
   - 拆分 6 个模块，各 < 200 行
   - 引入 Ink 替代手写 ANSI

3. 编译期命令注册表
   - `scripts/generate-command-manifest.ts` 生成 JSON
   - 运行时直接读取，无需动态 import

4. 移除本地 HTTP 服务器依赖
   - 直接调用内部 Service (Effect 层)
   - 仅 `--attach` 时使用 HTTP 客户端
```

### Phase 2: 交互体验 (Week 3-4)
```
目标：斜杠命令体验 = TUI，历史/补全/高亮完备

1. 斜杠菜单系统 (复用 TUI autocomplete)
   - 虚拟列表渲染 (仅渲染可见项)
   - 增量搜索 (防抖 50ms)
   - 键盘绑定与 TUI 完全一致

2. 历史记录系统
   - SQLite 持久化 (~/.gyc/history.db)
   - Ctrl+R 反向搜索 (fuzzysort)
   - 会话级/全局级双层历史

3. 输入增强
   - 语法高亮 (关键字/字符串/变量)
   - 括号匹配/自动闭合
   - 多行模式 (Alt+Enter 发送)

4. 流式渲染统一
   - 复用 streamLoop 核心
   - 增加 JSON/Markdown/Raw 格式器
```

### Phase 3: 核心能力 (Week 5-8)
```
目标：Agent/MCP/技能/调试 核心能力对齐 pi agent

1. 技能系统
   - 技能清单 (manifest.json)
   - 安装/更新/卸载/列表
   - 热重载开发模式

2. MCP 集成
   - 服务器进程管理 (启动/重启/日志)
   - 工具自动注册到会话
   - 权限隔离 (每 MCP 独立权限集)

3. Agent 系统
   - Agent 定义文件 (.agent.ts)
   - 子代理并行调度
   - 代理间通信协议

4. 调试工具
   - gyc doctor (环境/依赖/网络/配置)
   - gyc replay (事件流回放)
   - --profile (CPU/堆分析)
```

### Phase 4: 生态完善 (Week 9-12)
```
目标：插件市场、Web UI、CI/CD 集成

1. 插件市场
   - 远程注册表 (GitHub Packages)
   - 版本解析/依赖图/冲突检测
   - 沙箱隔离 (VM2 或 Worker)

2. Web 界面对齐
   - CLI/TUI/Web 共享同一后端
   - 会话状态实时同步

3. CI/CD 集成
   - GitHub Actions 集成
   - PR 审查自动化
   - 部署流水线
```

---

## 6. 关键技术决策

### 6.1 运行时选择
| 选项 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| **Node.js + `--expose-gc`** | 成熟、兼容性好、支持所有 npm 包 | 启动慢、内存高 | ✅ 主运行时 |
| **Bun** | 启动极快、内置工具链 | 部分原生模块不兼容 | ✅ 构建/测试/开发 |
| **Rust (via NAPI)** | 极致性能、内存安全 | 开发效率低 | ⚠️ 核心热点模块 (解析/渲染) |

### 6.2 交互层技术栈
| 选项 | 评价 | 决策 |
|------|------|------|
| **Ink (React for CLI)** | 组件化、虚拟 DOM、跨平台、TypeScript 原生 | ✅ 首选 |
| **Blessed** | 成熟、功能全 | API 老旧、无 TS 支持 | 备选 |
| **手写 ANSI** | 零依赖、完全控制 | 维护成本极高、Bug 多 | ❌ 淘汰 |

### 6.3 状态持久化
| 数据 | 存储方案 | 原因 |
|------|----------|------|
| 历史记录 | SQLite (better-sqlite3) | 结构化查询、FTS5 全文搜索、ACID |
| 会话状态 | SQLite (共享) | 跨进程访问、事务支持 |
| 配置 | JSON + 环境变量覆盖 | 简单、人类可读、版本控制友好 |
| 缓存 | 内存 LRU + 磁盘落盘 | 性能优先、启动时预热 |

### 6.4 流式协议
- **内部**：Effect Stream / AsyncIterable (类型安全、背压控制)
- **外部 (--attach)**：SSE + JSON Lines (标准、可调试)
- **WebSocket**：双向实时 (TUI/Web 共享)

---

## 7. 验收标准 (Definition of Done)

### 7.1 性能指标
- [ ] 冷启动 `gyc --help` < 300ms
- [ ] 冷启动 `gyc "hello"` < 800ms (含会话创建)
- [ ] 热启动 (daemon 模式) < 50ms
- [ ] RSS 内存 < 150MB (空闲交互态)
- [ ] 首字符延迟 (TTFT) < 200ms (本地模型/缓存)

### 7.2 交互体验
- [ ] 斜杠命令补全 < 30ms 响应
- [ ] 历史搜索 (Ctrl+R) < 50ms
- [ ] 输入行语法高亮零感知延迟
- [ ] 多行编辑/粘贴/撤销完美支持
- [ ] 所有 TUI 斜杠命令在 CLI 可用 (除界面类)

### 7.3 功能完整性
- [ ] 会话：创建/继续/分叉/压缩/导出/导入/搜索
- [ ] 模型：列表/切换/变体/推理档位/缓存
- [ ] Agent：列表/切换/子代理并行/自定义
- [ ] MCP：安装/启动/工具发现/权限隔离
- [ ] 技能：安装/开发/发布/热重载
- [ ] 调试：doctor/replay/profile/网络日志

### 7.4 代码质量
- [ ] 单文件 < 300 行
- [ ] 圈复杂度 < 10
- [ ] TypeScript strict 模式零错误
- [ ] 核心模块测试覆盖率 > 80%
- [ ] 无 `any` 类型、无 `console.log` 残留

---

## 8. 风险与应对

| 风险 | 影响 | 概率 | 应对策略 |
|------|------|------|----------|
| Ink 重写引入回归 | 高 | 中 | 1. 并行运行旧/新 CLI 对比测试 2. 灰度发布 3. 保留回滚分支 |
| 移除 HTTP 服务器破坏 --attach | 高 | 低 | 保留 HTTP 客户端路径，仅移除本地服务器启动 |
| SQLite 并发冲突 | 中 | 低 | WAL 模式 + 重试机制、单写者模式 |
| 插件沙箱逃逸 | 高 | 低 | VM2 隔离 + 权限清单 + 签名验证 |
| Windows 终端兼容性 | 中 | 高 | CI 包含 Windows 测试、fallback 到基础模式 |

---

## 9. 资源估算

| 阶段 | 人天 | 关键里程碑 |
|------|------|------------|
| Phase 1 基础设施 | 10 | 启动 < 500ms、统一管道 |
| Phase 2 交互体验 | 15 | 斜杠命令= TUI、历史/补全 |
| Phase 3 核心能力 | 25 | Agent/MCP/技能/调试 |
| Phase 4 生态完善 | 20 | 插件市场/Web/CI |
| **总计** | **70 人天** | **~3.5 月** |

---

## 10. 立即行动项 (本周可完成)

1. **提取命令清单生成脚本** - 从 TUI/CLI 统一生成 `command-manifest.json`
2. **创建 `ExecutionPipeline` 核心类** - 统一 run/default/attach 执行逻辑
3. **引入 Ink 依赖** - 替换 default.ts 手写菜单系统
4. **添加 `--daemon` 预热模式** - Unix socket 通信，验证启动加速效果
5. **编写性能基准测试** - `scripts/bench-cli.ts` 自动化监控回归

---

> **原则**：每个改动必须可验证、可回滚、有测试覆盖。小步提交，持续集成，拒绝大爆炸重构。