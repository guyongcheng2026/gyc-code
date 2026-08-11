# gyc 终端改造方案 A

> 状态：已评审待实施（2026-08-11 存档）
> 触发词：谷总说「调用方案A进行gyc终端版本改造」或「方案A」时，列出实施计划并确认后执行

## 目标
- 终端输入 `gyc` → 进入真正的终端 CLI（逐行交互 REPL，参照主流 AI CLI 形态）
- 终端输入 `gyc --tui` → 进入全屏 TUI 交互界面（现有行为迁移）

## 现状（已核实，2026-08-11）
1. `gyc`（无参数）→ `src/gyccode/index.ts` 默认分支硬编码加载 `TuiThreadCommand`（$0）→ 全屏 TUI（worker 进程 + RPC，约 89MB 内存）
2. `gyc --mini` → 已存在的 hidden flag → split-footer 交互模式（基于 OpenTUI 渲染栈，非逐行 REPL）
3. `gyc run [msg]` → 非交互单轮；`gyc run --command x` → 执行斜杠命令
4. `--tui` flag 目前不存在；但 yargs 已有 flag 切换模式先例（--mini）
5. 可复用资产：
   - 逐行输入：`resolveInteractiveStdin`（TTY / CONIN$ 兜底）+ `ui.ts` 中 readline 先例
   - 会话执行：run.ts 的 in-process server + `createGyccodeClient`（http://gyccode.internal 内部 fetch）
   - 流式输出：run.ts 的 loop（订阅 `client.event.subscribe()`，处理 session.updated / session.error / session.status idle / permission.asked）
   - 斜杠命令列表：SDK `command.list`（项目命令 / MCP 命令 / skill）

## 方案对比
| 方案 | 做法 | 改动量 | 符合需求 |
|---|---|---|---|
| A（选定） | gyc → 新逐行 REPL；gyc --tui → 现有 TUI 迁移 | 中（新增 1 命令文件 + index.ts 分支调整） | 完全符合 |
| B | 保留默认 TUI，新增 gyc cli 子命令 | 小 | 不符合（gyc 默认行为未变） |
| C | 把 --mini 提升为默认 | 极小 | 不符合（OpenTUI footer 渲染 ≠ 逐行 REPL） |

## 改动点清单
1. `src/gyccode/index.ts`：默认分支改为「无参数 → 加载 REPL；含 --tui → 加载 TuiThreadCommand」；--mini 可保留或映射到 REPL
2. 新增 `src/gyccode/cli/cmd/cli.ts`：逐行 REPL 命令（$0），核心为 readline 循环 + 复用 run.ts 的 client / 事件流渲染
3. REPL 功能清单（对齐主流 AI CLI 形态）：
   - 提示行、历史记录（readline 原生）
   - 斜杠命令：/model /exit /help /resume 等（列表来自 SDK command.list）
   - 每轮事件流式输出到 stdout（复用 run.ts 的 tool/block/inline 渲染）
   - 权限请求文本化处理
4. `gyc --tui` 完整保留现有 TUI 代码，零改动

## 风险与对策
- yargs 解析：`gyc --tui` 时 first（首个非 - 参数）为 undefined 会落入默认分支 → 默认分支内先判断 --tui，优先级 TUI > REPL > help
- 输出降级：逐行 REPL 无 diff 高亮/状态行/面板 → 接受文本化降级（与主流 AI CLI 一致）
- 多行粘贴：P2 后补（首行后超时或缩进续行检测）
- Ctrl-C：空行退出、输入中取消当前轮；已有 win32InstallCtrlCGuard 先例
- 乱码：win32EnableUtf8Console() 启动时已全局调用，REPL 直接受益，无新增风险

## 内存影响
逐行 REPL 不加载 OpenTUI renderer/solid 组件栈（footer 系列 30+ TSX 模块），启动内存预计从 TUI 约 89MB 降至 30MB 量级（接近 gyc run 非交互水平），与内存精简目标一致。

## 实施流程（触发时执行）
1. 列出实施计划给谷总确认
2. 按改动点清单实施 + 验证（tsc --noEmit、bun run build.mjs、真机实测）
3. 自动同步（GitHub + 知识库）