# -*- coding: utf-8 -*-
"""
scripts/manual-content-2.py
《gyccode 操作手册》正文 —— 第五章（命令速查）与第六章（界面与快捷键）。
"""
from docx.enum.text import WD_ALIGN_PARAGRAPH

from manual_docx_style import (FONT_BODY, FONT_H1, FONT_H2, SZ_BODY, SZ_TITLE,
                             body, code, h1, h2, h3, h4, note, para, plain,
                             set_run_font, table)


def chapter5(doc):
    h1(doc, "五、命令速查")
    note(doc, "本章全部命令、选项与默认值均取自程序实际帮助输出，未经臆测补写。")

    h2(doc, "（一）全局选项")
    body(doc, "以下选项对所有命令均有效。")
    table(doc, [
        ["选项", "作用"],
        ["-h, --help", "显示帮助信息"],
        ["-v, --version", "显示版本号"],
        ["--print-logs", "将运行日志输出至标准错误流，排错时使用"],
        ["--log-level <级别>", "日志级别，可选 DEBUG、INFO、WARN、ERROR"],
        ["--pure", "不加载外部插件运行，用于排除插件干扰"],
    ], widths=[5.0, 10.0])

    h2(doc, "（二）开始使用的常用命令")
    table(doc, [
        ["命令", "用途", "常用选项"],
        ["gyc [项目路径]", "启动终端全屏界面（默认命令）",
         "-m 模型、-c 继续、-s 会话、--fork 派生、--prompt 提示、--agent 智能体"],
        ["gyc tui [项目路径]", "同上，显式写法", "同上"],
        ["gyc web", "启动服务并打开浏览器界面",
         "--port 端口、--hostname 主机名、--mdns、--cors"],
        ["gyc run [消息...]", "携带消息单轮运行",
         "-c、-s、--fork、--share、-m、--agent、--format、-f、--title、--attach、--auto"],
        ["gyc cli [消息...]", "纯命令行界面。传消息为单轮；不传则进入逐行对话",
         "-c、-s、--fork、-m、--agent、-f、--auto"],
    ], widths=[4.0, 5.2, 5.8])

    h3(doc, "1. 单轮运行的常用组合")
    code(doc,
         "gyc run \"分析这段代码\"                          # 单轮提问\n"
         "gyc run -c \"继续\"                               # 接着上一次会话\n"
         "gyc run -m deepseek/deepseek-chat \"翻译成英文\"   # 指定模型\n"
         "gyc run --agent plan \"帮我设计重构方案\"          # 只读分析，不改文件\n"
         "gyc run -f ./需求.md \"按这个文档实现\"            # 附加文件\n"
         "gyc run --format json \"...\"                     # 输出机器可读格式\n"
         "gyc run --thinking \"复杂推理题\"                  # 显示思考过程\n"
         "gyc run --auto \"...\"                            # 自动批准权限（危险）")

    h2(doc, "（三）服务与接入")
    table(doc, [
        ["命令", "用途", "常用选项"],
        ["gyc serve", "启动无头服务（仅后台，无界面）",
         "--port（默认 0，即随机端口）、--hostname（默认 127.0.0.1）、--mdns、--cors"],
        ["gyc attach <网址>", "连接至已在运行的服务端",
         "--dir、-c、-s、--fork、-p 密码、-u 用户名"],
        ["gyc acp", "启动编辑器协议服务，供相应编辑器调用",
         "同 serve，另加 --cwd 工作目录"],
    ], widths=[3.2, 5.0, 6.8])
    code(doc,
         "# 第一个终端：启动服务\n"
         "gyc serve --port 4096\n\n"
         "# 第二个终端（或另一台机器）：接入\n"
         "gyc attach http://localhost:4096")
    note(doc, "注意：服务默认仅监听 127.0.0.1，即只有本机可以访问。"
              "若需局域网访问，必须显式指定 --hostname 0.0.0.0，"
              "此时务必通过 -p 参数或环境变量 GYCCODE_SERVER_PASSWORD 设置访问密码。")

    h2(doc, "（四）模型与服务商")
    code(doc,
         "gyc models                    # 列出全部可用模型\n"
         "gyc models deepseek           # 仅列出指定服务商\n"
         "gyc models --verbose          # 显示成本等元数据\n"
         "gyc models --refresh          # 从 models.dev 刷新模型缓存\n\n"
         "gyc providers list            # 列出服务商与凭据（别名 ls）\n"
         "gyc providers login           # 登录并配置服务商\n"
         "gyc providers logout 服务商   # 登出")
    body(doc, "gyc providers 的别名为 gyc auth。")

    h2(doc, "（五）会话与数据")
    code(doc,
         "gyc session list                 # 列出会话\n"
         "gyc session delete 会话标识       # 删除会话\n\n"
         "gyc export [会话标识]             # 导出会话为 JSON\n"
         "gyc export --cost                # 导出成本账（任务维度、压缩成本、缓存命中率）\n"
         "gyc export --sanitize            # 脱敏后导出，对外分享前使用\n"
         "gyc import 文件或网址             # 导入会话\n\n"
         "gyc db path                      # 打印数据库路径\n"
         "gyc db query \"SELECT ...\"        # 执行 SQL 查询或进入交互式环境\n"
         "gyc db cleanup                   # 清理孤立事件并整理数据库\n"
         "gyc db compact                   # 压缩冗长工具输出，缩小数据库\n"
         "gyc db cache                     # 报告近期提示缓存命中率")

    h2(doc, "（六）成本统计")
    code(doc,
         "gyc stats                # 令牌用量与成本\n"
         "gyc stats --days 7       # 最近 7 天\n"
         "gyc stats --models       # 按模型拆分\n"
         "gyc stats --tools 10     # 用量前十的工具\n"
         "gyc stats --project      # 仅当前项目\n"
         "gyc stats --reconcile    # 与服务商账单对账\n\n"
         "gyc task list            # 按任务（单轮对话）查看成本与成败")

    h2(doc, "（七）扩展能力管理")
    code(doc,
         "# 智能体\n"
         "gyc agent list\n"
         "gyc agent create\n\n"
         "# 外部协议服务器\n"
         "gyc mcp list             # 列出服务器及状态\n"
         "gyc mcp add [名称]       # 添加\n"
         "gyc mcp catalog [关键词]  # 浏览可审计目录（标注权限、传输方式与数据流向）\n"
         "gyc mcp install 名称      # 从目录安装（安装前先展示权限与数据流向）\n"
         "gyc mcp auth [名称]      # 授权认证\n"
         "gyc mcp logout [名称]    # 清除凭据\n"
         "gyc mcp debug 名称        # 调试连接\n\n"
         "# 插件\n"
         "gyc plugin list          # 别名 gyc plug\n"
         "gyc plugin search 关键词\n"
         "gyc plugin install 模块\n\n"
         "# 记忆\n"
         "gyc memory read\n"
         "gyc memory write 键 值\n"
         "gyc memory sync\n\n"
         "# 技能沉淀\n"
         "gyc learning status      # 自建技能库概况\n"
         "gyc learning usage       # 按最近活跃度列出用量\n"
         "gyc learning rollback 标识  # 回滚某次技能变更\n"
         "gyc learning archive 名称  # 归档\n"
         "gyc learning restore 名称  # 从归档恢复\n"
         "gyc learning tick        # 按闲置时长推进生命周期（闲置 30 天、归档 90 天）\n\n"
         "# 工作流\n"
         "gyc workflow defs        # 列出可用工作流\n"
         "gyc workflow start 工作流  # 在会话上启动\n"
         "gyc workflow status [运行] # 查看状态或列出运行记录\n"
         "gyc workflow abort 运行   # 中止")

    h2(doc, "（八）代码托管与协作")
    code(doc,
         "gyc pr 编号           # 拉取并检出合并请求分支，随后启动系统\n"
         "gyc github install   # 安装代码托管平台智能体\n"
         "gyc github run       # 运行代码托管平台智能体")

    h2(doc, "（九）即时通讯网关")
    code(doc,
         "gyc pair                 # 扫码配对，凭据保存至 ~/.gyc/.env\n"
         "gyc gateway              # 启动守护进程，轮询消息并自动回复\n"
         "gyc send \"消息内容\"        # 经网关发送消息\n"
         "gyc send --to weixin:会话号 # 指定投递目标\n"
         "gyc send --json          # 输出机器可读结果")

    h2(doc, "（十）账号与排错")
    code(doc,
         "gyc account                       # 账号登录与管理\n\n"
         "# 任何命令均可附加以下参数进行排错\n"
         "gyc --log-level DEBUG --print-logs <命令>   # 输出详细日志\n"
         "gyc --pure <命令>                            # 排除插件干扰")


def chapter6(doc):
    h1(doc, "六、界面与快捷键")
    body(doc, "本章说明终端全屏界面的操作要领。"
              "浏览器界面的功能构成见本章第十节。")

    h2(doc, "（一）前缀键的使用习惯")
    body(doc, "终端界面大量快捷键采用“前缀键加字母”的组合方式："
              "先按住 Ctrl+X（前缀键，即部分文档所称的 leader 键），"
              "松开后再按一个字母或方向键完成组合。"
              "按下 Ctrl+X 后，界面底部会弹出当前可用的后续按键提示。"
              "掌握该单一按键后，其余组合键均可由此推知。"
              "本手册所有组合键均直接写实际按键；"
              "若在配置文件的 keybinds.leader 项中修改过前缀键，以修改后的为准。")

    h2(doc, "（二）基本操作")
    table(doc, [
        ["快捷键", "作用"],
        ["Ctrl+C / Ctrl+D", "清空输入框 / 退出"],
        ["Enter", "提交输入"],
        ["Shift+Enter", "输入框内换行"],
        ["Ctrl+V", "从剪贴板粘贴"],
        ["上 / 下方向键", "翻阅历史输入"],
        ["Esc", "中断当前正在执行的任务"],
        ["Ctrl+P", "打开命令面板，列出全部可用命令"],
        ["/", "打开斜杠命令列表（技能与动作）"],
        ["Tab / Shift+Tab", "切换至下一个 / 上一个智能体"],
        ["Ctrl+Alt+K", "切换快捷键提示面板（遗忘键位时使用）"],
    ], widths=[4.4, 10.6])

    h2(doc, "（三）会话操作")
    table(doc, [
        ["快捷键", "作用"],
        ["Ctrl+X 后按 N", "新建会话"],
        ["Ctrl+X 后按 L", "列出全部会话"],
        ["Ctrl+R", "重命名会话"],
        ["Ctrl+D", "删除会话"],
        ["Ctrl+F", "在会话列表中置顶或取消置顶"],
        ["Ctrl+B", "将同步执行的子智能体转为后台运行"],
        ["Ctrl+X 后按 C", "压缩会话（上下文过长时使用，可节省令牌消耗）"],
        ["Ctrl+X 后按 G", "显示会话时间线"],
        ["Ctrl+X 后按 X", "导出会话至编辑器"],
        ["Ctrl+X 后按 1~9", "快速切换至第 1 至第 9 号快捷会话"],
        ["Ctrl+X 后按 Q", "管理排队中的提示词"],
        ["上 / 下方向键", "返回父会话 / 进入首个子会话"],
        ["左 / 右方向键", "切换至上一个 / 下一个子会话"],
    ], widths=[4.4, 10.6])

    h2(doc, "（四）模型与服务商")
    table(doc, [
        ["快捷键", "作用"],
        ["Ctrl+X 后按 M", "列出可用模型"],
        ["F2 / Shift+F2", "切换至下一个 / 上一个最近使用的模型"],
        ["Ctrl+A", "从模型对话框打开服务商列表"],
        ["Ctrl+F", "切换模型收藏状态"],
        ["Ctrl+T", "循环切换模型变体（推理强度）"],
        ["Ctrl+X 后按 A", "列出智能体"],
    ], widths=[4.4, 10.6])

    h2(doc, "（五）界面显示")
    table(doc, [
        ["快捷键", "作用"],
        ["Ctrl+X 后按 B", "切换侧栏"],
        ["Ctrl+X 后按 S", "查看状态"],
        ["Ctrl+X 后按 P", "提示词历史"],
        ["Ctrl+X 后按 Y", "复制消息"],
        ["Ctrl+X 后按 U / R", "撤销 / 重做消息"],
        ["Ctrl+X 后按 H", "切换代码块隐藏 / 首页提示"],
        ["PageUp / PageDown", "消息上翻 / 下翻一页"],
        ["Ctrl+G / Home", "跳至第一条消息"],
        ["Ctrl+Alt+G / End", "跳至最后一条消息"],
        ["Ctrl+Z", "挂起终端"],
    ], widths=[4.4, 10.6])

    h2(doc, "（六）差异查看器")
    body(doc, "用于核查模型对文件所作的改动。")
    table(doc, [
        ["快捷键", "作用"],
        ["Enter / Space", "切换条目"],
        ["右 / 左方向键", "展开 / 折叠"],
        ["E", "展开全部文件夹"],
        ["Tab", "切换焦点"],
        ["] / [", "跳至下一个 / 上一个区块"],
        ["n / p", "跳至下一个 / 上一个文件"],
        ["b", "切换文件树"],
        ["s", "切换单补丁视图"],
        ["d", "切换来源"],
        ["v", "并排视图与统一视图切换"],
        ["?", "显示更多差异查看器快捷键"],
        ["Esc / q", "关闭差异查看器"],
    ], widths=[4.4, 10.6])
    note(doc, "建议：模型完成工作后，先使用差异查看器逐条核查其所作改动，"
              "确认无误后再行接受。")

    h2(doc, "（七）快捷键提示面板")
    table(doc, [
        ["快捷键", "作用"],
        ["Ctrl+Alt+K", "切换快捷键提示面板"],
        ["Ctrl+Alt+Shift+K", "切换面板布局"],
        ["Ctrl+Alt+左 / 右", "上一个 / 下一个分组"],
        ["Ctrl+Alt+上 / 下", "上滚 / 下滚"],
        ["Ctrl+Alt+PageUp / PageDown", "上翻 / 下翻一页"],
    ], widths=[5.0, 10.0])

    h2(doc, "（八）输入框编辑")
    body(doc, "输入框编辑方式与命令行通用编辑习惯一致。")
    table(doc, [
        ["快捷键", "作用"],
        ["Ctrl+A / Ctrl+E", "移至行首 / 行尾"],
        ["Alt+A / Alt+E", "移至显示行首 / 显示行尾"],
        ["Home / End", "移至缓冲区开头 / 末尾"],
        ["Ctrl+K / Ctrl+U", "删除至行尾 / 删除至行首"],
        ["Ctrl+Shift+D", "删除整行"],
        ["Alt+F / Alt+B", "按词前移 / 后移"],
        ["Ctrl+W", "向前删除一个词"],
        ["Ctrl+- / Ctrl+.", "撤销 / 重做"],
        ["Super+A（macOS 为 Cmd+A）", "全选"],
    ], widths=[5.0, 10.0])

    h2(doc, "（九）命令面板与斜杠命令")
    body(doc, "按 Ctrl+P 打开命令面板，其中列出当前全部可用命令，"
              "包括系统内置命令、技能以及外部协议服务器提供的命令。")
    body(doc, "输入斜杠符号可打开斜杠命令列表。列表展示英文命令名，"
              "中文名作为别名，二者均可输入。")
    body(doc, "系统内置斜杠命令如下。")
    table(doc, [
        ["命令", "作用"],
        ["/init", "引导式生成项目说明文件 AGENTS.md，供模型阅读"],
        ["/review", "审查更改，可接 commit、branch、pr，默认审查未提交的更改"],
        ["/skill-create", "创建可复用技能，加 --global 参数则写入全局技能目录"],
    ], widths=[3.6, 11.4])

    h2(doc, "（十）浏览器界面构成")
    body(doc, "执行 gyc web 启动服务并打开浏览器后，界面包含以下部分。")
    table(doc, [
        ["面板", "功能"],
        ["对话面板", "流式显示消息，处理工具审批"],
        ["文件树", "显示项目文件，并标注版本控制状态"],
        ["文件查看器", "Monaco 代码编辑器"],
        ["差异视图", "展示本次会话产生的改动"],
        ["终端", "内嵌 xterm 终端"],
    ], widths=[3.6, 11.4])
