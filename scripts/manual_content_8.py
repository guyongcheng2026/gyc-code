# -*- coding: utf-8 -*-
"""
scripts/manual_content_8.py
《gyccode 操作手册》正文 —— 附录 A（命令使用示例）。

体例：每条给出「场景 → 命令 → 实际输出」。标注"实测"的输出为在 Windows 环境下
于 gyc-code 仓库真实执行所得；标注"示意"的为格式说明，非真实数据。
"""
from docx.enum.text import WD_ALIGN_PARAGRAPH

from manual_docx_style import (FONT_BODY, FONT_H1, FONT_H2, SZ_BODY, SZ_TITLE,
                               body, code, h1, h2, h3, h4, note, para, plain,
                               set_run_font, table)


def cmd(doc, line, tag="实测"):
    """一条命令示例及其实际输出。"""
    h4(doc, line)
    code(doc, tag + " 输出：")


def appendix_a(doc):
    h1(doc, "附录 A　命令使用示例")
    note(doc, "体例说明：每条先说明使用场景，再给出命令，最后给出实际输出。"
              "标注“实测”的输出是在 Windows 环境下于 gyc-code 仓库真实执行所得，"
              "其中的会话标题、数量与金额属该环境数据，换用者会有差异；"
              "标注“示意”的仅为输出格式说明。")

    # ------------------------------------------------------------ 开始使用
    h2(doc, "一、开始使用的四条命令")

    cmd(doc, "场景：先看看手上有哪些模型可用")
    code(doc, "gyc models")
    code(doc, "实测输出（节选）：\n"
              "deepseek/deepseek-flash\n"
              "deepseek/deepseek-v4-pro\n"
              "nvidia/01-ai/yi-large\n"
              "nvidia/adept/fuyu-8b\n"
              "nvidia/ai21labs/jamba-1.5-large-instruct\n"
              "nvidia/black-forest-labs/flux_1-kontext-dev\n"
              "…")
    body(doc, "说明：模型名格式为“服务商/模型名”。"
              "左侧斜杠前是服务商，后是模型。"
              "上例中 nvidia 服务商下的模型数量最多。"
              "仅看某一个服务商可加参数，例如：")
    code(doc, "gyc models deepseek")
    code(doc, "实测输出（节选）：\n"
              "deepseek/deepseek-flash\n"
              "deepseek/deepseek-v4-pro")

    h3(doc, "查看模型的成本等元数据")
    code(doc, "gyc models --verbose")
    body(doc, "该参数会额外显示每个模型的上下文长度、单价等信息，"
              "用于在多个模型之间比价与权衡。")

    h3(doc, "刷新模型缓存")
    code(doc, "gyc models --refresh")
    body(doc, "模型清单默认从公共目录获取并缓存。"
              "新增服务商或服务商上线新模型后，执行本命令刷新缓存即可看到。"
              "若处于无网络环境，可设置环境变量 GYCCODE_DISABLE_MODELS_FETCH "
              "改用本地缓存。")

    cmd(doc, "场景：配置服务商密钥")
    code(doc, "gyc providers login")
    code(doc, "示意输出：\n"
              "请选择服务商：\n"
              "  > deepseek\n"
              "    openrouter\n"
              "    siliconflow\n"
              "    nvidia\n"
              "…\n"
              "请输入 API Key：****")
    h3(doc, "查看已配置的密钥")
    code(doc, "gyc providers list")
    code(doc, "实测输出：\n"
              "┌  凭据 ~\\.local\\share\\gyccode\\auth.json\n"
              "│\n"
              "└  共 0 条凭据\n\n"
              "┌  环境变量\n"
              "│\n"
              "●  Nvidia NVIDIA_API_KEY\n"
              "│\n"
              "└  1 个环境变量")
    body(doc, "说明：输出分为两栏，分别显示凭据文件与环境变量中已识别的密钥。"
              "上例表示凭据文件为空，仅有一个通过环境变量配置的密钥。"
              "若已用 login 命令配置过，则“凭据”栏会显示条目数。")
    h3(doc, "退出某个服务商")
    code(doc, "gyc providers logout deepseek")

    cmd(doc, "场景：第一次对话，先问一个简单问题")
    code(doc, "gyc run \"这个项目是做什么的？\"")
    body(doc, "执行后模型会先列出当前目录的文件结构，"
              "再阅读关键文件，最后给出总结。"
              "全过程中会看到模型调用各类工具的记录。")

    h3(doc, "指定模型与附加文件")
    code(doc,
         "gyc run -m deepseek/deepseek-chat \"把这个文件翻译成英文\"\n"
         "gyc run -f ./需求文档.md \"按这个文档实现功能\"\n"
         "gyc run -f ./a.png ./b.png \"对比这两张图的差异\"")

    h3(doc, "让模型只分析不改文件")
    code(doc, "gyc run --agent plan \"帮我设计用户模块的重构方案\"")
    body(doc, "计划模式禁用全部编辑类工具，模型只能读取和分析，"
              "适合先要方案、后动手的场景。")

    h3(doc, "接着上次对话继续")
    code(doc,
         "gyc run -c \"继续，刚才没改完\"\n"
         "gyc run -s ses_f2f1989c8ffeh2TBKggykwm81c \"继续\"\n"
         "gyc run -c --fork \"换个思路重做一遍\"")

    h3(doc, "输出机器可读格式")
    code(doc, "gyc run --format json \"分析这个项目\"")
    body(doc, "适用于将 gyc 接入自动化流水线，由脚本解析返回结果。")

    # ------------------------------------------------------------ 会话管理
    h2(doc, "二、会话与数据")

    cmd(doc, "场景：查看有哪些历史会话")
    code(doc, "gyc session list")
    code(doc, "实测输出（节选）：\n"
              "会话 ID                      标题                              更新时间\n"
              "─────────────────────────────────────────────────────────\n"
              "ses_f2f1989c8ffeh2TBKggykwm81c  回复两字“可用”                   08:52 · 2026/9/24\n"
              "ses_f2f19c19affeJU64JOUUOXqzik  要求仅回复\"可用\"                08:52 · 2026/9/24\n"
              "ses_f2f19f510ffeS1AG8K6N4iWED2  Git 提交哈希前 7 位查询        08:52 · 2026/9/24\n"
              "ses_f2f1f01daffeyBB07Z63CZHfZ8  要求仅回复“可用”               08:46 · 2026/9/24")

    cmd(doc, "场景：删除某个会话")
    code(doc, "gyc session delete ses_f2f1989c8ffeh2TBKggykwm81c")
    body(doc, "注意：删除不可撤销。会话中的文件改动不受影响，"
              "仅删除对话记录本身。")

    cmd(doc, "场景：把会话导出备份")
    code(doc,
         "gyc export ses_f2f1989c8ffeh2TBKggykwm81c            # 导出为 JSON\n"
         "gyc export ses_f2f1989c8ffeh2TBKggykwm81c --format csv  # 导出平铺表格\n"
         "gyc export ses_f2f1989c8ffeh2TBKggykwm81c -o 会话.json  # 指定文件名\n"
         "gyc export ses_f2f1989c8ffeh2TBKggykwm81c --sanitize  # 脱敏后导出")
    h3(doc, "导入会话")
    code(doc, "gyc import ./会话.json")
    body(doc, "亦可直接传入分享链接，从远端导入他人分享的会话。")

    cmd(doc, "场景：查看数据库位置")
    code(doc, "gyc db path")
    code(doc, "实测输出：\n"
              "C:\\Users\\Administrator\\.local\\share\\gyccode\\gyccode-local.db")

    h3(doc, "直接查询数据库")
    code(doc, "gyc db query \"SELECT count(*) FROM session\"")
    code(doc, "示意输出：\n"
              "count(*)\n"
              "27")
    h3(doc, "抽查成本账本")
    code(doc, "gyc db query \"SELECT * FROM cost_ledger ORDER BY rowid DESC LIMIT 3\"")
    h3(doc, "查看提示缓存命中率")
    code(doc, "gyc db cache")
    h3(doc, "数据库维护")
    code(doc,
         "gyc db cleanup     # 清理孤立数据并整理数据库\n"
         "gyc db compact     # 压缩冗长工具输出以缩小体积")
    note(doc, "重要：数据库表结构属内部实现，可能随版本变化。"
              "任何写操作前务必先备份数据库文件。"
              "日常统计请优先使用 stats 与 task 命令。")

    # ------------------------------------------------------------ 成本统计
    h2(doc, "三、成本统计")

    cmd(doc, "场景：这个月花了多少钱")
    code(doc, "gyc stats")
    code(doc, "实测输出：\n"
              "┌────────────────────────────────────────────────────────┐\n"
              "│                       OVERVIEW                         │\n"
              "├────────────────────────────────────────────────────────┤\n"
              "│Sessions                                             27 │\n"
              "│Messages                                          5,944 │\n"
              "│Days                                                 28 │\n"
              "└────────────────────────────────────────────────────────┘\n"
              "┌────────────────────────────────────────────────────────┐\n"
              "│                    COST & TOKENS                       │\n"
              "├────────────────────────────────────────────────────────┤\n"
              "│Total Cost                                       $18.95 │\n"
              "│Avg Cost/Day                                      $0.68 │\n"
              "│Avg Tokens/Session                                34.5M │\n"
              "│Median Tokens/Session                              1.5M │\n"
              "│Input                                             35.8M │\n"
              "│Output                                             2.9M │\n"
              "│Cache Read                                       891.9M │\n"
              "│Cache Write                                           0 │\n"
              "│Cache Hit Rate (prefix)                           97.3% │\n"
              "│Cache Hit Rate (steady)                           99.6% │\n"
              "└────────────────────────────────────────────────────────┘")

    h3(doc, "如何读懂上面这份报表")
    table(doc, [
        ["指标", "含义与解读"],
        ["Sessions / Messages / Days", "统计范围内的会话数、消息数与跨度天数。"
                                      "会话数远大于工作日天数，说明有大量单轮短会话"],
        ["Total Cost / Avg Cost/Day", "总花费与日均花费。折算日均更便于判断是否失控"],
        ["Avg / Median Tokens/Session", "平均与中位数的单会话令牌量。"
                                       "两者差距大说明存在少数超大会话，"
                                       "这些会话往往是成本主要来源"],
        ["Input / Output", "输入与输出令牌量。输出通常远小于输入，"
                           "因为输入包含大量系统提示与工具说明"],
        ["Cache Read / Cache Write", "缓存读取与写入量。缓存读取远大于输入量属正常，"
                                     "说明大量重复前缀被复用"],
        ["Cache Hit Rate", "缓存命中率。上例中稳定态命中率达 99.6%，"
                           "前缀命中 97.3%，均属良好水平；"
                           "若明显偏低，说明会话前缀不稳定，可考虑适时开启新会话"],
    ], widths=[4.6, 10.4])

    h3(doc, "按维度拆分")
    code(doc,
         "gyc stats --days 7          # 仅看最近七天\n"
         "gyc stats --models          # 按模型拆分\n"
         "gyc stats --models 5        # 仅显示前五个模型\n"
         "gyc stats --tools 10        # 用量前十的工具\n"
         "gyc stats --project         # 仅当前项目")

    h3(doc, "与服务商账单对账")
    code(doc, "gyc stats --reconcile")
    code(doc, "实测输出（尾部）：\n"
              "⚠ 成本口径对账不一致：")
    body(doc, "说明：对账功能会将本地统计与服务商侧账单逐项比对。"
              "若本地缺少可比对的账单来源，"
              "或两侧统计口径不同（压缩计入方式、缓存计费方式等），"
              "会提示“对账不一致”。此时应以服务商账单为准，"
              "并可将行数上限调小以查看更多内容。")
    code(doc, "gyc stats --reconcile --reconcile-limit 20")

    cmd(doc, "场景：哪一次提问最费钱")
    code(doc, "gyc task list")
    code(doc, "实测输出：\n"
              "没有匹配的任务。")
    body(doc, "说明：以“用户单轮对话”为一个任务单位列出成本与成败。"
              "上例表示当前没有符合筛选条件的任务记录，"
              "通常是因为尚未产生带成本记账的任务。")

    h3(doc, "导出成本账")
    code(doc, "gyc export --cost")
    body(doc, "导出含任务维度、压缩成本、缓存命中率等明细的完整成本账，"
              "便于自行做数据分析。命令支持 --format json 与 --format csv 两种格式，"
              "默认 json；需要导入表格工具分析时加 --format csv，"
              "即可得到 cost_ledger 的平铺流水表。")

    # ------------------------------------------------------------ 智能体
    h2(doc, "四、智能体")

    cmd(doc, "场景：看看有哪些智能体可用")
    code(doc, "gyc agent list")
    code(doc, "实测输出（智能体名称部分）：\n"
              "build (primary)\n"
              "compaction (primary)\n"
              "compose (primary)\n"
              "explore (subagent)\n"
              "general (subagent)\n"
              "plan (primary)\n"
              "summary (primary)\n"
              "title (primary)")
    body(doc, "说明：系统实际提供八个智能体，"
              "其中标注 primary 的为主智能体，"
              "标注 subagent 的仅可由模型派发，不可直接选用。"
              "每个条目之后还会输出该智能体的权限规则，"
              "可用以确认它能做什么、不能做什么。")
    table(doc, [
        ["智能体", "类别", "用途"],
        ["build", "主", "默认角色，按既定权限执行各类工具，日常开发用这个"],
        ["plan", "主", "计划模式，只读不改，用于先出方案"],
        ["compose", "主", "编排模式，按内置编排技能推进多阶段流程"],
        ["compaction", "主", "上下文压缩专用"],
        ["summary", "主", "会话摘要专用"],
        ["title", "主", "会话标题生成专用"],
        ["general", "子", "通用研究型，可并行处理多件事"],
        ["explore", "子", "代码库探索型，只读不改"],
    ], widths=[3.0, 1.4, 10.6])
    note(doc, "说明：compaction、summary、title 三个为主智能体，"
              "系系统内部流程调用，一般无需手动指定。"
              "面向日常使用的主要是 build、plan、compose 三个。")

    cmd(doc, "场景：创建一个只做代码审查的智能体")
    code(doc, "gyc agent create")
    body(doc, "交互式创建，按提示填写智能体名称与说明即可。"
              "创建后可将其配为默认智能体，或用 --agent 参数指定。")

    # ------------------------------------------------------------ 扩展管理
    h2(doc, "五、扩展管理")

    cmd(doc, "场景：接入一个外部工具服务器")
    code(doc, "gyc mcp list")
    code(doc, "实测输出：\n"
              "┌  MCP 服务器\n"
              "│\n"
              "▲  未配置任何 MCP 服务器\n"
              "│\n"
              "└  使用以下命令添加服务器：gyccode mcp add")
    h3(doc, "添加服务器")
    code(doc, "gyc mcp add")
    body(doc, "交互式添加，按提示填写服务器名称、启动命令等信息。")
    h3(doc, "从可审计目录安装")
    code(doc,
         "gyc mcp catalog                # 浏览目录\n"
         "gyc mcp catalog 数据库          # 按关键词检索\n"
         "gyc mcp install 服务器名称       # 安装")
    body(doc, "安装前系统会展示该服务器的权限范围、传输方式与数据流向，"
              "务必仔细阅读后再确认。")
    h3(doc, "需要授权的服务器")
    code(doc,
         "gyc mcp auth 服务器名称     # 完成授权\n"
         "gyc mcp logout 服务器名称   # 清除凭据\n"
         "gyc mcp debug 服务器名称    # 调试连接")

    cmd(doc, "场景：管理插件")
    code(doc, "gyc plug list")
    code(doc, "实测输出：\n"
              "暂无通过市场安装的插件")
    code(doc,
         "gyc plug search 关键词\n"
         "gyc plug install 模块名")
    note(doc, "注意：插件命令的正确写法为 plug 或其别名 plugin。"
              "经实测，别名 plugin 在当前版本无法调用，"
              "而 plug 可正常使用，详见第二十一章。")

    cmd(doc, "场景：跨会话记住偏好")
    code(doc,
         "gyc memory write 代码风格偏好 \"中文注释，函数用箭头函数\"\n"
         "gyc memory read\n"
         "gyc memory sync")
    code(doc, "实测输出（读取时）：\n"
              "未找到任何记忆。")
    body(doc, "说明：上例为尚未写入任何记忆时的输出。"
              "写入后执行 memory read 即可看到内容。")

    cmd(doc, "场景：管理沉淀下来的技能")
    code(doc, "gyc learning status")
    code(doc, "实测输出：\n"
              "技能根目录: C:\\Users\\Administrator\\.gyc\\skills\n"
              "自建技能: 13\n"
              "状态分布: active 13 / stale 0 / archived 0\n"
              "pinned: 0\n"
              "账本条目: 25\n"
              "最近一次变更: 2026-10-01T15:05:54.527Z create document-image-tooling")
    body(doc, "逐项含义如下。")
    table(doc, [
        ["输出项", "含义"],
        ["技能根目录", "自建技能的存放位置，位于记忆目录下"],
        ["自建技能", "已沉淀的技能总数"],
        ["状态分布", "按状态统计。active 为在用；stale 指闲置超过三十天；"
                     "archived 指归档，归置超过九十天"],
        ["pinned", "被固定不会被自动归档的技能数"],
        ["账本条目", "技能变更的累计记录条数，每条变更均留痕"],
        ["最近一次变更", "最后一次技能增删改的时间与内容"],
    ], widths=[3.4, 11.6])
    h3(doc, "其他技能管理命令")
    code(doc,
         "gyc learning usage           # 按最近活跃度列出用量\n"
         "gyc learning rollback 标识    # 回滚某次变更\n"
         "gyc learning archive 名称     # 手工归档\n"
         "gyc learning restore 名称     # 从归档恢复\n"
         "gyc learning tick            # 按闲置时长推进生命周期")

    # ------------------------------------------------------------ 服务端
    h2(doc, "六、服务与多端")

    h3(doc, "场景：在服务器上常驻运行")
    code(doc, "gyc serve --port 4096")
    body(doc, "该命令只启动后台服务，不打开界面。"
              "端口省略时默认取随机端口，"
              "因此若需固定地址供他人访问，务必显式指定端口。")

    h3(doc, "场景：从另一台机器接入")
    code(doc,
         "gyc attach http://192.168.1.100:4096\n"
         "gyc attach http://192.168.1.100:4096 -p 访问密码\n"
         "gyc attach http://192.168.1.100:4096 -p 密码 -u 用户名 --dir /远程/项目路径")
    note(doc, "警告：在服务端将监听地址改为非本机地址后，"
              "必须设置访问密码，"
              "否则该服务将对网络内所有人开放。"
              "建议同时在防火墙上限制可访问的来源地址。")

    h3(doc, "场景：在编辑器中使用")
    code(doc,
         "gyc acp --port 4096\n"
         "gyc acp --port 4096 --cwd D:\\我的项目")
    body(doc, "启动后在编辑器的插件设置中指向该地址即可。")

    h3(doc, "场景：处理合并请求")
    code(doc, "gyc pr 123")
    body(doc, "自动拉取并检出该合并请求对应的分支，随后启动终端界面，"
              "便于直接在分支上工作。")
    code(doc,
         "gyc github install    # 安装代码托管平台智能体\n"
         "gyc github run        # 运行该智能体")

    # ------------------------------------------------------------ 排错
    h2(doc, "七、排错")

    h3(doc, "场景：报错了，想看详细日志")
    code(doc,
         "gyc --log-level DEBUG --print-logs run \"你的问题\"\n"
         "gyc --log-level ERROR --print-logs serve")
    body(doc, "四个级别由细到粗为 DEBUG、INFO、WARN、ERROR。"
              "排查问题时用 DEBUG，日常使用可保持默认或设为 WARN。")

    h3(doc, "场景：怀疑是某个插件引起的")
    code(doc, "gyc --pure run \"你的问题\"")
    body(doc, "该参数使程序不加载任何外部插件。"
              "若问题消失，即可定位到插件；"
              "若问题依旧，则与插件无关。")

    h3(doc, "场景：改了代码但行为没变")
    code(doc, "bun run dev")
    body(doc, "原因在于启动器优先运行打包产物。"
              "改用源码直跑即可观察最新改动。"
              "若要让 gyc 命令本身生效，须先执行 bun run build 重新打包。")

    h3(doc, "场景：界面里某个键按了没反应")
    code(doc, "gyc")
    body(doc, "进入界面后按 Ctrl+Alt+K 打开快捷键提示面板，"
              "即可看到当前所有生效的键位及其含义。")

    h3(doc, "场景：确认某个命令是否存在")
    code(doc, "gyc 某命令 --help")
    body(doc, "若返回的是默认终端界面的帮助，"
              "说明该命令不存在，程序把它当成了项目路径。"
              "这一招可用来快速验证旧文档中的命令是否仍然有效。")

    # ------------------------------------------------------------ 安装升级
    h2(doc, "八、安装与升级")

    cmd(doc, "场景：升级到最新版")
    code(doc,
         "gyc upgrade\n"
         "gyc upgrade 0.1.48\n"
         "gyc upgrade -m npm")
    body(doc, "第二个参数指定目标版本；"
              "-m 指定安装方式，可选 curl、npm、pnpm、bun、brew、choco、scoop。"
              "系统会依据当前环境自动选择，此参数仅在自动选择失败时需要。")

    cmd(doc, "场景：彻底卸载")
    code(doc, "gyc uninstall")
    body(doc, "该命令会删除程序及全部相关文件，执行前会要求确认。"
              "注意：它不会删除会话数据库与配置，"
              "如需彻底清除请另行删除数据目录。")
