# AI 编码代理的三种界面模式：CLI / TUI / IDE 详解

> 本文档对比 **Hermes Agent**、**CodeBuddy CLI**、**MiMo-Code** 三套工具的 CLI/TUI/IDE 三种运行模式的差异、特征及适用场景。学完这份文档，你拿到任何 AI 编码代理工具，都能立刻判断它的三种模式怎么用、什么时候用什么模式。

---

## 一、先搞清楚基础概念

| 模式 | 全称 | 本质上是什么 | 交互方式 | 界面特点 |
|:----:|------|------------|---------|---------|
| **CLI** | Command-Line Interface | **一次性命令**，执行完就退出 | 终端输入→输出→结束 | 纯文本，适合管道/脚本/CI |
| **REPL** | Read-Eval-Print Loop | **持续对话**，一问一答保持上下文 | 终端持续输入，每次都回复 | 纯文本，上下文累计，无分屏 |
| **TUI** | Terminal User Interface | **终端内的图形化应用** | 分屏/多面板/快捷键/鼠标 | 彩色终端，类似 htop/vifm |
| **IDE** | Integrated Development Environment | **嵌入代码编辑器**的后端服务 | 编辑器侧边栏/右键菜单/内联diff | 图形界面，直接操作文件树 |
| **GUI** | Graphical User Interface | **真正的桌面/Web图形应用** | 窗口/按钮/图表/鼠标点选 | 浏览器或原生桌面窗口 |

### 核心区别速记

```
CLI  = 说一句话就走                    (问完就退出)
REPL = 坐下来聊天                       (持续问答)
TUI  = 分屏聊，边看结果边聊             (可视化终端)
IDE  = AI 插件嵌在编辑器的侧边栏里       (嵌在代码中)
GUI  = 一个完整的软件窗口                (桌面应用)
```

---

## 二、Hermes Agent — 模式最全

### 2.1 CLI 模式（一次性问答 + 管理命令）

```bash
hermes -z "用Python写个快速排序"          # 老方式：问完就退出
hermes chat -q "用Python写个快速排序"      # 新方式
hermes config set model gpt-4            # 配置操作
hermes cron list                         # 查看定时任务
hermes gateway start                     # 启动网关
hermes sessions list                     # 列出会话
hermes skills install skill-name         # 安装技能
```

**特征：**
- 输出到 `stdout`，执行完 shell 返回
- 适合放入脚本、CI/CD 管道
- 可通过 `--output-format json` 获取结构化输出

**何时用：**
- ✅ 写脚本自动调用（比如每天自动检查项目进度）
- ✅ CI 管道中让 AI 自动生成代码或检查
- ✅ 只想问一个问题就走
- ✅ 管理后台配置（网关/cron/技能/记忆）

### 2.2 REPL 模式（经典命令行交互）

```bash
hermes                               # 默认启动交互式 CLI
hermes --cli                         # 强制经典 REPL（不用 TUI）
hermes -c                            # 继续最近会话
hermes -r session-id                 # 恢复指定会话
```

**特征：**
- 使用 `prompt_toolkit` 库
- 一问一答，会话状态持续保留（上下文不断累计）
- 使用 `/exit` 退出
- 支持历史记录搜索（Ctrl+R）

**何时用：**
- ✅ 在 SSH 远程服务器上工作，没有图形界面
- ✅ 终端不支持 TUI（老旧终端/串口）
- ✅ 习惯纯文本的人
- ❌ 需要看大量代码差异或分屏输出时不太方便

### 2.3 TUI 模式（现代终端界面）

```bash
hermes --tui                          # 启动现代 TUI
hermes --dev --tui                    # 开发者模式（TypeScript 源码运行）
```

**特征：**
- 分屏布局：聊天区 + 工具结果区 + 输入区
- 彩色语法高亮
- 支持鼠标滚轮滚动、点击选择
- 实时流式输出（tokens 逐字出现）
- 快捷键操作（如 Ctrl+P 搜索）
- **REPL vs TUI 的本质区别**：REPL 是纯文本一行一行滚动，TUI 是分屏固定布局

**直观对比：**
```
REPL 模式：                    TUI 模式：
┌─────────────────────┐      ┌─────────────────────┐
│ 你好                 │      │ 你好                 │ ← 对话区
│ > 帮我写个排序        │      │                     │
│ 以下是快速排序...     │      │                     │
│ > 改成Python版本      │      │                     │
│ 好的，Python版本...   │      ├─────────────────────┤
│ >                    │      │ [工具输出]           │ ← 结果区
│                      │      │ File created: ...    │
│                      │      │ ✓ npm install done   │
│                      │      ├─────────────────────┤
│                      │      │ > 输入...            │ ← 输入区（固定底栏）
└─────────────────────┘      └─────────────────────┘
```

**何时用：**
- ✅ 本地终端开发，想同时看到对话和工具输出
- ✅ 处理复杂任务（多文件修改、代码审查）
- ✅ 需要视觉反馈（进度条、实时流式输出）
- ❌ SSH 远程/老旧终端（可能不支持）

### 2.4 IDE / 服务模式（嵌入编辑器）

```bash
hermes serve                          # 启动后端 HTTP 服务
hermes acp                            # ACP 协议服务器模式
hermes mcp serve                      # 作为 MCP 服务器运行
```

**特征：**
- 后台运行，无界面
- 通过协议（ACP/MCP/HTTP）与 IDE 插件通信
- VS Code 扩展连接后，在侧边栏出现 AI 对话面板
- 可以直接读取编辑器打开的文件、选中代码片段

**何时用：**
- ✅ 在 VS Code/JetBrains 中开发
- ✅ 想要 AI 直接理解当前工程上下文
- ✅ 右键菜单 → 解释/重构/测试

### 2.5 GUI 模式（桌面/Web应用）

```bash
hermes dashboard                      # 启动 Web 仪表盘
hermes desktop                        # 构建并启动原生桌面应用
hermes gui                            # 旧版 GUI
```

**特征：**
- Web 浏览器界面或 Electron 原生窗口
- 可视化浏览会话历史、技能列表、配置
- 图表展示使用统计（token 用量、模型调用频率）
- 完整的管理后台

**何时用：**
- ✅ 想要图形化管理所有工具
- ✅ 查看统计分析（insights）
- ✅ 非开发者也能使用（如产品经理）

### 2.6 内置 vs 标准 vs 自定义命令

Hermes 的子命令体系：

```
子命令 = 不启动 AI 对话，直接执行的操作
     ├── 系统管理：config, setup, doctor, logs, status
     ├── 模型管理：model, moa, fallback, login, logout, auth
     ├── 消息网关：gateway, send, webhook, pairing
     ├── 技能/插件：skills, bundles, curator, plugins
     ├── MCP 管理：mcp
     ├── 工具/记忆：tools, memory, computer-use
     ├── 会话管理：sessions, insights
     ├── 定时任务：cron
     ├── 项目管理：project, kanban, hooks
     ├── Profile：profile
     ├── 安全/诊断：security, doctor, dump, debug
     ├── 备份/恢复：backup, import, checkpoints
     └── 其他：version, update, uninstall
```

**关键判断标准：**
- **子命令** → 非对话操作，直接执行，不需要 AI
- **无参数启动** → 进入 REPL/TUI 对话模式
- **`-z` / `chat -q`** → CLI 一次性模式

---

## 三、CodeBuddy CLI（codebuddy / cbc）

### 3.1 CLI 模式（一次性输出）

```bash
codebuddy -p "解释这个代码"               # 一次性问答后退出
codebuddy -p --output-format json        # 结构化 JSON 输出
codebuddy config list                     # 查看配置
codebuddy mcp list                        # 查看 MCP 服务器
codebuddy daemon status                   # 守护进程状态
codebuddy ps                              # 列出活跃会话
```

**特征：**
- 通过 `-p / --print` 标志切换
- 适合管道 `codebuddy -p "xxx" | grep result`
- 适合 CI 集成

### 3.2 REPL / 交互模式（持续对话）

```bash
codebuddy                                # 默认启动交互式
cbc                                      # 简写
codebuddy -c                             # 继续最近对话
codebuddy -r session-id                  # 恢复指定会话
```

**特征：**
- CodeBuddy 的默认模式
- 支持后台运行 `--bg / --background`
- 可以指定 `--max-turns` 限制轮数
- 支持 `--effort` 调整推理努力级别（minimal~max）

### 3.3 IDE 模式（CodeBuddy IDE 扩展）

```bash
codebuddy --serve                        # 启动 HTTP 服务
codebuddy --open                         # 启动后打开浏览器
```

**特征：**
- 作为 YgsoftAiStudio / VS Code 的内置 AI 引擎
- 侧边栏 AI 面板（类似于 GitHub Copilot Chat）
- 右键菜单：解释代码、重构、生成测试、修复问题
- 内联 diff 显示代码修改建议
- 自动读取当前打开的文件 + 选中代码

**CodeBuddy IDE 扩展 vs 纯 CLI REPL：**
```
IDE 模式（YgsoftAiStudio）：              纯 CLI 模式：
┌─────────────────────┐                ┌─────────────────────┐
│ 文件树 | 代码 | AI   │                │ $ codebuddy         │
│         ───────     │                │ > 解释这段代码       │
│  def foo():         │                │                     │
│      pass           │                │ 解释结果...          │
│                     │                │ >                    │
│ ┌─ AI ────────────┐│                │                     │
│ │ 这代码的作用是... ││                │                     │
│ │ [应用修改] [拒绝] ││                └─────────────────────┘
│ └─────────────────┘│
└─────────────────────┘
```

**何时用：**
- ✅ 在 YgsoftAiStudio 里写代码时
- ✅ 想让 AI 直接修改当前文件
- ✅ 需要内联 diff 可视比较

### 3.4 沙箱模式（隔离执行）

```bash
codebuddy --sandbox                      # 在 Docker/E2B 沙箱中运行
codebuddy sandbox list                   # 列出沙箱
codebuddy sandbox kill <id>              # 终止沙箱
```

**特征：** 代码修改在隔离环境中尝试，不影响真实项目

---

## 四、MiMo-Code

### 4.1 CLI 模式（一次性运行）

```bash
mimo run "写一个二分查找"                # 直接处理消息，完成后退出
mimo session list                       # 列出会话
mimo providers list                     # 列出提供商
mimo db "SELECT * FROM sessions"        # 查询数据库
mimo stats                              # 查看 Token 用量统计
```

**特征：**
- 通过 `mimo run` 命令实现一次性模式
- 其他子命令（session / providers / db）也是 CLI 模式

### 4.2 TUI 模式（默认启动）

```bash
mimo [项目路径]                          # 默认进入 TUI 模式
mimo -c                                 # 继续上次 TUI 会话
mimo -s session-id                      # 恢复指定 TUI 会话
```

**特征：**
- **MiMo 的默认模式就是 TUI**（不是 REPL）
- 分屏布局：顶部对话区、底部输入区、右侧面板显示工具状态
- 实时流式输出（tokens 逐字打印）
- 语法高亮
- 彩色显示文件差异化

**REPL 爱好者注意**：MiMo 默认打开就是 TUI，没有纯 REPL 模式。如果终端不支持 TUI，需要用 `mimo run` 走 CLI 模式。

### 4.3 IDE 模式（服务 + MCP 集成）

```bash
mimo serve                              # 启动无界面服务
mimo acp                                # ACP 服务器模式
mimo mcp add <name> <cmd>               # 添加 MCP 服务器
mimo mcp list                           # 列出 MCP 服务器
```

**特征：**
- MiMo 作为 MCP 客户端，连接到 IDE
- VS Code 扩展调用 MiMo 作为编码代理
- 也可以作为 ACP 服务器，供其他客户端连接

---

## 五、三套工具的界面模式矩阵

| 模式 | Hermes Agent | CodeBuddy CLI | MiMo-Code |
|:----:|:------------:|:-------------:|:---------:|
| **CLI**（一次性） | `-z` / `chat -q` | `-p / --print` | `mimo run` |
| **REPL**（纯文本聊天） | ✅ 默认模式 | ✅ 默认模式 | ❌ 无（仅 TUI） |
| **TUI**（分屏终端界面） | `--tui` 可选 | ❌ 无 | ✅ **默认模式** |
| **IDE 扩展**（编辑器内嵌） | ACP/MCP 服务 | YgsoftAiStudio 内置 | MCP 客户端 |
| **GUI**（桌面/Web） | `dashboard` / `desktop` | `--serve --open` | ❌ 无 |
| **消息网关**（微信/TG） | ✅ **独家特色** | ❌ 无 | ❌ 无 |
| **后台守护进程** | `gateway` 内建 | `daemon start` | `serve` |
| **沙箱隔离** | 外部 (E2B) | ✅ 内置 Docker/E2B | ❌ 无 |
| **定时任务** | ✅ **独家** cron 调度 | ❌ 无 | ❌ 无 |
| **多 Profile** | ✅ **独家** 隔离实例 | ❌ 无 | ❌ 无 |

---

## 六、使用场景决策树

```
你要做什么？
│
├─ 在电脑上写代码 ─────────────────────────────┐
│   ├─ 在 VS Code/YgsoftAiStudio 里          → IDE 模式（CodeBuddy）
│   ├─ 在终端里，想看分屏效果                 → TUI 模式（MiMo / hermes --tui）
│   └─ 在终端里，只要纯文本聊天               → REPL 模式（hermes / CodeBuddy）
│
├─ 远程服务器/SSH 访问 ────────────────────────┐
│   ├─ 终端支持颜色 → TUI（hermes --tui）或 REPL
│   └─ 老旧终端/串口 → REPL 模式（hermes --cli）
│
├─ 写脚本/自动化 ─────────────────────────────┐
│   └─ CLI 模式（hermes -z / codebuddy -p / mimo run）
│
├─ 管理配置/维护系统 ─────────────────────────┐
│   └─ CLI 子命令（hermes config/gateway/cron...）
│
├─ 随时随地不在电脑前 ─────────────────────────┐
│   └─ 微信网关（Hermes → 微信消息聊天）
│
├─ 查看使用统计/可视化管理 ─────────────────────┐
│   └─ GUI 模式（hermes dashboard）
│
└─ 批量自动化、定时执行 ────────────────────────┐
    └─ cron 定时任务（Hermes 独家）
```

---

## 七、一句话总结

> **CLI = 问一句走人，REPL = 坐下来聊，TUI = 分屏边看边聊，IDE = 嵌在代码编辑器里聊，GUI = 打开软件窗口聊。**

- Hermes Agent：模式最全，五种都有，还有微信/TG 网关和 cron 独家能力
- CodeBuddy CLI：强调 IDE 集成 + 沙箱隔离，适合在编辑器里开发
- MiMo-Code：默认 TUI，启动就是可视化终端，适合编码型任务

---

*创建日期：2026-07-03*
*来源：各工具 --help 实时输出 + 实战使用经验*
*关联文档：[[AI-CLI工具命令参考.md]]*
