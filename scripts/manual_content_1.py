# -*- coding: utf-8 -*-
"""
scripts/manual-content-1.py
《gyccode 操作手册》正文 —— 第一至第五章。
被 gen-manual-docx.py 调用, 拆分仅为控制单文件体积。

事实基准: D:\\00MyAI\\gyc-code 源码 + `gyc --help` 实测输出。
编写日期: 2026-10-02
"""
from docx.enum.text import WD_ALIGN_PARAGRAPH

from manual_docx_style import (FONT_BODY, FONT_H1, FONT_H2, SZ_BODY, SZ_TITLE,
                             body, code, h1, h2, h3, h4, note, para, plain,
                             set_run_font, table)


def front_matter(doc):
    """公文标题区。"""
    p = para(doc, "gyccode 操作手册", FONT_H1, SZ_TITLE,
             align=WD_ALIGN_PARAGRAPH.CENTER, indent_chars=0,
             before=0, after=6)
    p = para(doc, "（面向初次使用者的完整操作指南）", FONT_H2, SZ_BODY,
             align=WD_ALIGN_PARAGRAPH.CENTER, indent_chars=0, after=18)

    table(doc, [
        ["项目", "内容"],
        ["文档名称", "gyccode 操作手册"],
        ["文档版本", "V1.0"],
        ["编制日期", "2026 年 10 月 2 日"],
        ["适用对象", "第一次接触 AI 编程助手的开发者与业务人员"],
        ["适用范围", "gyc-code 自研编码智能体 CLI（全部界面与功能）"],
        ["事实基准", "仓库源码及 gyc --help 实测输出"],
        ["存放位置", "D:\\00MyAI\\gyc-code\\docs\\gyccode操作手册.docx"],
    ], widths=[3.2, 11.8])

    plain(doc, "")
    note(doc, "阅读说明：第一章至第四章为入门必读，按顺序阅读即可上手使用；"
              "第五章之后为速查参考，可按需检索。本手册所有命令、参数与快捷键"
              "均已与实际程序核对，仓库 README 与程序行为不一致之处，"
              "统一在第十四章列明。")


def chapter1(doc):
    h1(doc, "一、总则")
    h2(doc, "（一）编制目的")
    body(doc, "为使初次接触人工智能编程助手的同志能够独立、正确、高效地使用 "
              "gyccode，编制本操作手册。手册以“读懂即可上手”为原则，"
              "对系统的定位、概念、命令、界面、工具、配置、权限与扩展能力"
              "逐项说明，并给出可直接照做的操作示例。")
    h2(doc, "（二）编制依据")
    body(doc, "本手册全部内容依据 gyc-code 仓库源代码及程序实际运行结果编写，"
              "主要事实来源如下：一是 gyc 命令行程序自身的帮助输出；"
              "二是源码中的工具注册表 src/gyccode/tool/registry.ts；"
              "三是快捷键定义表 src/tui/config/keybind.ts；"
              "四是权限、配置、目录等基础模块的实现代码。")
    h2(doc, "（三）适用环境")
    table(doc, [
        ["项目", "要求"],
        ["运行环境", "Windows / macOS / Linux"],
        ["运行时", "Bun 1.3.14 及以上；Node.js 22.5.0 及以上"],
        ["开发语言", "TypeScript（运行于 Bun 运行时）"],
        ["界面技术", "Effect v4 beta 运行时、OpenTUI 终端界面、React Web 界面"],
    ], widths=[3.6, 11.4])
    h2(doc, "（四）术语约定")
    body(doc, "本手册中，“用户”一律指实际操作本系统的人员。"
              "命令、参数、文件路径、代码标识符保留原样，不作翻译。"
              "凡标注“注意”“警告”的内容，均为易导致误操作的关键事项，务必先行阅读。")


def chapter2(doc):
    h1(doc, "二、系统概述")

    h2(doc, "（一）系统定位")
    body(doc, "gyccode 是一个运行于命令行的智能编码助手。使用者以自然语言描述需求，"
              "系统自行阅读代码、修改文件、执行命令、运行测试，并将结果汇报。"
              "其本质是一个“会自己动手干活的技术同事”，"
              "而非传统的按既定流程机械执行的命令行工具。")

    h3(doc, "1. 与常规软件的差异")
    table(doc, [
        ["对比项", "常规软件", "gyccode"],
        ["交互方式", "点击按钮、填写表单", "用自然语言描述需求"],
        ["执行逻辑", "按写死的固定流程", "自行判断需读取和修改哪些文件"],
        ["出错处理", "弹出报错提示后终止", "自行读取报错、修正并重试"],
        ["使用者要求", "会点击鼠标即可", "能清楚表达诉求，并能核查其改动"],
    ], widths=[2.6, 5.4, 7.0])

    h2(doc, "（二）工作原理")
    body(doc, "系统内部运行一个“智能体循环”。使用者输入一句话后，"
              "大模型进行推理，判断下一步需要做什么，"
              "再通过调用“工具”来实际执行动作，随后根据返回结果继续推理，直至任务完成。")

    code(doc,
         "使用者输入需求\n"
         "      ↓\n"
         "  模型推理：需先查看目标文件\n"
         "      ↓\n"
         "  调用工具 read(文件路径)          ← 工具即模型的“手”\n"
         "      ↓\n"
         "  工具返回文件内容\n"
         "      ↓\n"
         "  模型推理：需要修改第 42 行\n"
         "      ↓\n"
         "  调用工具 edit(路径, 原文, 新文)\n"
         "      ↓\n"
         "  工具实际修改磁盘文件，并自动生成备份\n"
         "      ↓\n"
         "  模型推理：还需运行测试验证\n"
         "      ↓\n"
         "  调用工具 bash(\"bun test\")\n"
         "      ↓\n"
         "  测试失败 → 读取报错 → 修正 → 重跑（自动循环，直至通过）\n"
         "      ↓\n"
         "  模型汇报结果")

    body(doc, "由此可得三点关键认识：第一，模型自身无法直接操作计算机，"
              "其一切行为均须经由工具执行；第二，界面上显示的每一次文件改动与命令执行，"
              "都是模型主动调用工具的结果；第三，正因如此，"
              "系统的管控方式是按“每一次工具调用”逐次审批，而非笼统的整体信任。")

    h2(doc, "（三）系统组成")
    table(doc, [
        ["组成部分", "作用", "对应界面或命令"],
        ["命令行界面", "逐行对话，适合脚本与快速问答", "gyc cli / gyc run"],
        ["终端全屏界面", "功能最全，含会话管理、差异查看", "gyc（默认命令）"],
        ["浏览器界面", "含聊天、文件树、代码编辑器、差异视图、终端", "gyc web"],
        ["无头服务", "后台常驻，供多端接入", "gyc serve / gyc attach"],
        ["编辑器协议服务", "供支持该协议的编辑器调用", "gyc acp"],
    ], widths=[2.8, 7.4, 4.8])

    h2(doc, "（四）工程结构")
    body(doc, "供二次开发时参考。仓库根目录为 D:\\00MyAI\\gyc-code，主要目录如下。")
    code(doc,
         "D:\\00MyAI\\gyc-code\\\n"
         "├─ bin\\gyc                启动器（Node 脚本）\n"
         "├─ src\\gyccode\\           自研主层：命令行、会话、服务商、工具、技能、智能体\n"
         "├─ src\\core\\              内核层：配置、数据库、文件、运行时\n"
         "├─ src\\cli\\cmd\\           各命令的实现\n"
         "├─ src\\tui\\               终端全屏界面\n"
         "├─ src\\webapp\\            浏览器界面\n"
         "├─ docs\\                  文档（本手册所在目录）\n"
         "├─ .githooks\\             Git 钩子（提交后自动推送并同步知识库）\n"
         "└─ scripts\\               构建与同步脚本")


def chapter3(doc):
    h1(doc, "三、安装与启动")

    h2(doc, "（一）环境准备")
    body(doc, "使用前须确认已安装 Bun 与 Node.js。在终端执行下列命令验证，"
              "若能正常输出版本号即表示环境就绪。")
    code(doc, "bun --version        # 应输出 1.3.14 或更高\nnode --version      # 应输出 v22.5.0 或更高")

    h2(doc, "（二）三种启动方式")
    body(doc, "系统提供三种启动方式，其区别在于实际运行的是打包产物还是源代码。"
              "选错会导致“修改后不生效”，务必区分。")
    table(doc, [
        ["方式", "命令", "实际运行", "适用情形"],
        ["一、打包产物", "gyc", "dist/index.js", "日常使用"],
        ["二、源码直跑", "bun run dev", "src/gyccode/index.ts", "开发调试"],
        ["三、显式调用", "node bin/gyc", "有产物走产物，否则走源码", "排查启动问题"],
    ], widths=[2.8, 3.4, 5.0, 3.8])

    note(doc, "警告：最常见的困扰是“修改了代码却没有生效”。"
              "原因在于启动器 bin/gyc 的规则是——只要 dist/index.js 文件存在，"
              "就优先运行该产物，而不读取源代码。因此修改 src 目录下的代码后，"
              "直接执行 gyc 仍会得到旧行为。解决办法有二："
              "其一，若想立即观察源码效果，改用 bun run dev；"
              "其二，若希望 gyc 命令本身生效，须先执行 bun run build 重新打包。")

    h2(doc, "（三）安装与打包")
    code(doc,
         "# 安装依赖（安装过程会顺带安装 Git 钩子）\n"
         "bun install\n\n"
         "# 打包生成 dist 目录（日常使用的 gyc 即指向此产物）\n"
         "bun run build")
    body(doc, "安装完成后，命令行工具名为 gyc。全局安装与本地仓库安装指向同一份产物。")

    h2(doc, "（四）升级与卸载")
    code(doc,
         "gyc upgrade              # 升级至最新版\n"
         "gyc upgrade 0.1.48       # 升级至指定版本\n"
         "gyc upgrade -m npm       # 指定安装方式：curl/npm/pnpm/bun/brew/choco/scoop\n"
         "gyc uninstall            # 卸载并清理全部相关文件")


def chapter4(doc):
    h1(doc, "四、核心概念")
    body(doc, "本章说明六个贯穿全书的基本概念。理解这六个概念，即可读懂后续全部命令与配置。")

    h2(doc, "（一）会话")
    body(doc, "会话是一次连续对话及其全部工作成果的完整记录，"
              "包含全部对话消息、工具调用记录、文件改动情况与成本消耗。")
    body(doc, "会话保存在本地数据库中，关闭终端后仍可继续之前的对话；"
              "每个会话具有唯一标识；会话可由既有会话派生形成父子关系；"
              "在终端界面中可创建子会话并在父子会话之间切换。")
    body(doc, "相关命令：gyc session list、gyc session delete、gyc export、gyc import。")

    h2(doc, "（二）工具")
    body(doc, "工具是模型的操作手段。模型自身不能接触计算机，"
              "其读取文件、修改文件、执行命令等一切行为，均须通过调用工具完成。")
    body(doc, "系统内置工具共五十一个，按职能分为四类。")
    table(doc, [
        ["类别", "职能", "代表性工具"],
        ["文件类", "读取、写入、修改、检索", "read、write、edit、glob、grep"],
        ["执行类", "执行命令、运行代码", "bash、bash_background"],
        ["协作类", "派发子任务、通知、征询", "task、actor、swarm、question、brief"],
        ["集成类", "联网、浏览器、版本控制、外部协议、定时任务",
         "webfetch、browser、git_diff、schedule_cron"],
    ], widths=[2.2, 6.2, 6.6])
    body(doc, "完整工具清单见第七章。")

    h2(doc, "（三）权限")
    body(doc, "每一次工具调用之前，系统均须先行审批。默认策略为询问，"
              "即模型意图修改文件时会弹出确认；亦可配置为直接放行或永久拒绝。"
              "详见第九章。")

    h2(doc, "（四）智能体")
    body(doc, "智能体是模型的工作角色，决定其行事风格与是否具备修改文件的权限。"
              "系统内置四个智能体。")
    table(doc, [
        ["智能体", "用途", "可否修改文件"],
        ["build", "默认角色，按既定权限执行各类工具", "可以"],
        ["plan", "计划模式，仅分析不改动", "不可以（禁用全部编辑类工具）"],
        ["general", "通用研究型，可并行处理多项事务", "可以"],
        ["explore", "代码库探索型，仅读取不改动", "不可以"],
    ], widths=[2.6, 8.4, 4.0])
    body(doc, "切换方式：在终端界面按 Tab 切换至下一个智能体，"
              "按 Shift+Tab 切换至上一个；命令行方式为 --agent plan。")
    body(doc, "管理命令：gyc agent list、gyc agent create。")

    h2(doc, "（五）技能")
    body(doc, "技能是一份可复用的操作说明书。当任务场景符合某个技能时，"
              "模型会自动加载并遵照执行。")
    body(doc, "一个技能即为一个文件夹加一个 SKILL.md 文件，"
              "文件开头写明适用场景，正文写明操作步骤。"
              "存放位置为项目 .gyccode/skills/子目录名/SKILL.md，"
              "亦可存放于全局技能目录。在终端界面输入斜杠符号即可列出全部可用技能。")
    body(doc, "管理命令：斜杠命令 skill-create 用于创建；gyc learning 用于管理已沉淀的技能。")

    h2(doc, "（六）模型")
    body(doc, "模型是实际完成工作的核心。不同模型在能力、费用、速度上各有差异。")
    body(doc, "模型在系统中写作“服务商/模型名”格式，例如 deepseek/deepseek-chat。"
              "默认模型在配置文件中指定，亦可在命令行以 -m 参数临时指定。"
              "在终端界面中按 Ctrl+X 后再按 M（即 leader 加 m）可打开模型列表。")
