# -*- coding: utf-8 -*-
"""
scripts/manual_content_6.py
《gyccode 操作手册》正文 —— 第十七章（配置项全表）与第十八章（环境变量全表）。
"""
from docx.enum.text import WD_ALIGN_PARAGRAPH

from manual_docx_style import (FONT_BODY, FONT_H1, FONT_H2, SZ_BODY, SZ_TITLE,
                               body, code, h1, h2, h3, h4, note, para, plain,
                               set_run_font, table)


def chapter17(doc):
    h1(doc, "十七、配置项全表")
    note(doc, "本章列出配置文件中全部顶层字段。字段名一律为英文，"
              "填写时须严格一致；出现无法识别的顶层字段时，"
              "程序启动会直接报错并指出该字段名。"
              "标注“已废弃”的字段虽仍可填写，但已不再生效。")

    h2(doc, "（一）模型与服务商")
    table(doc, [
        ["字段", "说明"],
        ["model", "默认模型，格式为 服务商/模型名"],
        ["small_model", "轻量模型，用于摘要一类低强度任务，以降低开销"],
        ["small_model_heuristic", "轻量模型的自动选用策略"],
        ["enabled_providers", "启用的服务商名称数组。填入后仅这些服务商可用"],
        ["disabled_providers", "禁用的服务商名称数组。优先级高于上一项"],
        ["provider", "服务商配置。以服务商名称为键，"
                     "每项含接口地址、密钥、模型列表、请求头等"],
        ["disabled_providers 说明", "该字段与上一字段互斥使用，一般只填其一"],
    ], widths=[4.6, 10.4])

    h2(doc, "（二）智能体与语言")
    table(doc, [
        ["字段", "说明"],
        ["default_agent", "默认智能体名称。不填则自动选取首个可见的主智能体"],
        ["subagent_depth", "子智能体嵌套深度上限，默认为一，即子智能体不能再派生子智能体"],
        ["agent", "自定义智能体。以名称为键，"
                   "每项含说明、模式、模型、提示词、工具开关、权限规则等"],
        ["mode", "权限模式，可填 default 默认、acceptEdits 自动接受编辑、"
                 "plan 计划、bypassPermissions 绕过审批"],
        ["language", "回复语言。填写简体中文时，界面与提示均以中文显示"],
        ["username", "界面中显示的称呼"],
    ], widths=[4.6, 10.4])

    h2(doc, "（三）界面与外壳")
    table(doc, [
        ["字段", "说明"],
        ["shell", "默认外壳名称，可填 bash、pwsh、powershell、cmd"],
        ["username 说明", "仅影响界面显示，不影响权限"],
        ["layout", "界面布局。已废弃，一律使用自适应布局"],
        ["formatter", "输出格式化器配置，用于调整工具输出的呈现方式"],
        ["instructions", "追加的系统提示数组。每项一段，"
                         "会拼接进模型提示，作用等同于给 AI 补充项目规矩"],
    ], widths=[4.6, 10.4])

    h2(doc, "（四）权限与工具")
    table(doc, [
        ["字段", "说明"],
        ["permission", "权限规则。详见本手册第九章"],
        ["tools", "工具开关。以工具标识为键，值为布尔值。"
                   "填 false 即关闭该工具，模型将无法调用"],
    ], widths=[4.6, 10.4])
    body(doc, "例如关闭联网检索与浏览器截图两个工具：")
    code(doc,
         '{\n'
         '  "tools": {\n'
         '    "websearch": false,\n'
         '    "browser": false\n'
         '  }\n'
         '}')

    h2(doc, "（五）技能与外部资源")
    table(doc, [
        ["字段", "说明"],
        ["skills", "附加的技能文件夹路径数组，"
                   "可将自定义技能目录纳入扫描范围"],
        ["references", "参考资料配置，用于给模型补充外部文档"],
        ["reference", "参考资料配置（另一形式），作用同上"],
        ["command", "自定义命令。以名称为键，每项含说明与内容模板。"
                    "配置后即成为终端界面中的一条斜杠命令"],
        ["mcp", "外部协议服务器配置，详见本手册第十章"],
        ["plugin", "插件规格数组，用于声明要加载的插件"],
        ["lsp", "语言服务器配置。以语言为键，每项含启动命令与文件匹配规则"],
    ], widths=[4.6, 10.4])

    h2(doc, "（六）安全与数据")
    table(doc, [
        ["字段", "说明"],
        ["snapshot", "是否启用文件快照。启用后改动前自动留存历史版本"],
        ["watcher", "文件监听配置。其 ignore 数组列出需忽略的路径，"
                    "如大型构建产物目录，以减少无谓的重新扫描"],
        ["share", "会话分享方式，可填 manual 手动、auto 自动、disabled 关闭"],
        ["autoshare", "是否自动分享。已并入 share 字段，建议改用 share"],
        ["autoupdate", "自动更新方式，可填 true 自动、false 关闭、notify 仅提示"],
        ["server", "服务端配置，含用户名与密码"],
    ], widths=[4.6, 10.4])

    h2(doc, "（七）输出与上下文")
    table(doc, [
        ["字段", "说明"],
        ["tool_output", "工具输出长度限制。包含超大输出时截断的阈值，"
                        "以及触发自动压缩的阈值"],
        ["compaction", "上下文压缩策略。包含触发压缩的阈值、"
                       "保留的最近轮数等"],
        ["token_counting", "令牌统计方式配置"],
        ["token_budget", "令牌预算配置。达到上限时触发压缩或提示"],
        ["llm", "大模型调用参数配置，含超时、重试等"],
        ["attachment", "附件处理配置"],
    ], widths=[4.6, 10.4])

    h2(doc, "（八）记忆与学习")
    table(doc, [
        ["字段", "说明"],
        ["memory", "记忆配置。控制跨会话记忆的存放位置与检索范围"],
        ["learning", "学习配置。控制技能沉淀的启用、归档阈值与生命周期"],
        ["enterprise", "企业配置，面向组织统一下发"],
    ], widths=[4.6, 10.4])

    h2(doc, "（九）实验与内部")
    table(doc, [
        ["字段", "说明"],
        ["experimental", "实验特性开关。实验特性不建议在正式环境使用"],
        ["config", "内嵌配置对象。优先级低于外部配置文件"],
        ["remote_config", "远程配置对象，由服务端下发"],
    ], widths=[4.6, 10.4])

    h2(doc, "（十）配置示例：一个可用的最小配置")
    code(doc,
         '{\n'
         '  "$schema": "https://gyccode.dev/schema.json",\n\n'
         '  // 设定默认模型与轻量模型\n'
         '  "model": "deepseek/deepseek-chat",\n'
         '  "small_model": "deepseek/deepseek-chat",\n'
         '  "default_agent": "build",\n'
         '  "language": "zh-CN",\n\n'
         '  // 界面显示简体中文\n'
         '  "logLevel": "INFO",\n\n'
         '  // 敏感文件一律拒绝改动，其余编辑需确认\n'
         '  "permission": {\n'
         '    "edit": {\n'
         '      "*.env": "deny",\n'
         '      "*.key": "deny",\n'
         '      "**": "ask"\n'
         '    },\n'
         '    "bash": "ask",\n'
         '    "webfetch": "allow"\n'
         '  },\n\n'
         '  // 告知模型本项目规矩\n'
         '  "instructions": [\n'
         '    "提交信息一律使用简体中文",\n'
         '    "改动前先阅读相关文件",\n'
         '    "不得修改 dist 与 node_modules 目录"\n'
         '  ]\n'
         '}')


def chapter18(doc):
    h1(doc, "十八、环境变量全表")
    body(doc, "环境变量用于在启动时调整程序行为，"
              "优先级通常高于配置文件，"
              "适合临时调整与自动化场景。")

    h2(doc, "（一）实验特性总开关")
    body(doc, "设置该变量为真后，其下多数实验特性一并启用，"
              "可省去逐项设置之烦。")
    table(doc, [
        ["变量", "说明"],
        ["GYCCODE_EXPERIMENTAL", "实验特性总开关。设置后其下多数实验项一并启用"],
    ], widths=[6.4, 8.6])

    h2(doc, "（二）功能开关")
    body(doc, "此类变量用于按需启用或关闭某项能力，"
              "设置时填写真或假。")
    table(doc, [
        ["变量", "默认", "说明"],
        ["GYCCODE_AUTO_SHARE", "假", "自动分享会话"],
        ["GYCCODE_PURE", "假", "不加载外部插件运行"],
        ["GYCCODE_DISABLE_DEFAULT_PLUGINS", "假", "禁用内置插件"],
        ["GYCCODE_DISABLE_EMBEDDED_WEB_UI", "假", "禁用内嵌网页界面"],
        ["GYCCODE_DISABLE_EXTERNAL_SKILLS", "假", "禁用外部来源的技能"],
        ["GYCCODE_DISABLE_COMPOSE_SKILLS", "假", "禁用编排技能"],
        ["GYCCODE_DISABLE_LEARNED_SKILLS", "假", "禁用已沉淀的技能"],
        ["GYCCODE_DISABLE_LSP_DOWNLOAD", "假", "禁用语言服务器自动下载"],
        ["GYCCODE_DISABLE_CLAUDE_CODE", "假", "禁用兼容层的提示与技能"],
        ["GYCCODE_DISABLE_CLAUDE_CODE_PROMPT", "假", "仅禁用兼容层的提示"],
        ["GYCCODE_DISABLE_CLAUDE_CODE_SKILLS", "假", "仅禁用兼容层的技能"],
        ["GYCCODE_DISABLE_CODEX_SKILLS", "假", "禁用兼容格式的技能"],
        ["GYCCODE_DISABLE_OPENCODE_SKILLS", "假", "禁用兼容格式的技能"],
        ["GYCCODE_DISABLE_AUTOCOMPACT", "假", "禁用自动压缩上下文"],
        ["GYCCODE_DISABLE_MODELS_FETCH", "假", "禁用在线获取模型列表，仅用本地缓存"],
        ["GYCCODE_DISABLE_PROJECT_CONFIG", "假", "禁用项目级配置，仅用全局配置"],
        ["GYCCODE_DISABLE_GIT", "假", "禁用版本控制相关能力"],
        ["GYCCODE_DISABLE_SHARE", "假", "禁用会话分享"],
        ["GYCCODE_DISABLE_MOUSE", "假", "禁用鼠标支持"],
        ["GYCCODE_DISABLE_TERMINAL_TITLE", "假", "禁用终端标题写入"],
        ["GYCCODE_DISABLE_PRUNE", "假", "禁用自动清理无用数据"],
        ["GYCCODE_DISABLE_AUTOUPDATE", "假", "禁用自动更新"],
        ["GYCCODE_DISABLE_FFF", "假", "禁用快速文件检索后端"],
        ["GYCCODE_ENABLE_DEBUG_WORKSPACE", "假", "启用调试工作区"],
        ["GYCCODE_ENABLE_EXA", "假", "启用外部检索服务，从而开放联网检索工具"],
        ["GYCCODE_ENABLE_PARALLEL", "假", "启用并行检索，从而开放联网检索工具"],
        ["GYCCODE_ENABLE_EXPERIMENTAL_MODELS", "假", "启用实验性模型"],
        ["GYCCODE_ENABLE_QUESTION_TOOL", "假", "强制开放征询工具"],
    ], widths=[7.0, 1.4, 6.6])

    h2(doc, "（三）实验特性分项")
    body(doc, "以下各项除总开关外亦可单独启用。")
    table(doc, [
        ["变量", "说明"],
        ["GYCCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS", "启用后台子智能体，"
                                                     "即子智能体可脱离主流程独立运行"],
        ["GYCCODE_EXPERIMENTAL_LSP_TOOL", "启用语言服务工具"],
        ["GYCCODE_EXPERIMENTAL_LSP_TY", "启用语言服务的类型推导"],
        ["GYCCODE_EXPERIMENTAL_PLAN_MODE", "启用计划模式工具"],
        ["GYCCODE_EXPERIMENTAL_CODE_MODE", "启用代码模式工具"],
        ["GYCCODE_EXPERIMENTAL_EVENT_SYSTEM", "启用事件系统"],
        ["GYCCODE_EXPERIMENTAL_WORKSPACES", "启用隔离工作区工具"],
        ["GYCCODE_EXPERIMENTAL_REFERENCES", "启用查找引用工具"],
        ["GYCCODE_EXPERIMENTAL_ICON_DISCOVERY", "启用图标自动发现"],
        ["GYCCODE_EXPERIMENTAL_OXFMT", "启用外部格式化工具"],
        ["GYCCODE_EXPERIMENTAL_NATIVE_LLM", "启用原生大模型通道"],
        ["GYCCODE_EXPERIMENTAL_WEBSOCKETS", "启用 WebSocket 通道"],
        ["GYCCODE_EXPERIMENTAL_FILEWATCHER", "启用文件监听"],
        ["GYCCODE_EXPERIMENTAL_DISABLE_FILEWATCHER", "禁用文件监听"],
        ["GYCCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT", "禁用选中即复制"],
        ["GYCCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX", "限制单次输出令牌上限，"
                                                  "填正整数；填非正整数视为未设置"],
        ["GYCCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS", "设置命令默认超时毫秒数，"
                                                        "默认两分钟"],
    ], widths=[7.4, 7.6])

    h2(doc, "（四）路径与内容")
    body(doc, "此类变量用于指定文件位置或直接注入配置内容，"
              "在测试与自动化场景中尤为有用。")
    table(doc, [
        ["变量", "说明"],
        ["GYCCODE_CONFIG", "指定配置文件路径，优先于默认的查找流程"],
        ["GYCCODE_CONFIG_CONTENT", "直接以字符串形式提供配置内容，"
                                   "内容须为合法 JSON；优先级极高"],
        ["GYCCODE_CONFIG_DIR", "指定配置根目录，用于隔离测试环境"],
        ["GYCCODE_TUI_CONFIG", "指定界面配置文件路径"],
        ["GYCCODE_DB", "指定数据库文件路径"],
        ["GYCCODE_MODELS_PATH", "指定模型清单文件路径"],
        ["GYCCODE_MODELS_URL", "指定模型清单的获取地址"],
        ["GYCCODE_PLUGIN_META_FILE", "指定插件元信息文件路径"],
        ["GYCCODE_GIT_BASH_PATH", "指定命令执行所用的 Git Bash 路径"],
        ["GYCCODE_WORKSPACE_ID", "指定工作区标识"],
    ], widths=[6.4, 8.6])

    h2(doc, "（五）服务与鉴权")
    table(doc, [
        ["变量", "说明"],
        ["GYCCODE_SERVER_USERNAME", "服务端鉴权用户名，默认值为 gyccode"],
        ["GYCCODE_SERVER_PASSWORD", "服务端鉴权密码。"
                                    "监听非本机地址时必须设置"],
        ["GYCCODE_ACCOUNT_URL", "自建账号服务的地址"],
        ["GYCCODE_SHARE_URL", "自建会话分享服务的地址"],
        ["GYCCODE_UPGRADE_URL", "自建升级服务的地址"],
        ["GYCCODE_CLIENT", "客户端类型标识，默认值为 cli"],
    ], widths=[6.4, 8.6])
    note(doc, "说明：账号、分享、升级三处地址指向自建服务，"
              "用于脱离第三方服务独立运行。"
              "另需注意，即时通讯网关的凭据读取顺序为："
              "文件优先于环境变量，"
              "因为宿主环境可能注入了陈旧的快照，"
              "该设计与常规做法相反，特此说明。")

    h2(doc, "（六）诊断与性能")
    table(doc, [
        ["变量", "说明"],
        ["GYCCODE_LOG_LEVEL", "日志级别，可填 DEBUG、INFO、WARN、ERROR"],
        ["GYCCODE_PRINT_LOGS", "将日志输出至标准错误流"],
        ["GYCCODE_SHOW_TTFD", "显示首字响应时间"],
        ["GYCCODE_ALWAYS_NOTIFY_UPDATE", "始终提示可用的更新"],
        ["GYCCODE_AUTO_HEAP_SNAPSHOT", "自动导出堆快照"],
        ["GYCCODE_PERMISSION", "以环境变量方式指定权限模式"],
        ["GYCCODE_FAKE_VCS", "模拟版本控制类型，用于测试无仓库场景"],
        ["OTEL_EXPORTER_OTLP_ENDPOINT", "遥测数据上报地址"],
        ["OTEL_EXPORTER_OTLP_HEADERS", "遥测数据上报的附加头"],
    ], widths=[6.4, 8.6])

    h2(doc, "（七）启动器专用")
    body(doc, "以下变量仅在通过启动器启动时生效。")
    table(doc, [
        ["变量", "说明"],
        ["GYC_MAX_OLD_SPACE", "旧生代内存上限，单位 MB。不填则按物理内存的百分之三十五"
                              "与二千零四十八取较小值，并设一千零二十四的下限"],
        ["GYC_NODE", "指定 Node 可执行文件路径"],
        ["GYC_BUN", "指定 Bun 可执行文件路径"],
    ], widths=[5.4, 9.6])

    h2(doc, "（八）服务商密钥")
    body(doc, "各服务商的密钥以服务商名称大写加下划线作为变量名，"
              "例如：")
    code(doc,
         "DEEPSEEK_API_KEY\n"
         "OPENROUTER_API_KEY\n"
         "SILICONFLOW_API_KEY\n"
         "NVIDIA_API_KEY\n"
         "ANTHROPIC_API_KEY\n"
         "OPENAI_API_KEY\n"
         "GOOGLE_GENERATIVE_AI_API_KEY\n"
         "AZURE_API_KEY")
    body(doc, "更多服务商可参考执行 gyc providers list 的输出。")
