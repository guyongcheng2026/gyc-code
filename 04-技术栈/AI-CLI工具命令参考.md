# AI CLI 工具命令参考手册

> 涵盖 **Hermes Agent**、**CodeBuddy CLI**、**MiMo-Code** 三套 AI 编码代理 CLI 工具的全部命令及作用。参照日期: 2026-07-01，均从各工具 `--help` 实时输出整理。

---

## 一、Hermes Agent

当前运行环境，由 Nous Research 开发的开源 AI 智能体，支持工具调用、多平台网关、MCP、技能系统等。

### 基础用法

```bash
hermes                        # 启动交互式聊天
hermes <子命令>               # 执行具体子命令
hermes -z "提示词"            # 一次性模式
hermes -c                     # 继续最近会话
```

### 全局选项

| 选项 | 作用 |
|------|------|
| `-h, --help` | 显示帮助 |
| `-V, --version` | 显示版本 |
| `-z, --oneshot <PROMPT>` | 一次性模式，仅输出结果文本 |
| `-m, --model <MODEL>` | 临时覆盖模型 |
| `--provider <PROVIDER>` | 临时覆盖提供商 |
| `-t, --toolsets <TOOLSETS>` | 临时覆盖启用的工具集 |
| `-r, --resume <SESSION>` | 按 ID 恢复会话 |
| `-c, --continue [NAME]` | 按名称恢复最近会话 |
| `-w, --worktree` | 在隔离 Git worktree 中运行 |
| `-s, --skills <SKILLS>` | 预加载技能 |
| `--yolo` | 跳过所有危险命令审批 |
| `--ignore-user-config` | 忽略用户配置，回退到内置默认值 |
| `--ignore-rules` | 跳过 AGENTS.md/SOUL.md/记忆/技能注入 |
| `--safe-mode` | 安全模式：禁用所有自定义 |
| `--tui` | 启动现代 TUI |
| `--cli` | 强制经典 REPL |
| `--accept-hooks` | 自动批准 shell 钩子 |

### 子命令一览

| 级别 | 命令 | 作用 |
|------|------|------|
| **核心** | `chat` | 交互式聊天对话 |
| **模型** | `model` | 选择默认模型和提供商 |
| | `moa` | 配置混合模型（MoA）插槽 |
| | `fallback` | 管理备用提供商链 |
| | `migrate` | 迁移已弃用的模型/配置 |
| **认证** | `login` | OAuth 登录推理提供商 |
| | `logout` | 清除推理提供商认证 |
| | `auth` | 管理池化提供商凭据 |
| **消息** | `gateway` | 消息网关管理（TG/Discord/WhatsApp/微信等） |
| | `send` | 向已配置平台发送消息 |
| | `webhook` | 管理动态 Webhook 订阅 |
| | `pairing` | 管理 DM 配对码 |
| **配置** | `config` | 查看和编辑配置 |
| | `setup` | 交互式安装向导 |
| | `postinstall` | 安装非 Python 依赖 |
| | `proxy` | 本地 OpenAI 兼容代理 |
| | `lsp` | 语言服务器协议管理 |
| | `doctor` | 诊断配置和依赖问题 |
| | `security` | 供应链安全审计 |
| **技能/插件** | `skills` | 搜索/安装/管理技能 |
| | `bundles` | 管理技能包（多技能别名） |
| | `curator` | 后台技能维护 |
| | `plugins` | 管理插件 |
| **MCP** | `mcp` | 管理 MCP 服务器/作为 MCP 运行 |
| **工具** | `tools` | 配置每平台启用的工具集 |
| | `computer-use` | 管理计算机操作后端 |
| **记忆** | `memory` | 配置外部记忆提供商 |
| | `journey` / `learning` / `memory-graph` | 技能+记忆时间线 |
| **会话** | `sessions` | 会话历史管理 |
| | `insights` | 使用统计 |
| **调度** | `cron` | 定时任务管理 |
| **Profile** | `profile` | 多 profile 管理 |
| **项目** | `project` | 项目管理 |
| | `kanban` | 协作看板 |
| | `hooks` | shell 钩子管理 |
| **日志** | `logs` | 查看和过滤日志 |
| | `dump` | 导出配置摘要 |
| | `debug` | 调试/上传日志 |
| **备份** | `backup` | 备份家目录 |
| | `import` | 从备份恢复 |
| | `checkpoints` | 检查/清理检查点 |
| **界面** | `dashboard` | 启动 Web UI 仪表盘 |
| | `serve` | 启动无界面后端服务 |
| | `desktop` / `gui` | 构建原生桌面应用 |
| | `tui` / `cli` | 切换界面模式 |
| **版本** | `version` | 版本信息 |
| | `update` | 更新到最新版 |
| | `uninstall` | 卸载 |
| **协议** | `acp` | 以 ACP 服务器模式运行 |
| **杂项** | `secrets` | 管理外部密钥来源 |
| | `whatsapp` / `whatsapp-cloud` / `slack` | 平台集成设置 |
| | `portal` | 配置 Nous Portal |
| | `pets` | 桌面宠物 |
| | `claw` | OpenClaw 迁移 |
| | `completion` | shell 补全脚本 |
| | `prompt-size` | 显示提示词大小分析 |

### `hermes config` 子命令

| 子命令 | 作用 |
|--------|------|
| `show` | 显示当前配置 |
| `edit` | 编辑配置文件 |
| `set` | 设置配置值 |
| `path` | 显示配置路径 |
| `env-path` | 显示 .env 路径 |
| `check` | 检查缺少/过时配置 |
| `migrate` | 更新配置到新版 |

### `hermes skills` 子命令

| 子命令 | 作用 |
|--------|------|
| `browse` | 浏览所有可用技能 |
| `search` | 搜索技能仓库 |
| `install` | 安装技能 |
| `inspect` | 预览技能（不安装） |
| `list` | 列出已安装技能 |
| `check` | 检查技能是否有更新 |
| `update` | 更新技能 |
| `audit` | 重新扫描已安装技能 |
| `uninstall` | 移除技能 |
| `reset` | 重置技能到出厂版 |
| `list-modified` | 列出被修改过的捆绑技能 |
| `diff` | 显示与官方版的差异 |
| `opt-out` / `opt-in` | 禁用/启用内置技能注入 |
| `repair-official` | 恢复官方可选技能 |
| `publish` | 发布技能到仓库 |
| `snapshot` | 导入/导出技能配置 |
| `tap` | 管理技能来源 |
| `config` | 交互式启用/禁用技能 |

### `hermes cron` 子命令

| 子命令 | 作用 |
|--------|------|
| `list` | 列出所有定时任务 |
| `create` / `add` | 创建定时任务 |
| `edit` | 编辑任务 |
| `pause` | 暂停任务 |
| `resume` | 恢复任务 |
| `run` | 立即执行任务 |
| `remove` / `rm` / `delete` | 删除任务 |
| `status` | 检查调度器状态 |
| `tick` | 一次性执行到期任务 |

### `hermes gateway` 子命令

| 子命令 | 作用 |
|--------|------|
| `run` | 前台运行网关 |
| `start` / `stop` / `restart` | 启停后台网关服务 |
| `status` | 查看网关状态 |
| `install` / `uninstall` | 安装/卸载系统服务 |
| `list` | 列出 profile 网关状态 |
| `setup` | 配置消息平台 |
| `migrate-legacy` | 清理旧版服务 |
| `enroll` | 注册到中继连接器 |

### `hermes sessions` 子命令

| 子命令 | 作用 |
|--------|------|
| `list` | 列出最近会话 |
| `export` | 导出到 JSONL 文件 |
| `delete` | 删除会话 |
| `prune` | 清理旧会话 |
| `optimize` | 回收磁盘空间 |
| `repair` | 修复损坏的 state.db |
| `stats` | 会话存储统计 |
| `rename` | 重命名会话 |
| `browse` | 交互式会话选择器 |

### `hermes mcp` 子命令

| 子命令 | 作用 |
|--------|------|
| `serve` | 作为 MCP 服务器运行 |
| `add` | 添加 MCP 服务器 |
| `remove` / `rm` | 移除 MCP 服务器 |
| `list` / `ls` | 列出 MCP 服务器 |
| `test` | 测试连接 |
| `configure` / `config` | 切换工具选择 |
| `login` / `reauth` | OAuth 重新认证 |
| `picker` | 交互式目录选择器 |
| `catalog` | 列出 Nous 批准的 MCP |
| `install` | 按名称安装 MCP |

### `hermes plugins` 子命令

| 子命令 | 作用 |
|--------|------|
| `install` | 从 Git URL 安装插件 |
| `update` | 拉取更新 |
| `remove` / `rm` / `uninstall` | 移除插件 |
| `list` / `ls` | 列出已安装插件 |
| `enable` / `disable` | 启用/禁用插件 |

### `hermes profile` 子命令

| 子命令 | 作用 |
|--------|------|
| `list` | 列出所有 profile |
| `use` | 设置默认 profile |
| `create` / `delete` | 创建/删除 profile |
| `describe` / `show` | 查看 profile 详情 |
| `alias` | 管理 wrapper 脚本 |
| `rename` | 重命名 |
| `export` / `import` | 导入/导出归档 |
| `install` | 安装 profile 发行版 |
| `update` | 拉取 profile 更新 |
| `info` | 显示发行版清单 |

### `hermes logs` 用法

| 参数 | 作用 |
|------|------|
| `agent`（默认） | 主体日志 |
| `errors` | 错误日志 |
| `gateway` | 网关日志 |
| `gui` | GUI 日志 |
| `desktop` | 桌面应用日志 |
| `list` | 列出日志文件 |
| `-f, --follow` | 实时跟踪 |
| `-n N` | 显示行数 |
| `--since 1h` | 时间范围过滤 |
| `--level WARNING` | 级别过滤 |
| `--component NAME` | 组件过滤 |
| `--session ID` | 按会话 ID 过滤 |

### `hermes memory` 子命令

| 子命令 | 作用 |
|--------|------|
| `setup` | 选择配置外部记忆提供商 |
| `status` | 查看当前记忆配置 |
| `off` | 禁用外部记忆 |
| `reset` | 清除内置记忆 |

---

## 二、CodeBuddy CLI (codebuddy / cbc)

CodeBuddy Code 是一款 AI 编码代理 CLI，支持多模型、沙箱、MCP、插件、后台守护进程等。

### 基础用法

```bash
codebuddy [选项] [命令] [提示词]
cbc       [选项] [命令] [提示词]
# 不带命令时启动交互式会话
```

### 主要选项

| 选项 | 作用 |
|------|------|
| `-p, --print` | 一次性输出后退出（适合管道） |
| `-c, --continue` | 继续最近对话 |
| `-r, --resume [id]` | 恢复指定会话 |
| `-w, --worktree [name]` | 创建 Git worktree |
| `--tmux` | 在 tmux 会话中运行 |
| `-y, --dangerously-skip-permissions` | 跳过权限检查 |
| `--model <model>` | 指定模型 |
| `--agent <agent>` | 指定智能体 |
| `--tools <value>` | 限制可用内置工具 |
| `--mcp-config <fileOrString>` | 加载 MCP 配置 |
| `--add-dir <dirs...>` | 额外允许访问的目录 |
| `--max-turns <number>` | 限制最大交互轮数 |
| `--effort <level>` | 推理努力级别 |
| `--sandbox [url]` | 在沙箱中运行 |
| `--bg / --background` | 后台运行 |
| `--name <name>` | 后台会话命名 |
| `--swarm` | 启用集群模式 |
| `--system-prompt <prompt>` | 覆盖系统提示词 |
| `--serve` | 暴露 HTTP 服务 |
| `--open` | 启动后打开浏览器 |
| `--port <port>` | 指定 HTTP 端口 |
| `--host <string>` | 绑定地址 |
| `--acp` | ACP 模式 |
| `--fork-session` | 分叉会话 |
| `--output-format <format>` | 输出格式（text/json/stream-json） |
| `--permission-mode <mode>` | 权限模式 |
| `--input-format <format>` | 输入格式 |
| `--json-schema <schema>` | 结构化输出校验 |
| `--channels <value>` | 启用特定频道 |
| `--settings <file-or-json>` | 加载额外设置 |
| `--remote-control` | 远程控制服务 |
| `--debug [filter]` | 调试模式 |
| `--verbose` | 详细输出 |

### 子命令

| 命令 | 作用 |
|------|------|
| `config` | 配置管理 |
| `config get <key>` | 获取配置值 |
| `config set <key> <value>` | 设置配置值 |
| `config remove / rm <key>` | 删除配置值 |
| `config list / ls` | 列出所有配置 |
| `config add <key> <value>` | 向配置数组添加项 |
| `mcp` | MCP 服务器管理 |
| `mcp add <name> <cmdOrUrl>` | 添加 MCP 服务器 |
| `mcp remove <name>` | 移除 MCP 服务器 |
| `mcp list / ls` | 列出 MCP 服务器 |
| `mcp get <name>` | 查看 MCP 详情 |
| `mcp add-json <name> <json>` | 用 JSON 添加 MCP |
| `sandbox` | 沙箱管理 |
| `sandbox list / ls` | 列出所有沙箱 |
| `sandbox info [id]` | 沙箱详情 |
| `sandbox kill <id>` | 终止沙箱 |
| `sandbox clean` | 清理已停止沙箱 |
| `plugin` | 插件管理 |
| `plugin install <plugin>` | 安装插件 |
| `plugin uninstall <plugin>` | 卸载插件 |
| `plugin enable / disable` | 启用/禁用插件 |
| `plugin update <plugin>` | 更新插件 |
| `plugin validate <path>` | 验证插件清单 |
| `plugin marketplace` | 市场管理 |
| `daemon` | 守护进程管理 |
| `daemon start / stop / restart` | 启停守护进程 |
| `daemon status` | 守护进程状态 |
| `ps` | 列出所有活跃会话 |
| `logs <pidOrName>` | 查看后台会话日志 |
| `attach <pidOrName>` | 连接到后台会话 |
| `kill <pidOrName>` | 终止后台会话 |
| `doctor` | 检查自动更新器健康 |
| `update` | 检查并安装更新 |
| `install [target]` | 安装原生构建 |
| `auto-mode` | 检查自动模式分类器配置 |

---

## 三、MiMo-Code (mimo)

开源 AI 编码代理，支持 MCP、多模型、会话管理、统计数据等。

### 基础用法

```bash
mimo [项目路径]               # 启动 TUI（默认）
mimo <命令>                   # 执行子命令
```

### 全局选项

| 选项 | 作用 |
|------|------|
| `-m, --model <provider/model>` | 指定模型 |
| `-c, --continue` | 继续上次会话 |
| `-s, --session <id>` | 恢复指定会话 |
| `--fork` | 分叉会话 |
| `--agent <name>` | 指定智能体 |
| `--never-ask` | 免询问模式 |
| `--trust` | 跳过工作区信任 |
| `--port <port>` | 监听端口 |
| `--hostname <host>` | 绑定地址 |
| `--no-auth` | 无认证启动（危险） |
| `--log-level <level>` | 日志级别 |
| `--pure` | 不带外部插件运行 |
| `--print-logs` | 日志输出到 stderr |
| `--mdns` | 启用 mDNS 发现 |
| `--cors <domains>` | 额外 CORS 域名 |
| `--prompt <text>` | 指定提示词 |

### 子命令

| 命令 | 作用 |
|------|------|
| `completion` | 生成 shell 补全脚本 |
| `acp` | 以 ACP 服务器模式启动 |
| `mcp` | 管理 MCP 服务器 |
| `mcp add` | 添加 MCP 服务器 |
| `mcp list / ls` | 列出 MCP 服务器 |
| `mcp auth [name]` | OAuth 认证 MCP |
| `mcp logout [name]` | 移除 OAuth 凭证 |
| `mcp debug <name>` | 调试 OAuth 连接 |
| `attach <url>` | 连接到运行中的服务 |
| `run [message..]` | 直接处理消息 |
| `debug` | 调试和故障排除工具 |
| `providers` / `auth` |AI 提供商和凭据管理 |
| `providers list / ls` | 列出提供商和凭据 |
| `providers login [url]` | 登录提供商 |
| `providers logout` | 登出提供商 |
| `providers whoami` | 当前登录用户 |
| `agent` | 智能体管理 |
| `agent create` | 创建智能体 |
| `agent list` | 列出智能体 |
| `upgrade [target]` | 升级到指定版本 |
| `uninstall` | 卸载并删除全部文件 |
| `serve` | 启动无界面服务 |
| `models [provider]` | 列出可用模型 |
| `stats` | Token 用量和成本统计 |
| `export [sessionID]` | 导出会话为 JSON |
| `import <file>` | 从 JSON 导入会话 |
| `github` | 管理 GitHub 智能体 |
| `pr <number>` | 拉取 PR 分支并运行 mimo |
| `session` | 会话管理 |
| `session list` | 列出会话 |
| `session delete <id>` | 删除会话 |
| `session import-claude` | 从 Claude Code 导入会话 |
| `plugin <module>` | 安装插件 |
| `db` | 数据库工具 |
| `db [query]` | 打开 SQLite shell 或执行查询 |
| `db path` | 打印数据库路径 |
| `db migrate` | JSON 迁移到 SQLite |

---

## 四、对比总结

| 维度 | Hermes Agent | CodeBuddy CLI | MiMo-Code |
|------|-------------|---------------|-----------|
| **开发商** | Nous Research | CodeBuddy (独立) | MiMo-Code (独立) |
| **基础语言** | Python | Node.js | Node.js |
| **核心特点** | 多平台网关、技能系统、cron 调度、Profile 隔离 | 沙箱、worktree、后台守护进程、插件市场 | MCP 原生、数据库管理、统计 |
| **消息平台** | Telegram/Discord/WhatsApp/微信/Slack | 无原生网关 | 无原生网关 |
| **MCP 支持** | 既是客户端也是服务器 | 客户端 | 客户端 |
| **记忆系统** | 内置 .md + 外部提供商 | 内置会话 | 内置会话 |
| **配置** | YAML + 环境变量 | JSON/设置文件 | JSON |
| **会话管理** | SQLite + FTS5 搜索 | 内置历史 | 内置历史 |
| **定时任务** | 原生 cron 调度 | 无 | 无 |
| **多 Profile** | 原生支持 | 无 | 无 |
| **沙箱** | 外部 (E2B) | 内置 Docker/E2B | 无 |
| **技能/插件** | .md 技能 + Git 插件 | 插件市场 + Git | Git 插件 |
| **模型选择** | 多提供商 + 回退链 | 多模型 + 回退 | 多提供商 |

---

## 相关笔记

- [[Hermes Agent 使用笔记]]
- [[CodeBuddy CLI 使用经验]]
- [[AI 编码代理对比分析]]

---

*创建日期: 2026-07-01*
*来源: 各工具 `--help` 实时输出整理*
*更新记录: 首次整理，覆盖三套工具全部命令*
