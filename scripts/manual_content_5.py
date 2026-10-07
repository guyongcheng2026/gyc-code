# -*- coding: utf-8 -*-
"""
scripts/manual_content_5.py
《gyccode 操作手册》正文 —— 第十六章（内置工具参数大全）。

逐个工具列出全部参数、必填与否、取值范围与默认行为。
事实来源: 各工具文件的 Parameters Schema 定义。
"""
from docx.enum.text import WD_ALIGN_PARAGRAPH

from manual_docx_style import (FONT_BODY, FONT_H1, FONT_H2, SZ_BODY, SZ_TITLE,
                               body, code, h1, h2, h3, h4, note, para, plain,
                               set_run_font, table)

# 参数表统一表头
PH = ["参数", "必填", "说明与取值"]


def chapter16(doc):
    h1(doc, "十六、内置工具参数大全")
    note(doc, "本章逐个列出全部内置工具的参数。表中“必填”一栏标注为“是”的参数，"
              "若缺失将导致调用失败；标注为“否”的参数可省略，"
              "省略时按说明栏所述的默认行为处理。"
              "参数名称一律为英文小写下划线形式，与程序内部一致。")

    # ---------------------------------------------------------------- 文件类
    h2(doc, "（一）read 读取文件")
    code(doc, "工具标识: read     权限类别: read     归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["filePath", "是", "文件路径。相对路径以当前工作目录为基准；绝对路径直接使用"],
        ["offset", "否", "起始行号。从该行开始读取；不填则从第一行开始"],
        ["limit", "否", "读取行数上限。不填则默认为 2000 行"],
    ], widths=[3.0, 1.6, 10.4])
    h3(doc, "1. 输出限制")
    body(doc, "读取结果受三重限制约束：行数上限默认二千行；"
              "单行长度超过二千字符时该行被截断并追加截断标记；"
              "总字节数上限为五十 KB。")
    body(doc, "当读取结果超过上述限制，系统会将超出部分写入临时文件，"
              "并在返回内容中明确告知文件路径，"
              "此后可用 read 配合 offset 与 limit 参数分段读取，"
              "或用 grep 在完整内容中检索。")
    body(doc, "触发行数或字节上限时读取会立即停止，不再扫描剩余内容，"
              "以避免大文件被整读。此时若无法确定文件总行数，"
              "返回内容只给出已读行区间与下一偏移量，不再标注总行数；"
              "按提示使用 offset 参数继续读取即可。")
    body(doc, "读取 PDF 文件时最多解析五十页。")

    h2(doc, "（二）write 写入文件")
    code(doc, "工具标识: write    权限类别: edit    归属: 非 gpt- 系列模型")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["filePath", "是", "目标文件路径。父目录须已已存在"],
        ["content", "是", "要写入的完整内容。会整体覆盖原文件"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "写入前自动创建备份。保留原文件编码标记；"
              "原文件为无标记 UTF-8 时按无标记 UTF-8 写回，"
              "原文件含标记时保持标记不变。"
              "备份库总量超过 200 MB 上限时，"
              "系统会在后台淘汰最旧的备份。")

    h2(doc, "（三）edit 精确替换编辑")
    code(doc, "工具标识: edit     权限类别: edit    归属: 非 gpt- 系列模型")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["filePath", "是", "目标文件路径"],
        ["oldString", "是", "要被替换的原文字符串，须在文件中唯一存在"],
        ["newString", "是", "替换后的新文字符串"],
        ["replaceAll", "否", "是否替换全部匹配项。不填则仅替换唯一匹配处"],
    ], widths=[3.0, 1.6, 10.4])
    h3(doc, "1. 匹配容错")
    body(doc, "为提高成功率，系统按由严到宽的顺序尝试多种匹配策略，依次包括："
              "完全一致、去除行首尾空白、块锚点匹配、空白归一化、缩进弹性匹配、"
              "转义归一化、多处匹配、边界修剪、上下文感知匹配。")
    body(doc, "若仍无法定位，系统会返回最接近的候选片段供模型判断，"
              "此时不会修改文件。")
    note(doc, "注意：替换成功后系统会自动记入读取缓存，"
              "使模型在同一次会话中无需重复读取文件内容，"
              "从而节省令牌消耗。编辑前自动创建备份，"
              "备份库总量超过 200 MB 上限时会在后台淘汰最旧的备份。")

    h2(doc, "（四）apply_patch 补丁编辑")
    code(doc, "工具标识: apply_patch    权限类别: edit    归属: 仅 gpt- 系列模型")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["patchText", "是", "符合补丁格式的文本，描述要应用的变更"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "该工具仅在模型名含 gpt- 且不含 gpt-4 与 oss 时提供；"
              "此时 write 与 edit 反而不提供。")

    h2(doc, "（五）glob 按名查找文件")
    code(doc, "工具标识: glob    权限类别: glob    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["pattern", "是", "文件名匹配模式，支持通配符与目录通配"],
        ["path", "否", "查找的起始目录。不填则从当前工作目录开始"],
    ], widths=[3.0, 1.6, 10.4])

    h2(doc, "（六）grep 内容检索")
    code(doc, "工具标识: grep    权限类别: grep    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["pattern", "是", "检索内容，支持正则表达式"],
        ["path", "否", "检索的起始目录。不填则从当前工作目录开始"],
        ["include", "否", "仅检索文件名匹配该模式的文件"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "匹配结果上限为一百条。超出部分不再返回。")

    h2(doc, "（七）notebook_edit 编辑笔记本")
    code(doc, "工具标识: notebook_edit    权限类别: edit    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["notebook_path", "是", "笔记本文件路径"],
        ["cell_id", "按模式", "目标单元格标识。replace 与 delete 模式须填；insert 模式不填"],
        ["new_source", "按模式", "单元格的新内容。replace 与 insert 模式须填"],
        ["cell_type", "否", "insert 模式下的新单元格类型，可填 code 或 markdown；不填沿用上一单元格类型"],
        ["edit_mode", "是", "编辑模式，可填 replace、insert、delete 三者之一"],
    ], widths=[3.0, 1.8, 10.2])

    h2(doc, "（八）find_references 查找引用")
    code(doc, "工具标识: find_references    权限类别: lsp    归属: 实验特性")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["symbol", "是", "要查找的符号名"],
        ["path", "是", "文件路径"],
        ["include", "否", "是否包含定义处"],
    ], widths=[3.0, 1.6, 10.4])

    h2(doc, "（九）describe_image 读取图片元数据")
    code(doc, "工具标识: describe_image    权限类别: read    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["filepath", "是", "图片文件路径"],
    ], widths=[3.0, 1.6, 10.4])
    note(doc, "重要：该工具只读取图片的客观属性，包括尺寸、色彩模式、"
              "分辨率、拍摄参数，以及矢量图内嵌的文本。"
              "它不具备文字识别能力，无法读出图片里的文字，"
              "也无法描述画面内容。理解图片内容仍依赖模型自身是否具备视觉能力。")

    # ---------------------------------------------------------------- 执行类
    h2(doc, "（十七）bash 执行命令")
    code(doc, "工具标识: bash    权限类别: bash    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["command", "是", "要执行的命令文本"],
        ["timeout", "否", "超时毫秒数。不填则默认为两分钟；填 0 表示不设超时"],
        ["workdir", "否", "运行的工作目录。应使用此参数而非在命令中切换目录"],
        ["allowDangerous", "否", "是否放行危险命令。默认为否，即危险命令一律拒绝"],
        ["background", "否", "是否以后台方式启动。填真则立即返回并给出任务标识，不等待结束"],
    ], widths=[3.4, 1.6, 10.0])

    h3(doc, "1. 危险命令清单")
    body(doc, "以下命令被归类为危险，默认拒绝执行，必须显式设置放行标志方可运行：")
    code(doc, "eval、curl 管道 bash、sudo、dd、chmod 777、fork 炸弹、rm -rf /")

    h3(doc, "2. 输出限制")
    body(doc, "输出超过既定行数或字节数时将被截断，"
              "完整输出写入文件并在返回内容中告知路径。"
              "此后应使用 read 分段读取或用 grep 检索完整内容，"
              "而不应再用 head、tail 一类命令去截取。")

    h3(doc, "3. 后台方式")
    body(doc, "将 background 参数填为真即可后台启动，"
              "适用于开发服务、文件监听、隧道等长时进程，避免等待超时。"
              "后台命令不支持超时参数。"
              "启动后须通过 bash_background 工具查询进度或终止，"
              "该工具支持三种操作：status 查询、list 列出、kill 终止。")

    h2(doc, "（十八）bash_background 后台命令管理")
    code(doc, "工具标识: bash_background    权限类别: bash    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["action", "是", "操作类型，可填 status 查询状态、list 列出全部、kill 终止"],
        ["shell_id", "按操作", "后台命令的任务标识。查询与终止时须填，列出时忽略"],
        ["maxBytes", "否", "查询状态时返回内容的字节上限"],
    ], widths=[3.0, 1.8, 10.2])

    # ---------------------------------------------------------------- 协作类
    h2(doc, "（十九）actor 子智能体会话编排")
    code(doc, "工具标识: actor    权限类别: task    归属: 始终提供")
    body(doc, "该工具以操作类型区分不同用法，参数随之不同。")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["action", "是", "操作类型，可填 run 同步执行、spawn 后台启动、"
                        "status 查询状态、wait 等待完成、cancel 取消、list 列出"],
        ["subagent_type", "按操作", "run 与 spawn 须填。子智能体类型，一般为 explore 或 general"],
        ["description", "按操作", "run 与 spawn 须填。三至五个词的简短说明"],
        ["prompt", "按操作", "run 与 spawn 须填。交由子智能体执行的完整任务说明"],
        ["actor_id", "按操作", "status、wait、cancel 必填；run 与 spawn 可填，"
                               "用于接续既有子智能体会话"],
        ["timeout_ms", "否", "wait 操作的等待上限，默认十分钟"],
        ["model", "否", "run 与 spawn 可填。指定模型，一般无需填写"],
        ["task_id", "否", "关联的任务编号，仅作记录用，不影响执行"],
        ["command", "否", "触发本次任务的原始命令，仅作记录用"],
        ["context", "否", "上下文继承方式，可填 none 不继承、state 继承状态、full 继承全部；"
                         "仅 none 可用"],
    ], widths=[3.0, 1.8, 10.2])
    h3(doc, "1. 各操作的典型流程")
    body(doc, "同步执行：填 run，阻塞等待子智能体完成并直接返回其结果，"
              "适用于需要立刻拿到结论的独立任务。")
    body(doc, "后台启动：填 spawn，立即返回子智能体会话标识而不等待，"
              "适用于耗时长、不阻塞主流程的任务。")
    body(doc, "查询状态：填 status 加上会话标识，不阻塞，"
              "返回该子智能体是运行中、已完成、失败还是已取消。")
    body(doc, "等待完成：填 wait 加上会话标识，阻塞至其完成或达到等待上限。")
    body(doc, "取消：填 cancel 加上会话标识，优雅终止运行中的子智能体，重复调用无副作用。")
    body(doc, "列出：填 list，列出当前全部子智能体会话。")
    note(doc, "注意：子智能体的嵌套深度有上限，一般为一层，"
              "即子智能体不能再派生子智能体，以免无限递归。")

    h2(doc, "（二十）task 派发子任务")
    code(doc, "工具标识: task    权限类别: task    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["subagent_type", "是", "子智能体类型，一般为 explore 或 general"],
        ["description", "是", "三至五个词的简短说明"],
        ["prompt", "是", "交由子智能体执行的完整任务说明"],
        ["background", "否", "是否后台执行。填真则立即返回而不等待结果"],
        ["task_id", "否", "关联的任务编号，仅作记录用，不影响执行"],
        ["command", "否", "触发本次任务的原始命令，仅作记录用"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "可用的子智能体类型及其各自可用的工具，"
              "会在调用时随工具说明一并列出。")
    body(doc, "采用前台方式时阻塞等待子智能体完成并直接返回其结果；"
              "采用后台方式则立即返回任务标识，"
              "此后用 task_list 与 task_get 查询、用 task_stop 终止。")

    h2(doc, "（二十一）swarm 并行子智能体团队")
    code(doc, "工具标识: swarm    权限类别: task    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["goal", "是", "整个团队要共同达成的目标"],
        ["teammates", "是", "成员列表。每名成员需指明角色与具体任务"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "系统按目标类型自动选择成员角色，一般为探索者、实现者、审查者或排错者，"
              "亦可由调用方显式指定。"
              "适用于多个互不依赖的子任务需要并行推进的场合。")

    h2(doc, "（二十二）task_list、task_get、task_stop 后台任务管理")
    code(doc, "工具标识: task_list / task_get / task_stop    权限类别: task")
    table(doc, [
        ["工具", "参数", "必填", "说明"],
        ["task_list", "无", "—", "列出运行中及近期已完成的全部后台任务"],
        ["task_get", "task_id", "是", "查看指定任务的详情"],
        ["task_stop", "task_id", "是", "停止指定任务"],
    ], widths=[3.4, 2.6, 1.4, 7.6])
    h2(doc, "（二十三）todowrite 维护任务清单")
    code(doc, "工具标识: todowrite    权限类别: todowrite    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["todos", "是", "任务条目数组。每条包含内容、状态，状态可取未开始、进行中、已完成"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "三步以上的任务建议使用，用以驱动模型逐项推进并向使用者展示进度。"
              "任何时刻有且仅有一项处于进行中状态。")

    h2(doc, "（二十四）question 向使用者征询")
    code(doc, "工具标识: question    权限类别: question    归属: 受限，见下")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["questions", "是", "问题数组。每条包含问题内容、简短标题、候选项数组，"
                            "并可标记是否允许多选"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "候选项由系统自动追加“自行填写”一项。使用者选定后，"
              "模型将据此继续。仅在客户端为应用、命令行或桌面端时提供。")

    h2(doc, "（二十五）brief 发送进度通知")
    code(doc, "工具标识: brief    权限类别: 无需审批    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["message", "是", "通知正文"],
        ["level", "是", "通知级别，可填 info 普通提示、warning 警告、critical 严重"],
    ], widths=[3.0, 1.6, 10.4])

    h2(doc, "（二十六）peer_send 与 peer_read 智能体互发消息")
    code(doc, "工具标识: peer_send / peer_read    权限类别: 无需审批")
    body(doc, "用于同一会话内多个智能体之间的直接通信："
              "peer_send 向指定智能体发送消息，peer_read 读取发给本会话的消息。"
              "可用于跨智能体传递中间结论，避免重复读取同一批文件。")

    h2(doc, "（二十七）sleep 等待")
    code(doc, "工具标识: sleep    权限类别: 无需审批    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["duration_ms", "是", "等待毫秒数，上限为三百万毫秒，即五分钟"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "用于等待后台任务或外部条件就绪。")

    h2(doc, "（二十八）schedule_cron 设定时任务")
    code(doc, "工具标识: schedule_cron    权限类别: 无需审批    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["cron", "是", "五段式定时表达式，依次为分、时、日、月、星期，"
                      "按本地时间计算。例如每五分钟为 */5 * * * *"],
        ["prompt", "是", "每次触发时投放到会话中的提示内容"],
        ["recurring", "否", "是否周期执行。默认为真，即持续触发；"
                            "填假则仅触发一次并自动删除"],
        ["durable", "否", "是否持久化到磁盘以跨重启保留。默认为假，"
                          "即会话结束即失效"],
        ["continuity", "否", "是否将上次触发的输出带入本次上下文，"
                            "用以避免重复说明背景。默认为否"],
        ["scratchpad", "否", "为该任务指定的持久化记事本初始内容"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "配套的 cron_list 用于列出全部定时任务，"
              "cron_delete 用于按标识删除。")

    h2(doc, "（二十九）plan_enter 与 plan_exit 计划模式")
    code(doc, "工具标识: plan_enter / plan_exit    权限类别: 无需审批")
    body(doc, "用于进入与退出计划模式。进入后模型只读不改，"
              "所有编辑类工具被禁用。属实验特性，仅命令行客户端提供。")

    # ---------------------------------------------------------------- 集成类
    h2(doc, "（三十）webfetch 抓取网页")
    code(doc, "工具标识: webfetch    权限类别: webfetch    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["url", "是", "网页地址。必须以 http 或 https 开头"],
        ["format", "否", "返回格式，可填 markdown（默认）、text 纯文本、html 源文本"],
        ["timeout", "否", "超时秒数，上限为一百二十秒"],
    ], widths=[3.0, 1.6, 10.4])

    h2(doc, "（三十一）websearch 联网检索")
    code(doc, "工具标识: websearch    权限类别: websearch    归属: 受限，见下")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["query", "是", "检索词"],
        ["numResults", "否", "返回结果条数，默认八条"],
        ["type", "否", "检索类型，可填 auto 均衡（默认）、fast 快速、deep 深度"],
        ["livecrawl", "否", "实时抓取策略，可填 fallback 兜底（默认）、preferred 优先"],
        ["contextMaxCharacters", "否", "返回内容的最大字符数"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "仅在服务商为内置服务商，或已开启外部检索开关时提供。")

    h2(doc, "（三十二）browser 网页截图")
    code(doc, "工具标识: browser    权限类别: 无需审批    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["url", "是", "要打开的网页地址"],
        ["width", "否", "视口宽度，默认一千二百八十八像素，上限二千五百六十"],
        ["height", "否", "视口高度，默认九百像素"],
        ["full_page", "否", "是否截取整页。默认为否，仅截视口内可见区域"],
        ["wait", "否", "导航完成后额外等待的毫秒数，默认八百，用于给动画与懒加载留时间"],
        ["timeout", "否", "整体超时秒数，默认三十"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "该工具驱动本机已安装的浏览器进行无头渲染并截图，"
              "供模型自行核查界面布局、字体缺失、响应式错位、"
              "资源加载失败等仅看源码无法发现的问题。")
    note(doc, "限制：其一，本机必须安装 Chromium 系浏览器，未安装则直接报错而不降级；"
              "其二，不执行任何交互动作，即不点击、不滚动到指定元素、不填表单，"
              "只做“打开、等待、截图”三步；"
              "其三，若页面需要登录，工具不会代为登录，截到的将是登录页或空白；"
              "其四，截图反映的是渲染后的像素，不含文档结构，"
              "分析结构须配合抓取或读取；"
              "其五，截图落盘于数据目录下的 screenshots 子目录。")

    h2(doc, "（三十三）mcp_authenticate 外部服务授权")
    code(doc, "工具标识: mcp_authenticate    权限类别: 无需审批")
    body(doc, "对需要授权认证的外部协议服务器完成授权。"
              "工具会返回授权网址，使用者在浏览器中完成授权后，"
              "该服务器的工具随即可用。"
              "若该服务器不支持授权或已完成授权，会返回相应说明。")

    h2(doc, "（三十四）skill 加载技能")
    code(doc, "工具标识: skill    权限类别: skill    归属: 存在可用技能时")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["name", "是", "要加载的技能名称"],
    ], widths=[3.0, 1.6, 10.4])

    # ---------------------------------------------------------------- 版本控制
    h2(doc, "（三十五）git_status 查看状态")
    code(doc, "工具标识: git_status    归属: 仅版本控制仓库")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["path", "否", "限定查看范围的子路径。不填则查看整个仓库"],
    ], widths=[3.0, 1.6, 10.4])

    h2(doc, "（三十六）git_diff 查看差异")
    code(doc, "工具标识: git_diff    归属: 仅版本控制仓库")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["staged", "否", "是否仅查看已暂存的差异。不填则查看全部未提交差异"],
        ["path", "否", "限定查看范围的文件或子路径"],
    ], widths=[3.0, 1.6, 10.4])

    h2(doc, "（三十七）git_log 查看提交历史")
    code(doc, "工具标识: git_log    归属: 仅版本控制仓库")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["count", "否", "返回的提交条数"],
        ["path", "否", "仅查看某个路径的提交历史"],
    ], widths=[3.0, 1.6, 10.4])

    h2(doc, "（三十八）git_commit 提交改动")
    code(doc, "工具标识: git_commit    归属: 仅版本控制仓库")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["message", "是", "提交信息。必须提供，不填则拒绝提交"],
        ["addAll", "否", "是否一并暂存所有改动。默认为否"],
        ["run_checks", "否", "提交前是否跑与本机提交钩子相同的四项检查。默认为否"],
    ], widths=[3.0, 1.6, 10.4])
    note(doc, "警告：默认仅提交已暂存内容，即只提交使用者或模型已执行暂存的部分，"
              "不会顺带提交其他未暂存的改动。"
              "只有显式设置 addAll 才会一并暂存。"
              "这是为避免误提交而设的保护，修改此项须格外谨慎。")
    note(doc, "run_checks 为真时会在提交前检查：编码乱码、品牌用词、缺陷写法、"
              "以及仅当暂存区含 src 目录下的 TypeScript 文件时才做的类型检查。"
              "任一项不通过即拒绝提交并回灌失败原因。"
              "单项检查最长 120 秒，超时按失败计入，不会无限等待。")

    h2(doc, "（三十九）git_branch 分支操作")
    code(doc, "工具标识: git_branch    归属: 仅版本控制仓库")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["action", "是", "操作类型，可填 list 列出、create 创建、switch 切换、delete 删除"],
        ["name", "按操作", "分支名称。创建、切换、删除时须填"],
        ["force", "否", "删除时是否强制删除未合并的分支。属破坏性操作，须显式确认"],
    ], widths=[3.0, 1.8, 10.2])

    h2(doc, "（四十）git_stash 暂存操作")
    code(doc, "工具标识: git_stash    归属: 仅版本控制仓库")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["action", "是", "操作类型，可填 list 列出、push 存入、pop 取出"],
        ["message", "否", "存入时附加的说明文字"],
        ["force", "否", "取出时是否强制。属破坏性操作，须显式确认"],
    ], widths=[3.0, 1.8, 10.2])

    h2(doc, "（四十一）git_push 推送远端")
    code(doc, "工具标识: git_push    归属: 仅版本控制仓库")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["remote", "否", "远端名称。缺省时取当前分支的上游。不能以 - 开头"],
        ["branch", "否", "要推送的分支。缺省时推送当前分支。不能以 - 开头"],
        ["set_upstream", "否", "是否同时建立上游跟踪关系"],
    ], widths=[3.0, 1.8, 10.2])
    note(doc, "强制推送不在本工具的能力范围内：参数中不提供强制开关，"
              "调用方无法表达该意图，也请勿以其他参数变相达到同一效果。"
              "确需覆盖远端历史时，请先确认远端没有他人协作的提交，"
              "再由谷总手动执行。")
    note(doc, "远端名与分支名不得以减号开头。这类取值会被底层版本控制命令"
              "当作选项解析，可能引发非预期的远端配置，故一律拒绝。")

    h2(doc, "（四十二）gh_pr_create 创建合并请求")
    code(doc, "工具标识: gh_pr_create    归属: 仅版本控制仓库")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["title", "是", "合并请求标题。必须提供"],
        ["body", "否", "合并请求正文说明"],
        ["base", "否", "目标分支。缺省时由远端仓库默认值决定"],
        ["head", "否", "来源分支。缺省时取当前分支"],
        ["draft", "否", "是否以草稿状态创建"],
    ], widths=[3.0, 1.6, 10.4])
    note(doc, "依赖本机已安装并登录 GitHub 命令行工具。未安装时会返回可读提示，"
              "不会静默失败。具体命令单次最长 30 秒。")

    h2(doc, "（四十三）ci_status 查询持续集成状态")
    code(doc, "工具标识: ci_status    归属: 仅版本控制仓库")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["branch", "否", "要查询的分支。缺省时查当前分支"],
    ], widths=[3.0, 1.6, 10.4])
    note(doc, "同样依赖 GitHub 命令行工具。未安装时返回安装提示。"
              "无新增依赖：直接复用本机已装的命令行工具，未安装即明确告知，"
              "不做网络探测。")

    h2(doc, "（四十四）file_rollback 回滚文件改动")
    code(doc, "工具标识: file_rollback    归属: 文件操作")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["path", "是", "要回滚的文件路径"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "写文件类工具在改写前会自动留存原始副本。"
              "本工具用于把某个文件恢复到最近一次留存副本的内容。"
              "可回滚的前提是该文件此前被写过且留存副本仍在。")

    h2(doc, "（四十五）worktree 隔离工作区")
    code(doc, "工具标识: worktree_enter / worktree_exit / worktree_list    归属: 实验特性")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["name", "否", "工作区名称。进入与退出时指定，列出时忽略"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "工作树机制可在不干扰当前工作目录的前提下，"
              "为并行任务建立独立的检出目录。适用于同时处理多个需求。")

    # ---------------------------------------------------------------- 系统类
    h2(doc, "（四十六）config 读写配置")
    code(doc, "工具标识: config    权限类别: 无需审批    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["setting", "是", "配置项名称，可填 model 默认模型、shell 默认外壳、"
                          "language 回复语言、snapshot 快照开关、logLevel 日志级别、"
                          "autoupdate 自动更新、default_agent 默认智能体"],
        ["value", "否", "要写入的值。省略该参数则表示读取当前值"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "写入作用于全局配置。值支持字符串、布尔、数字三种类型。")

    h2(doc, "（四十七）lsp 语言服务")
    code(doc, "工具标识: lsp    权限类别: lsp    归属: 实验特性")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["operation", "是", "操作类型，可填 goToDefinition 跳转定义、findReferences 查找引用、"
                           "hover 查看类型信息、documentSymbol 文档符号、"
                           "workspaceSymbol 工作区符号、goToImplementation 查找实现、"
                           "prepareCallHierarchy 准备调用层次、"
                           "incomingCalls 谁调用了它、outgoingCalls 它调用了谁"],
        ["filePath", "除工作区符号外均必填", "文件路径"],
        ["line", "按操作", "行号。查找引用与调用层次类操作须填"],
        ["character", "按操作", "列号。查找引用与调用层次类操作须填"],
        ["query", "按操作", "查询词。工作区符号操作须填"],
    ], widths=[3.4, 2.4, 9.2])

    h2(doc, "（四十八）execute 代码模式")
    code(doc, "工具标识: execute    归属: 实验特性")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["background", "否", "是否在后台执行"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "代码模式将多个工具的调用编排为一段代码一次执行，"
              "可显著减少模型与系统之间的往返次数，适合批量处理。")

    h2(doc, "（四十九）tool_search 检索工具")
    code(doc, "工具标识: tool_search    权限类别: 无需审批    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["query", "是", "检索关键词"],
        ["max_results", "否", "返回结果数量，默认五个"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "当可用工具数量较多时，模型通过该工具按需检索，"
              "而非一次性载入全部工具说明，从而节省令牌。")

    h2(doc, "（五十）invalid 参数纠错")
    code(doc, "工具标识: invalid    归属: 始终提供")
    table(doc, rows=[["参数", "必填", "说明与取值"]] + [
        ["tool", "是", "调用出错的工具名称"],
        ["error", "是", "错误说明"],
    ], widths=[3.0, 1.6, 10.4])
    body(doc, "当模型以错误参数调用工具时，该工具返回如何修正参数的指引。")

    # ---------------------------------------------------------------- 汇总
    h2(doc, "（五十一）工具参数速查汇总")
    body(doc, "下表按字母序列出全部内置工具及其参数，便于快速查阅。")
    table(doc, [
        ["工具标识", "参数（括号内为是否必填）"],
        ["actor", "action（是）、subagent_type、description、prompt、actor_id、"
                  "timeout_ms、model、task_id、command、context"],
        ["apply_patch", "patchText（是）"],
        ["bash", "command（是）、timeout、workdir、allowDangerous、background"],
        ["bash_background", "action（是）、shell_id、maxBytes"],
        ["brief", "message（是）、level（是）"],
        ["browser", "url（是）、width、height、full_page、wait、timeout"],
        ["config", "setting（是）、value"],
        ["cron_delete", "id（是）"],
        ["cron_list", "无"],
        ["describe_image", "filepath（是）"],
        ["edit", "filePath（是）、oldString（是）、newString（是）、replaceAll"],
        ["execute", "background"],
        ["find_references", "symbol（是）、path（是）、include"],
        ["ci_status", "branch"],
        ["file_rollback", "path（是）"],
        ["gh_pr_create", "title（是）、body、base、head、draft"],
        ["git_branch", "action（是）、name、force"],
        ["git_commit", "message（是）、addAll、run_checks"],
        ["git_diff", "staged、path"],
        ["git_log", "count、path"],
        ["git_push", "remote、branch、set_upstream、force"],
        ["git_stash", "action（是）、message、force"],
        ["git_status", "path"],
        ["glob", "pattern（是）、path"],
        ["grep", "pattern（是）、path、include"],
        ["invalid", "tool（是）、error（是）"],
        ["lsp", "operation（是）、filePath、line、character、query"],
        ["mcp_authenticate", "server（是）"],
        ["notebook_edit", "notebook_path（是）、cell_id、new_source、cell_type、edit_mode（是）"],
        ["peer_read", "from、to、limit、mark_read"],
        ["peer_send", "to（是）、content（是）"],
        ["plan_enter", "无"],
        ["plan_exit", "无"],
        ["question", "questions（是）"],
        ["read", "filePath（是）、offset、limit"],
        ["schedule_cron", "cron（是）、prompt（是）、recurring、durable、continuity、scratchpad"],
        ["skill", "name（是）"],
        ["sleep", "duration_ms（是）"],
        ["swarm", "goal（是）、teammates（是）"],
        ["task", "subagent_type（是）、description（是）、prompt（是）、model"],
        ["task_get", "task_id（是）"],
        ["task_list", "无"],
        ["task_stop", "task_id（是）"],
        ["todowrite", "todos（是）"],
        ["tool_search", "query（是）、max_results"],
        ["webfetch", "url（是）、format、timeout"],
        ["websearch", "query（是）、numResults、type、livecrawl、contextMaxCharacters"],
        ["worktree_enter", "name"],
        ["worktree_exit", "name"],
        ["worktree_list", "name"],
        ["write", "content（是）、filePath（是）"],
    ], widths=[4.2, 10.8])
    body(doc, "上表共列四十八项，与前文逐一说明的条目一致，"
              "另有若干工具在特定条件下方提供，详见第七章第七节。")





