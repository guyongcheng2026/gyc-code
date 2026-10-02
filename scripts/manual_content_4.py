# -*- coding: utf-8 -*-
"""
scripts/manual-content-4.py
《gyccode 操作手册》正文 —— 第十一至十五章。
"""
from docx.enum.text import WD_ALIGN_PARAGRAPH

from manual_docx_style import (FONT_BODY, FONT_H1, FONT_H2, SZ_BODY, SZ_TITLE,
                             body, code, h1, h2, h3, h4, note, para, plain,
                             set_run_font, table)


def chapter11(doc):
    h1(doc, "十一、成本与用量统计")

    h2(doc, "（一）总体统计")
    body(doc, "执行以下命令查看令牌的消耗与费用情况。")
    code(doc,
         "gyc stats                # 总体用量与成本\n"
         "gyc stats --days 7       # 限定最近七天\n"
         "gyc stats --models       # 按模型拆分\n"
         "gyc stats --models 5     # 仅显示前五个模型\n"
         "gyc stats --tools 10     # 用量前十的工具\n"
         "gyc stats --project      # 仅当前项目；传空字符串亦为当前项目\n"
         "gyc stats --reconcile    # 与服务商账单对账")
    body(doc, "对账功能用于将本地统计与服务商侧账单进行比对。"
              "若暂无可用的账单来源，程序仅报告本地侧数据。")

    h2(doc, "（二）任务级统计")
    body(doc, "系统以“用户单轮对话”为一个任务单位进行统计，"
              "便于定位哪些具体请求耗费较高。")
    code(doc, "gyc task list        # 列出各任务及其成本与成败")

    h2(doc, "（三）成本账本")
    body(doc, "系统维护一份成本账本，记录每一笔开销的明细，"
              "包括任务维度、上下文压缩产生的成本、提示缓存命中率等。"
              "该账本为只追加式记录，不做改写，以保证统计结果可追溯。")
    code(doc,
         "gyc export --cost     # 导出成本账为 JSON\n"
         "gyc db cache          # 报告近期提示缓存命中率")

    h2(doc, "（四）降低成本的建议")
    body(doc, "一、及时压缩会话。上下文过长时，"
              "按 Ctrl+X 后再按 C 将历史对话压缩为摘要，可显著减少后续消耗。")
    body(doc, "二、合理选用模型。日常简单任务使用轻量模型，"
              "复杂推理再切换至高能力模型。系统亦提供 small_model 配置项"
              "专门承担摘要一类低强度任务。")
    body(doc, "三、利用提示缓存。系统会记录缓存命中率，"
              "执行 gyc db cache 可查看。命中率偏低时，"
              "通常意味着会话前缀不够稳定，可考虑适时开启新会话。")
    body(doc, "四、定期整理数据库。执行 gyc db compact 压缩冗长的工具输出，"
              "执行 gyc db cleanup 清理孤立数据。")
    body(doc, "五、注意上下文开销。读取大文件时使用 read 工具的行数与偏移参数"
              "分段读取，避免一次性载入过多内容。")


def chapter12(doc):
    h1(doc, "十二、服务化与多端使用")

    h2(doc, "（一）无头服务模式")
    body(doc, "无头服务模式仅启动后台服务而不打开界面，"
              "适合在服务器上常驻运行，供多个终端接入。")
    code(doc,
         "gyc serve --port 4096                    # 指定端口\n"
         "gyc serve --port 4096 --hostname 0.0.0.0  # 允许局域网访问")
    table(doc, [
        ["选项", "默认值", "说明"],
        ["--port", "0（随机）", "监听端口"],
        ["--hostname", "127.0.0.1", "监听地址，默认仅本机可访问"],
        ["--mdns", "关闭", "启用服务发现；启用时监听地址自动改为 0.0.0.0"],
        ["--mdns-domain", "gyccode.local", "服务发现的自定义域名"],
        ["--cors", "空", "额外允许的跨域来源"],
    ], widths=[3.6, 3.4, 8.0])

    h2(doc, "（二）多端接入")
    body(doc, "服务启动后，其他终端或其他设备可接入同一服务，"
              "会话与配置完全共享。")
    code(doc,
         "gyc attach http://localhost:4096                    # 本机接入\n"
         "gyc attach http://192.168.1.100:4096 -p 访问密码       # 跨设备接入")
    body(doc, "接入时可指定远程工作目录，实现一台服务多处使用。")
    code(doc, "gyc attach http://服务器地址:端口 --dir /path/to/project")

    h2(doc, "（三）远程接入的安全要求")
    note(doc, "警告：将监听地址改为非本机地址，等同于在网络上开放服务。"
              "必须同时满足以下三项要求：一是通过 -p 参数或 "
              "GYCCODE_SERVER_PASSWORD 设置访问密码；"
              "二是在防火墙上限制可访问的来源地址；"
              "三是不要将端口直接映射至公网。")

    h2(doc, "（四）编辑器集成")
    body(doc, "系统可作为编辑器插件的后端，供支持模型上下文协议的编辑器调用。")
    code(doc,
         "gyc acp --port 4096            # 启动编辑器协议服务\n"
         "gyc acp --cwd D:\\项目路径       # 指定工作目录")
    body(doc, "启动后，在编辑器的插件设置中指向该地址即可。")

    h2(doc, "（五）工作流编排")
    body(doc, "系统内置工作流编排引擎，可将多步骤任务固化为可复用的流程。")
    code(doc,
         "gyc workflow defs                # 列出可用工作流\n"
         "gyc workflow start 工作流名称     # 在当前会话上启动\n"
         "gyc workflow status              # 列出运行记录\n"
         "gyc workflow status 运行标识     # 查看指定运行\n"
         "gyc workflow abort 运行标识      # 中止运行")


def chapter13(doc):
    h1(doc, "十三、二次开发")

    h2(doc, "（一）开发命令")
    body(doc, "供开发者使用。仓库根目录为 D:\\00MyAI\\gyc-code。")
    table(doc, [
        ["命令", "说明"],
        ["bun run dev", "以源码方式启动（改动即时生效）"],
        ["bun run build", "打包生成 dist 目录"],
        ["bun run test", "运行全部测试（注意须用此命令，不可用简写）"],
        ["bunx tsc --noEmit", "类型检查"],
    ], widths=[5.0, 10.0])
    body(doc, "标准验证顺序为：先执行类型检查，再执行全部测试，"
              "对外发布前再执行打包。")
    code(doc,
         "bunx tsc --noEmit        # 第一步：类型检查\n"
         "bun run test             # 第二步：全部测试\n"
         "bun run build            # 第三步：打包（发布前执行）")

    h2(doc, "（二）代码生成物")
    body(doc, "下列文件为自动生成，不应手工修改。")
    table(doc, [
        ["生成文件", "来源"],
        ["src/gyccode/skill/compose/bundle.gen.ts", "打包时自动执行生成脚本"],
        ["src/gyccode/server/generated/gyc-web-ui.gen.ts", "构建脚本生成"],
        ["src/gyccode/command-registry.ts", "执行生成脚本；增删命令文件后必须重新生成"],
    ], widths=[8.6, 6.4])

    h2(doc, "（三）新增一个内置工具")
    body(doc, "以新增一个工具为例，步骤如下。")
    code(doc,
         "第一步：在 src/gyccode/tool/ 下新建 文件名.ts\n"
         "第二步：以 define 函数定义工具，写明标识、参数模式与描述\n"
         "第三步：实现 execute 函数，产出 输出 与 元数据\n"
         "第四步：在 src/gyccode/tool/registry.ts 中引入并注册\n"
         "第五步：补充测试文件，命名为 文件名.test.ts\n"
         "第六步：依次执行类型检查与全部测试")

    h2(doc, "（四）新增一个命令")
    body(doc, "命令实现位于 src/cli/cmd/ 目录。"
              "新增命令文件后，必须重新执行命令注册表的生成脚本，"
              "否则该命令不会被注册。")
    code(doc, "bun run scripts/generate-command-registry.ts")

    h2(doc, "（五）操作手册的同步维护")
    body(doc, "本手册由脚本自动生成，源文件与生成器分列如下。")
    table(doc, [
        ["文件", "作用"],
        ["docs/gyccode操作手册.docx", "本手册正式交付件（公文格式）"],
        ["scripts/gen_manual_docx.py", "生成入口，负责装配各章并输出 docx"],
        ["scripts/manual_docx_style.py", "排版规则，定义公文版式与各类段落样式"],
        ["scripts/manual_content_1.py 至 _4.py", "手册正文，按章节拆分"],
        ["scripts/sync-manual.mjs", "同步校验脚本，由提交钩子自动调用"],
    ], widths=[8.0, 7.0])
    body(doc, "当命令行命令、工具清单、快捷键、配置项、权限规则发生变更时，"
              "须同步更新正文文件，并重新执行生成脚本。")
    code(doc, "python scripts/gen_manual_docx.py")
    body(doc, "提交钩子会自动检测上述功能层面的文件是否被改动。"
              "若检测到变更而本手册未同步，将向使用者提示，"
              "并记入工作日志，相关约定见仓库根目录的 AGENTS.md 文件。")


def chapter14(doc):
    h1(doc, "十四、已知文档不一致与排错")

    h2(doc, "（一）仓库说明文件与程序实际行为的差异")
    body(doc, "经逐项核对，仓库根目录的 README 介绍文件中有若干处与程序当前行为不一致。"
              "为避免使用者据以误操作，现将差异及正确做法列明如下。")
    table(doc, [
        ["项目", "README 的表述", "程序实际行为与正确做法"],
        ["密钥存放位置", "将服务商密钥写入 ~/.gyc/.env",
         "该文件仅用于即时通讯网关凭据。服务商密钥请用 gyc providers login "
         "或环境变量配置"],
        ["编排命令", "提供 gyc compose plan 命令",
         "当前版本未注册该命令，执行时会回落至默认命令。"
         "相关能力现由 gyc workflow 承担"],
        ["排错命令", "提供 gyc debug 命令",
         "当前版本未在主命令列表中注册。"
         "排错请使用 --log-level DEBUG 与 --print-logs 参数"],
        ["补全命令", "提供 gyc completion 命令",
         "当前版本未在主命令列表中注册"],
        ["浏览器界面鉴权", "gyc web 支持 --password 参数",
         "实测该命令选项中无此参数。远程访问的鉴权请通过服务端命令的 "
         "-p 参数或 GYCCODE_SERVER_PASSWORD 环境变量设置"],
        ["界面命令", "列出 gyc [project] 与 gyc tui 两个入口",
         "两者均有效，gyc tui 为默认命令的显式写法，功能一致"],
    ], widths=[2.6, 4.6, 7.8])

    h2(doc, "（二）常见问题排查")
    table(doc, [
        ["现象", "原因", "处理办法"],
        ["修改代码后行为未变", "启动器优先运行打包产物",
         "改用 bun run dev，或先执行 bun run build"],
        ["界面中文显示异常", "终端编码未设置为 UTF-8",
         "将终端编码切换为 UTF-8 后重试"],
        ["模型无响应", "密钥未配置或已失效",
         "执行 gyc providers list 检查，必要时重新登录"],
        ["模型无法调用某工具", "该工具未满足启用条件",
         "见本手册第七章第七节"],
        ["模型反复调用注定失败的工具", "项目类型与工具不匹配",
         "确认项目是否为版本控制仓库；非仓库项目本就不提供相关工具"],
        ["启动即报错且提示键位无法识别", "快捷键配置中存在无效键位名",
         "按提示修正 tui.json 中的键位名称"],
        ["界面卡顿", "长会话上下文过大或插件冲突",
         "压缩会话；必要时以 --pure 参数启动排除插件影响"],
        ["服务无法被其他设备访问", "监听地址仍为本机回环",
         "指定 --hostname 0.0.0.0 并设置访问密码"],
        ["提交钩子未按预期执行", "钩子未安装到版本库",
         "执行 node scripts/install-hooks.mjs"],
    ], widths=[4.0, 4.2, 6.8])

    h2(doc, "（三）日志与诊断")
    body(doc, "排查问题时，建议按以下顺序收集信息。")
    code(doc,
         "# 第一步：以最详细级别输出日志\n"
         "gyc --log-level DEBUG --print-logs <命令>\n\n"
         "# 第二步：排除插件干扰\n"
         "gyc --pure <命令>\n\n"
         "# 第三步：以源码方式运行，排除打包产物陈旧的可能\n"
         "bun run dev <命令>")
    body(doc, "如问题涉及运行性能，可执行性能分析工具命令采集数据。")

    h2(doc, "（四）响应慢的两类日志信号")
    body(doc, "当模型响应偏慢时，以 DEBUG 级别运行可在日志中看到两条定位信号，"
              "二者含义不同，需分开判断。")
    table(doc, [
        ["日志关键字", "含义与处理方向"],
        ["llm first-token latency is slow",
         "首 token 时延超过 3 秒。计时从发起请求（含并发许可等待）开始，"
         "到第一个流式事件到达为止；同一条日志附 ttftMs 字段给出实测毫秒数。"
         "数值偏大通常源于服务商排队、网络抖动或本机并发已满。"],
        ["llm stream waited for concurrency permit",
         "请求在开始前等待并发许可超过 200 毫秒，附 waitMs 字段。"
         "该值持续偏大说明同时进行的会话过多，可下调配置中的最大并发数。"],
    ], widths=[5.6, 9.4])
    body(doc, "两条信号均为 INFO 级别，使用默认日志级别即可看到；"
              "如需确认具体字段，请加 --log-level DEBUG。")

    h2(doc, "（五）数据位置")
    body(doc, "常用数据的存放位置如下，便于备份与清理。")
    table(doc, [
        ["数据", "位置"],
        ["服务商凭据", "~\\.local\\share\\gyccode\\auth.json"],
        ["会话与统计数据库", "数据目录下，可用 gyc db path 查询确切路径"],
        ["文件备份", "数据目录下的 backup 子目录"],
        ["运行日志", "日志目录"],
        ["网页截图", "数据目录下的 screenshots 子目录"],
        ["即时通讯网关凭据", "~/.gyc/.env"],
    ], widths=[5.0, 10.0])


def chapter15(doc):
    h1(doc, "十五、常见问题速查")
    body(doc, "本章以问答形式列出高频问题。")

    h3(doc, "1. 第一次使用，应当从何处入手？")
    body(doc, "建议依次完成四步：配置密钥、查看可用模型、启动浏览器界面、"
              "用一句话提出一个简单需求（如“分析这个项目是做什么的”）。"
              "熟悉后再逐步转向终端界面。")

    h3(doc, "2. 如何在不改动文件的前提下了解一个项目？")
    body(doc, "使用计划模式。命令行方式为 gyc run --agent plan \"需求\"；"
              "终端界面中按 Tab 切换至 plan 智能体。"
              "该模式下全部编辑类工具被禁用，模型只能读取和分析。")

    h3(doc, "3. 上下文过长导致响应变慢或费用激增怎么办？")
    body(doc, "按 Ctrl+X 后再按 C 压缩会话。系统会将历史对话整理为摘要，"
              "保留要点而丢弃冗余内容。若问题持续，"
              "可开启新会话，并用一段简明的话交代背景与目标。")

    h3(doc, "4. 如何让模型不要改动我的文件？")
    body(doc, "两种方式。其一，使用 plan 智能体；"
              "其二，在配置中将 edit 类别设为拒绝。")

    h3(doc, "5. 模型改错了，如何恢复？")
    body(doc, "写入与编辑操作在执行前已自动创建备份，"
              "可从数据目录下的 backup 子目录取回原文件。"
              "另可使用版本控制工具查看改动并决定是否回退。")

    h3(doc, "6. 旧版本文档与实际不符，以何为准？")
    body(doc, "以程序实际行为为准。本手册已逐项核对；"
              "已知差异见第十四章。执行 gyc --help 可随时查询当前版本的准确信息。")

    h3(doc, "7. 如何为团队沉淀可复用的经验？")
    body(doc, "将经验整理为技能，即在 .gyccode/skills/ 下建立技能目录并编写 SKILL.md，"
              "注明适用场景与操作步骤。团队成员即可在遇到同类任务时自动复用。"
              "已沉淀的技能可用 gyc learning 系列命令管理。")

    h3(doc, "8. 如何减少令牌消耗？")
    body(doc, "详见本手册第十一章第四节提出的五项建议，"
              "其中最见效者为及时压缩会话与合理选用模型。")

    h3(doc, "9. 长时间无人值守的任务如何处理？")
    body(doc, "可使用后台命令工具启动长时任务，"
              "或使用定时任务工具设定周期性执行，"
              "并配合进度通知工具接收状态回报。")

    h3(doc, "10. 程序行为异常且原因不明，如何处理？")
    body(doc, "依次尝试四个步骤：其一，加 --log-level DEBUG 与 --print-logs "
              "重新执行并查看日志；其二，加 --pure 排除插件影响；"
              "其三，改用 bun run dev 以源码方式运行；"
              "其四，在终端界面中按 Ctrl+Alt+K 打开快捷键提示面板，"
              "确认操作方式无误。")


def closing(doc):
    plain(doc, "")
    body(doc, "本手册依据 gyc-code 仓库源码及程序实际运行结果编制，"
              "内容以 V1.1 版本发布。"
              "程序功能变更后，应及时更新正文文件并重新生成，"
              "以保证手册与程序一致。")
