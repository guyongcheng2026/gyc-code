# gyc·web 对标 DSH Desktop 差距分析与对齐记录（2026-08-19）

基准：`E:\myAI\deepseek harness\DSH Desktop`（Electron 壳 + `@deepseek-ai/dsh-client-ui-*` 0.1.0-rc.6 全家桶）。
对象：`src/webapp`（React 18 + Vite，零运行时 UI 库）。
辅助资源：`E:\myAI\Geeker-Admin-master`（Vue3 后台模板，仅供后续管理页设计参考，组件不可直接复用——技术栈不同）。

DSH UI 包为编译产物（lib/*.js 无源码），功能基准取自各包 `README.zh.md` 的行为规格。

## 一、对齐矩阵

| 维度 | DSH 基准行为 | gyc·web 现状 | 结论 |
|---|---|---|---|
| Markdown 渲染 | GFM + KaTeX + shiki + 增量 AST（流式只重析尾部） | 纯文本 | **本轮已对齐（子集）**：自研 `Markdown.tsx`，分块 memo 冻结 + 尾部重析；代码块语言横幅/复制/16 行折叠；安全链接（仅 http/https/mailto + noreferrer）|
| Think 行 | 默认折叠 + 流式最新非空行单行滚动摘要，展开进页面流 | 全部平铺 italic | **本轮已对齐**：`PartView` ThinkRow，流式尾部摘要（rtl 滚动），details 展开 |
| 工具卡片 | render intent 分类（terminal/read/diff/search/web）+ StateDot + 16 行头尾切片 + 复制 + ANSI 解析 | 通用 JSON 卡 | **本轮已对齐（分类子集）**：`ToolBlocks.tsx` 五类卡 + StateDot（running 脉冲）+ maxLines=16 头尾折叠 + 复制 + 基础 ANSI 剥除 + 耗时 |
| 输入区 | 多行 textarea、Enter/Shift+Enter、busyEnter=Queue/Steer 偏好 | 单行 input | **本轮已对齐（基础）**：textarea 自动增高 1~8 行、Enter 发送/Shift+Enter 换行；steering 需服务端支持，暂缓 |
| 附件 | 图片粘贴 + 整页拖放 + 预检上限 | 手动路径输入 | **本轮已对齐（基础）**：paste/drop 文件 → 附件 chip（图片缩略图）；上限预检暂缓 |
| `/`+`@` 触发 | 光标处词边界检测、分组菜单、键盘仲裁 | 仅前缀 `/` | **本轮已对齐（基础）**：`@` 光标触发文件菜单（已加载树内过滤，↑↓/Enter 插入，mousedown 保焦）；词边界 guard 暂缓 |
| TodoDock | 输入区上方计划条，空隐藏，折叠 + 状态计数 | StatusBar 一行计数 | **本轮已对齐**：`TodoPanel.tsx` |
| 会话列表状态 | 蓝色运行点 + 等待审批/计划待审/等待回答琥珀点 | 无 | **本轮已对齐（运行点）**：事件驱动 busyMap；pendingInteraction 分类需服务端投影，暂缓 |
| 会话搜索 | 标题过滤 + 250ms 防抖内容搜索 | 无 | **本轮已对齐（标题过滤）**；内容搜索需服务端接口，暂缓 |
| 主题 | light/dark/system + prefers-color-scheme 监听 + 引导脚本防闪烁 | 二态 | **本轮已对齐**：`useTheme` 三态循环按钮；引导脚本暂缓 |
| 轮次操作 | 已定稿消息 hover 复制/时钟/分支 | 无 | **本轮已对齐（复制）**：assistant 消息 hover 复制 |
| 三栏布局 | 可拖拽 + 让步链 + 56px 折叠轨 | 固定 260px | **未对齐（P2）** |
| Trajectory 视图 | 轮次事件表 + 时间线缩放 + 虚拟行 + 分页 | 无 | **未对齐（P2）**：gyc 已有 DiffView 改动页可作锚点 |
| Workspace 分组/排序/拖拽/归档/重命名 | ui-workspace 全套 | 扁平列表 | **未对齐（P2）** |
| 审批/提问编辑器接管 | ApprovalPanel 接管 composer + 权限 chip + plan-review 卡 | 消息流上方卡片 | **部分对齐**：现有 PermissionCard/QuestionCard 功能等价，位置与形态差异为有意取舍（P1 观察项）|
| 压缩检查点行 | 消息流位置折叠标记 + 可展开摘要 | 无 | **未对齐**：需服务端 compaction 事件投影 |
| 统计行/ContextMeter | token 账目、TTFT、tok/s、缓存命中、占用环 | StatusBar cost/token | **部分对齐**：已有基础数字；TTFT/吞吐需服务端 timing 投影 |
| QueueDock/Steering | 排队消息管理 + steering 气泡 | 无 | **未对齐**：需服务端 queue 快照 |
| 透明滚动条 | 指针不在栏内滑块透明 | 常显 | **未对齐（P2，纯 CSS 可做）** |
| Markdown KaTeX/shiki | 公式 + 语法高亮 | 无 | **未对齐（P2）**：引入需过依赖治理（npm latest 精确版），或后续自研 |

## 二、本轮实施清单（全部零新依赖）

新增：
- `src/webapp/src/app/Markdown.tsx` — 自研 GFM 子集渲染器（分块 memo、流式冻结、安全链接）
- `src/webapp/src/app/ToolBlocks.tsx` — 分类工具卡 + StateDot + ANSI 剥除 + 16 行折叠/复制
- `src/webapp/src/app/DisclosureRow.tsx` — 折叠行原子组件
- `src/webapp/src/app/TodoPanel.tsx` — 计划条（对齐 TodoDock）

修改：
- `PartView.tsx` — 思考行折叠、工具卡分类、memo 化
- `MessageList.tsx` — assistant Markdown、流式尾部隔离标志、hover 复制操作行
- `PromptInput.tsx` — textarea 自动增高、粘贴/拖放附件、`@` 文件触发菜单
- `ChatPanel.tsx` — TodoPanel 挂载、files 下发
- `App.tsx` — 侧栏搜索、事件驱动 busyMap、主题三态、文件路径下发
- `SessionList.tsx` — 运行状态蓝点
- `useTheme.ts` — light/dark/system 三态（matchMedia 守卫，jsdom 安全）
- `index.css` — 全套新样式（StateDot 脉冲含 prefers-reduced-motion、markdown、思考行、@ 菜单、todo、拖放遮罩）
- `ChatPanel.test.tsx` — placeholder 同步

## 三、性能对比口径

- 消息列表：双端均虚拟化（Virtuoso vs DSH 自研窗口挂载）——等价。
- 流式 Markdown：DSH 增量 AST（末两块外冻结）；gyc 分块 memo（块级 React 元素复用）——同量级思路，块粒度更粗但零依赖。
- 工具卡/思考行 memo：流式 delta 只触发尾部 part 重渲染——对齐 DSH 尾部隔离。

## 四、后续建议（优先级）

1. **P1**：审批/提问迁移到 composer 接管形态（对齐 ApprovalPanel 交互）；pendingInteraction 会话行状态点。
2. **P1**：透明滚动条（纯 CSS，~20 行）；侧栏宽度拖拽（~60 行）。
3. **P2**：KaTeX/shiki（先过依赖治理核对 npm latest）；trajectory 视图（复用 DiffView 页签位）；压缩检查点行（等 compaction 事件）。
4. **P2**：Geeker-Admin 资源用于未来设置中心页（Vue 组件不可复用，仅取设计规范）。

---

# 第二轮（2026-08-19 P1/P2 实施）

服务端能力盘点结论（对标 Claude Code queue/steering 能力，均已在 gyc 服务端实现，本轮直接接线）：
- `SessionInput.Delivery`（"queue" | "steer"）全链路已存在：`src/core/session/input.ts`（DB 队列表）+ `runner/llm.ts`（steer/queue 提升循环）+ v2 端点 `POST /api/session/{id}/prompt`（`delivery?` 可选）
- 压缩链路已存在：`session.next.compaction.started/delta/ended` 事件 + `CompactionPart`（v1 消息 part，含 auto/text/overflow）
- v2 `session.history`（事件分页 + hasMore）→ 轨迹视图数据源
- v1/v2 权限与提问事件（`permission.updated/replied`、`question.v2.asked/replied/rejected`）→ pendingInteraction 投影

## 本轮已对齐项

| 项 | DSH/Claude Code 基准 | 落地 |
|---|---|---|
| composer 接管（P1） | ApprovalPanel 接管编辑器（琥珀条+理由+一次性拒绝/允许） | `ChatPanel`：待审批 > 待提问 取队首接管输入区；消息流上方卡片移除 |
| pendingInteraction 状态点（P1） | 琥珀点：等待审批/等待回答，优先于运行蓝点 | `App` pendingMap（事件驱动）+ `SessionList` 三态点与文案 |
| 透明滚动条（P1） | 指针不在栏内时滑块透明 | `index.css` `.sidebar` CSS 变量重绑定 |
| 侧栏拖宽（P1） | 拖动手柄 + 瞬态几何 | `App` startResize（180~420px，不持久化，对齐 DSH 瞬态约定） |
| busy 态投递（P2，覆盖 Claude Code queue/steering） | busyEnter：Enter=Queue / Ctrl+Enter=Steer | `useSendPrompt.deliver`（v2 prompt delivery）+ `PromptInput` busy 不锁输入、动态 placeholder、按钮变「排队」 |
| 压缩检查点行（P2） | 消息流位置折叠标记 + 可展开摘要 | `PartView` case "compaction"（DisclosureRow：上下文已压缩 · 自动 + 摘要展开） |
| trajectory 视图（P2） | 事件记录表 + 检查器 + 分页 | `Trajectory.tsx` + `useSessionHistory`（第三页签「轨迹」：虚拟化表、轮次边界分隔线、行检查器、加载更早） |

## 明确暂缓项

- **QueueDock 队列面板**：服务端 `session.next.prompt.admitted` 事件已带 delivery，可做排队气泡；待后续以事件流聚合实现。
- **TTFT/吞吐统计**：需服务端在步边界补 timing 投影。

---

# 第三轮（2026-08-19 KaTeX/shiki 接入）

版本核对（npm 官方页 + release 双源交叉，2026-08-19）：
- **shiki 4.4.2**：已在根 dependencies（TUI 侧在用），直接复用，无需新增
- **katex 0.17.0**（2026-05-22 latest 稳定版，MIT）：新增至 devDependencies（webapp 专属区，与 react/monaco 同区），精确版本号，需 `bun install` 锁定

落地（全部懒加载，不碰首屏）：
- `app/highlight.ts`：shiki core 单例（JS regex 引擎免 wasm）+ 25 门常用语言白名单按需注册（vite 逐语言 code-split）+ 高亮结果缓存（流式重析不重复高亮，容量 300 上限）+ 明暗主题跟随（github-light/dark）
- `Markdown.tsx`：CodeBlock 接 shiki（异步高亮，不支持语言降级纯文本，高亮块 max-height 480 滚动）；新增 TeX 公式——块级 `$$…$$`（围栏式与单行式）和 `\[…\]`，行内 `$…$`、`$$…$$` 与 `\(…\)`（KaTeX 首个公式才动态 import，渲染失败降级原文本）
- `types/katex.d.ts`：katex 最小类型声明 + css 模块声明

---

# 第四轮（2026-08-19 工作区支持）

验证清单发现「选择工作区」缺口：服务端早已有全链路能力（`x-gyccode-directory` header per-request 实例 + v2 `location.get` + 所有下游 hook 均带 directory 参数），但 webapp 前端从未接线。本轮补齐：

- `client/useWorkspace.ts`：directory 全局状态（localStorage 持久化 `gyc-web-dir`）+ 最近列表（`gyc-web-dirs`，上限 8）+ v2 location.get 回显当前生效目录
- `App.tsx` 顶栏 `WorkspaceMenu`：当前目录展示 + 绝对路径输入切换 + 最近列表 + 回到服务端默认；切换时清空 selected/filePath/hash
- directory 全链路下发：useSessions/useFileTree/useEvents/ChatPanel（内部 7 个 hook）/DiffView/Trajectory/FileViewer/TerminalPanel
- `useSessions.ts` 补 directory 参数（此前唯一缺失的 hook）


---

# 第五轮（2026-08-20 真实可用性修复 + QueueDock + 设置中心）

## 一、真实可用性修复（谷总实测反馈）

1. **命令选择失效**：`PromptInput.tsx` 三处根因修复——
   - `currentCmd` 取错 token（`value.split` 而非 `value.slice(1).split`，命令名落在 parts[1]），导致过滤永远基于第二个词
   - 过滤条件 `currentCmd.length < c.name.length` 在完整命令名时把命令从菜单剔除，且 Enter 只回填不执行
   - 键盘导航更新 `atIdx`（@ 文件菜单用）而非 `selected`（斜杠菜单高亮），上下键高亮不动
   - 修复后：完整命令名 Enter 直接执行；部分输入 Enter 回填；↑↓ 正确驱动高亮
2. **消息发送后无反应**：DeepSeek 报 `Invalid schema for function 'actor': ... got 'type: null'`——
   - 根因：`ToolJsonSchema.fromSchema`（session 工具路径）对顶层 Union（anyOf 全 object 变体）不补 `type: "object"`；deepseek 走 `@ai-sdk/openai-compatible` 直接透传原始 schema，API 400
   - 修复：`json-schema.ts` normalize 顶层 anyOf 全 object 时补 `type: "object"`（防递归：`schema.type === undefined` 守卫）；同步在 `llm/tool.ts` toJsonSchema 加同规则（双路径覆盖）
   - 验证：`ToolJsonSchema.fromSchema(Parameters)` 顶层输出 `{ type: "object", anyOf: [object, object] }`；实测发消息返回 reasoning+text 正常，无 APIError

## 二、本轮新增对齐项

| 项 | DSH 基准 | 落地 |
|---|---|---|
| QueueDock（P1） | busy 态排队/插话气泡（Enter=queue、Ctrl+Enter=steer） | `client/useQueue.ts`（监听 session.next.prompt.admitted 入队 / prompted 出队，兼容 .1 后缀）+ `app/QueueDock.tsx`（排队/插话徽标 + 文本）+ ChatPanel 输入区上方挂载 + CSS |
| 设置中心（P1） | settings 通用/模型 域 | `app/SettingsModal.tsx`：模型页（provider 分组 + 搜索 + 变体，数据复用 useModels）+ 通用页（工作区目录/主题/关于）；App 顶栏 ⚙ 打开 |

## 三、验证

- webapp vitest 8 文件 14 用例全绿（含 App/ChatPanel 挂载编译）
- 重建 dist + 重启服务，页面 200；新入口资源正常返回

## 四、剩余未对齐（后续批次）

- 消息反馈（👍👎）：需后端 message-feedback 接口（暂缺）
- 三栏布局 + 会话树搜索/分组/归档/重命名（P2）
- 原生目录选择器（OS 弹窗，Electron 主进程能力；web 端可用 input webkitdirectory 兜底）
- 交付物可点击文件引用（从工具输出结构化提取）
- TTFT/吞吐统计（需服务端步边界 timing 投影）
- 目标条 GoalBar（需 goal 会话投影）
- 后台任务列表 jobs（服务端已有 BackgroundJob，可接线事件）