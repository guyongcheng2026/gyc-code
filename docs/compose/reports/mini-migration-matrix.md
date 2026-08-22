# gyc --mini 功能迁移覆盖矩阵（移除前置核查）

> 日期：2026-08-16
> 目的：确认 `gyc --mini`（split-footer 交互）全部用户能力已迁移到 `gyc cli`（逐行交互）与 `gyc web`（Web IDE）后，方可移除 mini。
> 结论：**mini 的终端 UI 专属细节（replay/scrollback/splash/demo）不迁移；用户可感知能力须三端对齐。**

## 一、覆盖矩阵

| # | mini 能力（split-footer） | CLI 现状 | Web 现状 | 结论 |
|---|---|---|---|---|
| 1 | 流式对话 + 工具输出渲染 | ✅ streamLoop | ✅ MessageList | 已迁移 |
| 2 | 工具审批（once/always/reject） | ✅ stream-cli interactive | ✅ PermissionCard | 已迁移 |
| 3 | 问题问答（单选/多选/自定义） | ✅ stream-cli interactive | ✅ QuestionCard | 已迁移 |
| 4 | 模型切换 | ✅ /model | ✅ ModelPicker | 已迁移 |
| 5 | 模型变体（选择/循环） | ✅ /variant | ✅ ModelPicker variant | 已迁移 |
| 6 | agent 切换（build/plan/compose） | ✅ /agent | ✅ ModeSwitcher | 已迁移 |
| 7 | 新会话 /new | ✅ /new | ✅ 服务端命令 + 会话栏 | 已迁移 |
| 8 | 退出 /exit | ✅ /exit | ✅ 关闭页面 | 已迁移 |
| 9 | /context /copy /branch | ✅ 三命令 | ✅ 三命令 | 已迁移（75bed72） |
| 10 | /continue /resume 恢复会话 | ✅ | ✅ 会话列表 | 已迁移 |
| 11 | /compact 上下文压缩 | ✅ /compact | ⚠️ 无入口 | **待补：web 增加入口** |
| 12 | 外部编辑器 /editor | ❌ 无 | ⚠️ monaco 面板 | **待补：CLI 增加 /editor** |
| 13 | 技能与动态命令（/skills 项目/MCP） | ❌ 硬编码 | ✅ command.list | **待补：CLI 动态命令** |
| 14 | 文件引用（首轮附加） | ⚠️ 仅单轮 --file | ✅ 📎 附加 | **待补：CLI 交互传 files** |
| 15 | 子代理查看/后台化 | ❌ 无 | ⚠️ background 已接未展示 | **待补：CLI /subagents + web 展示** |
| 16 | 排队提示管理（queued） | ❌ 阻塞无排队 | ❌ 无 | 可选增强（非核心） |
| 17 | 会话历史回放（断线恢复） | ✅ 重拉消息 | ✅ 刷新恢复 | 已迁移 |
| 18 | 滚动回看 scrollback | 终端天然 | 浏览器天然 | 终端 UI 细节，不迁移 |
| 19 | 启动画面 splash | ✅ renderWelcome | ✅ 页面加载 | 已迁移 |
| 20 | demo 模式 | ❌ | ❌ | 隐藏测试功能，不迁移 |
| 21 | @mention（agent/file/resource） | ❌ | ❌ | 可选增强（非 mini 核心） |

## 二、缺口与补齐方案

| 优先级 | 缺口 | 补齐方案 | 落点 |
|---|---|---|---|
| P0-① | CLI 动态命令（/skills /init /review 项目/MCP） | interactiveLoop 启动加载 command.list；runSlashCommand 动态分支取 template 作为 prompt 发送 | default.ts |
| P0-② | CLI /editor 外部编辑器 | $EDITOR 打开临时文件，内容作为 prompt 发送 | default.ts |
| P0-③ | CLI 交互文件附加 | --file 传入 interactiveLoop，runTurn parts 拼 file part | default.ts + run.ts |
| P0-④ | CLI /subagents | streamLoop 收集 subagent 事件，/subagents 展示最近子代理状态 | stream-cli.ts + default.ts |
| P1-① | Web 子代理查看 | 事件流 stream.subagent 渲染子代理卡（复用 background） | webapp |
| P1-② | Web /compact 入口 | 会话操作栏加「压缩」按钮 | ChatPanel.tsx |
| P2 | 排队提示管理 | web 输入排队展示（PromptInput 非禁用） | webapp |

## 三、移除范围（mini 相关代码）

- `default.ts`：--mini/-i 分支删除（报错提示改为移除）
- `run.ts`：runInteractiveMode/runInteractiveLocalMode/runMini 与 --replay/--replay-limit/--demo 删除
- `tui.ts`：--mini 分支与 --no-replay/--replay-limit/--demo 选项删除
- `attach.ts`：--mini 分支删除
- `run/` 目录：删除 footer.*、runtime*.ts、stream.ts、session-replay.ts、subagent-data.ts、demo.ts、splash.ts、scrollback.*、theme.ts、tool.ts、turn-summary.ts、variant.shared.ts、question.shared.ts、permission.shared.ts、prompt.shared.ts、prompt.editor.ts、trace.ts、types.ts、entry.body.ts、session.shared.ts、stream.transport.ts、runtime.stdin.ts、copy.shared.ts（CLI 复用则保留）
- 保留：`run/stream-cli.ts`（CLI 用）、`run/stream-cli.interactive.test.ts`（CLI 测试）

## 四、验证计划

1. `bun tsc --noEmit` 0 错误
2. `bun test` 全绿（含 stream-cli.interactive.test.ts）
3. webapp vitest 全绿
4. `bun run build.mjs` node 目标全绿
5. CLI 冒烟：/skills /editor /subagents --file 可用；gyc tui / gyc web 正常启动
