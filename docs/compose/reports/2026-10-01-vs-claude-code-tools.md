# 工具能力（执行链路）对标：指标 6~11

> **采集时间**: 2026-10-01　**基准**: Claude Code v2.1.285
> **方法**: 全部结论基于 gyc-code 源码实证，附 `文件:行号`
> **定位**: 本章为「与 Claude Code 三指标对标」的第二组指标，接在指标①模型能力、③每任务真实成本之后

---

## 〇、总览

| 指标 | CC 表现 | gyc 判定 | 一句话差距 |
|------|---------|----------|-----------|
| **6. 文件操作** | 强：精确 patch，少破坏 | 🟡 **中上** | 有九级 replacer 链和 apply_patch，但**无文件级备份**、read **无自动 compaction** |
| **7. Shell 执行** | 强：沙箱内执行 | 🟠 **偏弱** | **无沙箱**、**无后台任务**、危险命令**只提示不拦截** |
| **8. Git 集成** | 强：自动 commit、diff 比较 | 🔴 **弱** | **没有 git 工具**、**无自动 commit**、diff 只服务 snapshot 不给模型 |
| **9. 搜索能力** | 强：集成 ripgrep | 🟡 **中上** | ripgrep 已接，但**无语义检索**、**无相关度排序**、未显式排除 node_modules |
| **10. MCP 扩展** | 强：市场成熟 | 🟢 **强** | 5 种传输 + OAuth + resources 齐备，**仅缺市场目录与断连重连** |
| **11. 多模态** | 中：支持但非强项 | 🟠 **偏弱** | 通道通但**只能被动收图**、**无 OCR/截图/浏览器**、图片 base64 易撑爆上下文 |

**整体判定**：MCP（10）已达标甚至局部超越；文件操作（6）与搜索（9）接近达标；**Git 集成（8）是最大短板**——模型完全无法直接操作 git，只能靠 bash 敲命令；Shell（7）与多模态（11）缺沙箱与主动获取能力。

---

## 一、指标 6 · 文件操作（读/写/改的准确度）

### 1.1 工具全景

| 工具 | 位置 | 说明 |
|------|------|------|
| `read` | `src/gyccode/tool/read.ts:71` | 默认 2000 行、单行 2000 字符、单次 50KB（`read.ts:17-20`） |
| `write` | `src/gyccode/tool/write.ts:30` | 5MB 上限（`write.ts:56`） |
| `edit` | `src/gyccode/tool/edit.ts:76` | 九级 replacer 链（`edit.ts:833-843`） |
| `patch` | `src/gyccode/tool/apply_patch.ts:26` | `*** Begin Patch` 信封 + Add/Update/Delete，支持 move（`apply_patch.ts:168`） |
| `notebook_edit` | `src/gyccode/tool/notebook.ts:93` | replace/insert/delete 三模式（`notebook.ts:35,51-53`） |

路由：`registry.ts:390-393` —— **GPT 系走 apply_patch，其余走 edit/write，二者互斥**。这个设计比 CC 的单一 FileEdit 更精细。

### 1.2 准确度机制（优于 CC 的地方）

`edit` 采用**先精确、再逐级放宽**的九级 replacer 链（`edit.ts:833-843`）：

```
Simple → LineTrimmed → BlockAnchor → WhitespaceNormalized
→ IndentationFlexible → EscapeNormalized → TrimmedBoundary
→ ContextAware → MultiOccurrence
```

- 首级 `SimpleReplacer` 即精确子串（`edit.ts:322-324`）
- 相似度阈值 `0.65`（`edit.ts:266-267`）；`ContextAwareReplacer` 要求「匹配率≥0.65 且至少一行编辑距离占比≤0.1」（`edit.ts:774`、`hasCloseLine` `edit.ts:280-291`）
- 多重匹配**不猜**：跳到下一候选（`edit.ts:856-857`），全都不唯一则报错（`edit.ts:867`）
- 越界替换拦截 `isDisproportionateMatch`（`edit.ts:870-876`）

这套「逐级放宽 + 多义即报错」的设计，正是 CC 所强调的「精确 patch，少破坏」。

### 1.3 缺口

| 缺口 | 证据 | 影响 |
|------|------|------|
| **无文件级写前备份** | `edit.ts:171-187`、`write.ts:73` 只生成 diff 供审批，不备份 | 改错了只能靠会话级 snapshot 回滚，粒度粗 |
| **read 无自动 compaction** | `read.ts:398-401` 仅提示 `Use offset=… to continue` | 长文件靠模型自己翻页，易漏读 |
| **read 缓存返回 STUB** | `read.ts:323-346` 命中未变更缓存返回 `FILE_UNCHANGED_STUB` | 模型可能据此认为已掌握内容而跳过细读 |
| **大文件无增量方案** | `edit.ts:149`、`write.ts:56` 5MB 上限 | 超过只能 write 全量覆盖 |

回滚依赖会话级 Git 影子仓库：`snapshot/index.ts:36-45`（track/patch/revert/restore），由 `processor.ts:118,466,477,536` 驱动。

### 1.4 风险点

- `ContextAwareReplacer` 只对**首个**候选 `break`（`edit.ts:776`），相似函数体仍有误替换窗口
- `Effect.orDie`（`edit.ts:218`）把可预期错误升级为 defect，模型拿不到重试机会

---

## 二、指标 7 · Shell 执行

### 2.1 现状

- 实现 `shell.ts:493`；跨平台显式分支 win32-powershell / unix（`shell.ts:476-491`），路径解析有 cygpath（`shell.ts:505-528`）
- 超时默认 2 分钟（`shell.ts:503`），0 表示不超时（`shell.ts:724-730`），超时强杀并等退出（`shell.ts:738-748`）
- 截断：内存保留 `maxBytes*2` 滚动窗口（`shell.ts:611,674-679`），超限整段落盘（`shell.ts:688-706`），最后 tail 截断（`shell.ts:762-774`）
- 权限：询问 `ask()`（`shell.ts:445-473`）+ 黑名单 `classifyCommand`（`shell/security.ts:52-74`）

### 2.2 缺口

| 缺口 | 证据 | 影响 |
|------|------|------|
| **无沙箱** | 无容器/命名空间/权限降级代码 | CC 的沙箱内执行是核心安全边界，gyc 完全依赖用户点确认 |
| **无后台任务** | 参数仅 command/timeout/workdir（`shell/prompt.ts:15-23`） | 长跑命令（dev server、测试套件）无法后台化；unix 下虽 detached（`shell.ts:490`）但取不回句柄 |
| **危险命令只提示不拦截** | `security.ts:65-68` blocked 仅 4 类；`dangerous` 级（eval、curl\|bash、sudo、dd）只标注，`shell.ts:824-827` 只拦 blocked | `curl xxx \| bash` 会被放行 |
| **无 bash 并发限制** | 仅 code-mode 全局 8 并发（`stdlib/promise.ts:6`） | 多个并发 bash 可能互相踩踏 |

### 2.3 风险点

**大日志信息丢失**：`shell.ts:611,674-679` 内存窗口只保留最后 `2×maxBytes`，更早的输出**只存在于落盘文件**——模型不主动去读就永久丢失。这是 CC 用后台任务 + 完整输出从根本上回避的。

---

## 三、指标 8 · Git 集成 ⚠️ 最大短板

### 3.1 现状

- **没有 git 工具**：`tool/registry.ts:1-41` 与 `core/tool/builtins.ts:5-16` 的工具清单里都没有 git。模型只能靠 `shell`/`bash` 自己敲 git 命令
- 底层 `Git.Service` 存在（`src/gyccode/git/index.ts:75-91`，含 branch/status/diff/patch/applyPatch），但消费者是 worktree、snapshot、project、serve（`worktree/index.ts:130-142`、`core/snapshot.ts:91`、`gyccode/project/vcs.ts:298-301`），**不暴露给模型**
- **无自动 commit**：TUI 明确提示「请在终端使用 git commit 提交更改」（`tui/component/dialog-commit.tsx:185`）
- snapshot 影子仓库：`snapshot/index.ts:71` 独立 gitdir 置于 `Global.Path.data/snapshot/<projectID>/<hash>`；`337-348` init + 性能 config；`202-227` 复用原仓库对象（objects/info/alternates）；`354-362` 用 `write-tree` 存快照（**不建 commit 对象**）
- **diff 只服务 snapshot**：`snapshot/index.ts:552-570`（`diff --cached <hash>`）、`572-760`（`diffFull` 两点比较，`cat-file --batch` 批量 + 降级）。**未暴露为模型工具，无「分支间比较」工具**
- worktree 支持完整：`tool/worktree.ts:23/60/83`（enter/exit/list），`worktree/index.ts:175-186` 建 `gyccode/<name>` 分支、`209-210` `git worktree add --no-checkout -b`、`445-450` 退出时 `branch -D`
- **commit message 无 AI 侧质控**：`.githooks/pre-commit:6-25` 才是质量门禁（check-mojibake / brand-guard / check-workspace-junk / check-bug-patterns / tsc），由 `scripts/install-hooks.mjs:9-13` 拷进 `.git/hooks`，**只能人工 `git commit` 触发**

### 3.2 差距分析

CC 的「自动 commit、diff 比较」在 gyc 全部缺位：

| CC 能力 | gyc 现状 |
|---------|---------|
| 自动 commit | 无。TUI 明确让用户自己去终端提交 |
| 模型可调 git | 无。只能 bash 敲命令，模型得自己拼命令、处理引号转义、解析输出 |
| diff 比较 | 有实现（snapshot/diffFull）但**不给模型用** |
| 提交质量门禁 | 强（5 道钩子），但**AI 无法触发**，也不参与 AI 的提交决策 |

### 3.3 风险点

模型通过 bash 敲 git 意味着：命令拼接易错、输出需自行解析、**无法利用已有的 snapshot/diffFull 能力**。这是 6 个维度里差距最大、最该补的一项。

---

## 四、指标 9 · 搜索能力

### 4.1 现状

- 工具：`gyccode/tool/grep.ts:22`、`gyccode/tool/glob.ts:17`（v1）；`core/tool/grep.ts:17`、`core/tool/glob.ts`（v2）
- **走 ripgrep**：`core/ripgrep.ts:219-232`（`--no-config --json --hidden --no-messages --glob=!**/.git/**`）；`156-169`/`188-201`（glob/find）
- **第二条路径**：`core/filesystem/search.ts:130-180` 的 `fffLayer`（`#fff`，trigram/`aiMode`，`timeBudgetMs: 1500`），由 `243` 依 `GYCCODE_DISABLE_FFF` / 可用性切换；ripgrep 分支的 `find` 用 fuzzysort 评分（`117`）
- `session_search_fts` **搜会话不搜代码**：`core/session-search-index.ts:6-12`、`35-40`（`part_fts` external-content FTS5，tokenize=trigram）、`66-77` 触发器；查询 `core/session-search.ts:78-99`，短于 3 字回退 LIKE（`52-73`），排序 `ORDER BY m.time_created DESC`（**时间序，非相关度**）
- 上限：grep `MATCH_LIMIT = 100`（`gyccode/tool/grep.ts:10`，取 101 条判截断 `74-81`）；glob `limit = 100`（`glob.ts:52`）；单行截 2000 字符、单 JSON 记录 64KB、子匹配 100（`core/ripgrep.ts:19-21`、`268`）

### 4.2 缺口

| 缺口 | 证据 | 影响 |
|------|------|------|
| **无语义/向量检索** | 全仓无自有 embedding/向量库（仅命中 Copilot/OpenAI 协议透传字段） | CC 语义搜索能理解「登录逻辑在哪」，gyc 只能字面量匹配同义词就漏 |
| **无相关度排序** | grep/glob 沿用 ripgrep 文件顺序 | 结果靠前的未必是最相关的，模型要多读几轮 |
| **未显式排除 node_modules** | `core/ripgrep.ts:219-232` 只排 `.git`，依赖 .gitignore 兜底 | .gitignore 缺失或被覆盖时会扫全量依赖，极慢 |
| 会话搜索按时间序 | `core/session-search.ts:52-73` | 「上次我们怎么解决 X 的」这类问题，命中的是最近而非最相关 |

### 4.3 相对优势

`fffLayer`（trigram 模糊匹配 + 1.5s 时间预算）是 CC 没有的差异化能力——对拼写差异、代码标识符变体更鲁棒。

---

## 五、指标 10 · MCP 扩展 🟢 已达标

### 5.1 现状（本次六项中完成度最高）

| 项 | 现状 | 证据 |
|----|------|------|
| 客户端 | `src/gyccode/mcp/index.ts`（41KB，唯一实现） | `index.ts:76-82` `createClient` |
| **传输方式** | **5 种**：`stdio`/`streamable-http`/`sse`/`ws`/`ide` | `index.ts:131`；`resolveTransport` `140-154`；SSE 兜底 `315-321` |
| 工具发现 | 连接时 `listTools` 缓存，`tools/list_changed` 后重读 | `index.ts:435,518-525`；`catalog.ts:154-171`（分页 `26-45`、outputSchema 容错 `22-24`） |
| 工具合并 | `sanitize(clientName)_sanitize(toolName)` 生成 key | `index.ts:728-750`；`catalog.ts:126-128` |
| **resources** | 支持 `resources()`/`resourceTemplates()`/`readResource` | `index.ts:782-800,843-848`；`catalog.ts:138-152` |
| prompts | 支持 `listPrompts`/`getPrompt` | `index.ts:778-780,830-842`；`catalog.ts:130-136` |
| `ListMcpResources`/`ReadMcpResource` | **已完整实现**，按服务器能力条件注册 | `session/tools.ts:150-152`（能力探测）、`154-`、`342-364`、`514-519` |
| **OAuth** | 支持，含 RFC7591 动态注册 + 回调服务器 | `mcp/oauth-provider.ts`、`oauth-callback.ts`、`auth.ts`；`index.ts:280-296,336-360` |
| 超时 | 三级：全局 30s → config.timeout → experimental.mcp_timeout | `index.ts:39,723-725,734`；`config.ts:376` |
| 错误处理 | 5 态状态机；StreamableHTTP 失败降级 SSE | `index.ts:101-108,327-365` |

**5 种传输 + OAuth 动态注册 + resources 模板**，这三项已达到甚至超过 CC。

### 5.2 缺口

| 缺口 | 证据 | 影响 |
|------|------|------|
| **无 MCP 市场/服务器目录** | `marketplace/index.json` 仅 2 个插件示例（gyc-hello、gyc-workspace-stats） | CC 有成熟市场，用户能一键装。gyc 只能手写配置 |
| **无断连重连/退避** | `index.ts:499-506` 断连仅置 `failed` | 长会话中途 MCP 能力消失且用户无感 |
| 命名冲突仅靠前缀 | `catalog.ts:128` | `a-b` 与 `a_b` 经 `sanitize` 后同名会**互相覆盖**，无检测无告警 |
| prompts 无变更监听 | `index.ts:778-780`（resources/tools 有，prompts 无） | 服务器更新 prompt 后客户端不感知 |
| sampling/elicitation 被注释 | `index.ts:42-49` | 主动采样与用户输入请求不可用 |

### 5.3 风险点

**MCP 断连无自愈 + 命名碰撞静默覆盖**——两者叠加时，模型可能调用到一个「看起来正常、实则连错服务器」的工具，且全程无提示。

---

## 六、指标 11 · 多模态

### 6.1 现状

- 附件模型 `FileAttachment{uri,mime,name,description,source}` → `ContentPart{type:"media"}`（`schema/prompt.ts:13-20`；`core/session/runner/to-llm-message.ts:13-19`）
- **协议侧齐全**：OpenAI Responses `input_image`（`llm/protocols/openai-responses.ts:318`）、Chat `image_url`（`openai-chat.ts:62-63,211`）、Gemini `inlineData`（`gemini.ts:188,281`）、Bedrock image+document（`bedrock-media.ts:74,85`）
- 压缩：photon WASM 自动缩放，限 2000×2000 / 5MB base64（`gyccode/image/image.ts:5,13-17,131-151`；`core/v1/config/attachment.ts:6-24`）
- 入口三处：`read` 工具读图/PDF（`tool/read.ts:12,23,351-375`）、`webfetch` 返回图片（`tool/webfetch.ts:223-236`）、TUI 粘贴/拖拽（`tui/clipboard.ts:46-70`；`tui/component/prompt/local-attachment.ts:28-31`）
- 存储：**base64 data URL 内联进消息**（`read.ts:375`；`webfetch.ts:236`），无外部对象存储
- 工具结果内图片：`session/tools.ts:126-134` 注入 attachments；`message-v2.ts:402-411` 按模型能力过滤，`589-604` 媒体单独作 user message
- codemode（`src/codemode/codemode.ts:114,152` + `registry.ts:379-381`）只是「工具目录的编程接口 + 渐进披露」，**与视觉/UI 理解无关**

### 6.2 缺口

| 缺口 | 证据 | 影响 |
|------|------|------|
| **无截图/浏览器/无头浏览器工具** | `registry.ts:258-293` 全量工具清单中无 screenshot/browser/playwright | 「打开网页看效果」「看报错截图」类任务**无法闭环**，只能靠用户手动粘贴 |
| **无 OCR / 图像描述** | 全仓无相关工具 | 视觉完全依赖模型自身多模态，弱模型完全读不懂图 |
| **无视频/音频处理** | `util/media.ts:3-24` 仅 png/jpeg/gif/bmp/webp/pdf 嗅探 | — |
| **无 PDF 解析** | 仅原样 base64 透传 | 多页技术文档只能逐页当图看，成本与准确率双输 |
| 附件 schema 无 `url` 字段 | `schema/prompt.ts:13-20` 仅 uri/mime | 无法传远程图片，只能先下载 |
| IDE transport 仅显式选择 | `transport-ide.ts` | 无自动发现 IDE 扩展 |

> 注：`computer_use` 仅是 copilot 响应解析（`openai-responses-language-model.ts:656`），**不是**一个可调用的工具。

### 6.3 风险点

- **长会话图片膨胀**：base64 内联 + 无清理策略，compaction 依赖 `stripMedia`（`message-v2.ts:589`），大图会话易触发 provider 体积上限/费用暴涨
- **工具结果图片被静默丢弃**：`message-v2.ts:406-411` 对不支持 tool-result 媒体的模型直接过滤，图片在上下文中**无声消失**，模型可能误以为「没返回图」

---

## 七、达到并超越 Claude Code 的改进计划

> 原则：**CC 已有的必须补齐（及格线）；CC 没有的才叫超越。** 不做为了「看起来全」而堆功能的事。

### P0 · 阻断级（不做就无法在 Git 密集场景与 CC 平权）

| # | 事项 | 对应缺口 | 验收标准 |
|---|------|---------|---------|
| **P0-1** | **新增 git 工具族**（`git_status` / `git_diff` / `git_log` / `git_commit` / `git_branch` / `git_stash`） | §3.1 无 git 工具 | 模型不经过 bash 拼命令即可完成 status→diff→commit 全链路；`git diff` 内部复用 `snapshot/diffFull`（`snapshot/index.ts:572-760`）已有的批量比较能力，不重复实现 |
| **P0-2** | **复用 snapshot 影子仓库做每任务自动 commit** | §3.1 无自动 commit | 每轮任务结束自动生成一个可回滚的 commit（`snapshot/index.ts:354-362` 现在只 `write-tree` 不建 commit 对象，补上）；用户可一键回退整轮 |
| **P0-3** | **危险命令从「提示」升为「拦截」** | §2.2 `dangerous` 只标注 | `curl\|bash`、`eval`、`sudo`、`dd` 默认拒绝执行，需显式确认；补齐 `shell/security.ts:65-68` 的黑名单类别 |
| **P0-4** | **bash 后台任务 + 句柄回收** | §2.2 无后台任务 | 长跑命令可后台化并取回输出/退出码；补齐大日志「只在落盘文件、模型读不到」的信息丢失（`shell.ts:611,674-679`） |

### P1 · 竞争力级（决定能否在真实项目里持续跟进）

| # | 事项 | 对应缺口 | 验收标准 |
|---|------|---------|---------|
| **P1-1** | **语义检索** | §4.2 无向量检索 | 「登录逻辑在哪」这类同义表述能召回；复用已有 `fffLayer`（`core/filesystem/search.ts:130-180`）的 trigram 基础，加轻量嵌入做混合召回；**保持纯本地、可离线**（gyc 是本地 CLI，调用云端嵌入是倒退） |
| **P1-2** | **搜索结果相关度排序** | §4.2 无排序 | grep/glob 按相关度（匹配密度 + 符号定义优先）排序，不再沿用文件顺序；会话搜索从时间序改为相关度（`core/session-search.ts:52-73`） |
| **P1-3** | **read 自动 compaction** | §1.3 无自动 compaction | 超限文件自动折叠为结构摘要（保留符号签名 + 首尾），模型不必手动翻页；`read.ts:398-401` 改为默认折叠而非仅提示 |
| **P1-4** | **文件级写前备份** | §1.3 无备份 | edit/write 前存原文件快照，可单文件回滚（当前只有会话级 `snapshot/index.ts:36-45`，粒度过粗） |
| **P1-5** | **MCP 断连自动重连** | §5.2 无重连 | 指数退避重连；`index.ts:499-506` 的 `failed` 态增加重试路径；重连过程对用户可见 |
| **P1-6** | **MCP 工具命名冲突检测** | §5.2 静默覆盖 | `sanitize` 后同名工具（`catalog.ts:126-128`）启动时告警而非静默覆盖 |
| **P1-7** | **OCR / 图片描述工具** | §6.2 无 | 独立 `describe_image` / `ocr` 工具，**不依赖模型原生视觉**——让弱模型也能读图，且省 token（全图 base64 → 文本描述） |
| **P1-8** | **PDF 解析** | §6.2 无解析 | 抽文字层 + 分页，替代「逐页当图」；成本与准确率双赢 |

### P2 · 超越级（CC 也没有，属于 gyc 的差异化）

| # | 事项 | 对应缺口 | 为什么是「超越」 |
|---|------|---------|----------------|
| **P2-1** | **MCP 服务器目录/市场** | §5.2 无市场 | CC 的市场成熟，但 gyc 可以做**可审计的**市场：每个服务器标注所需权限、传输方式、数据流向。CC 市场做不到细粒度权限预览 |
| **P2-2** | **无头浏览器 + 截图工具** | §6.2 无 | CC 也缺（截至 v2.1.285 无内置 browser 工具）。gyc 有 `webfetch`（`tool/webfetch.ts:223-236`）已能取图片，补齐「打开页面→渲染→截图→视觉分析」闭环，可让 AI **自检 UI**——这是 CC 当前做不到的 |
| **P2-3** | **符号级代码搜索** | §4.2 | gyc 已有 `lsp` 工具（符号跳转）。把 LSP 符号索引与 ripgrep 打通，支持「找出所有调用了 X 的地方」这类跨文件语义查询——比纯文本匹配准，CC 默认无此能力 |
| **P2-4** | **附件外部存储 + 引用** | §6.3 base64 膨胀 | 图片存对象/本地文件，消息里只留引用，compaction 时可选择性保底。CC 也是 base64 内联，gyc 可用本地存储天然占优（无外传成本） |
| **P2-5** | **工具结果媒体的可见降级** | §6.3 静默丢弃 | 模型不支持 tool-result 媒体时，**显式告知模型「图片已丢弃，原因是 X」**，而非静默过滤。CC 也是静默丢弃——修掉即体验优势 |
| **P2-6** | **ruff/tsc 结果结构化注入** | §1.3 `Effect.orDie` 升级为 defect（`edit.ts:218`、`shell.ts:753`） | 把编译/测试失败作为**结构化诊断回灌模型**（可重试），而不是进程级 defect。CC 也犯这个错，属可超越点 |

---

## 八、优先执行建议

按「差距大小 × 实现成本 × 风险」排序，建议顺序：

```
第一批（对等化，2 周内）
  P0-1 git 工具族 → P0-3 危险命令拦截 → P0-2 自动 commit
  ↑ 这三项做完，Git 密集场景才谈得上与 CC 平权

第二批（真实可用，1 个月内）
  P1-3 read compaction → P1-4 文件备份 → P1-1 语义检索
  P1-5 MCP 重连 → P1-6 冲突检测 → P0-4 bash 后台任务

第三批（差异化）
  P2-2 浏览器+截图（最大超越点）→ P1-7 OCR → P2-1 MCP 市场
  P2-3 符号级搜索 → P1-8 PDF → P2-4/5/6
```

**一句话结论**：MCP（10）已达 CC 水平甚至局部超越；文件操作（6）机制设计优于 CC；搜索（9）差在语义层。**真正的短板是 Git 集成（8）——CC 的一项核心能力在 gyc 完全没有对应物**，补齐 P0 三项即可在执行链路维度与 CC 站在同一档；再补 P2-2（浏览器+截图）则是 CC 当前没有的，可形成反超。

---

## 附：本次核查的未核实项

诚实标注，以下三条本轮未逐行确认，不作为结论依据：

1. `fff` 原生 crate 索引的排除规则（是否已排除 node_modules）——需查 `#fff` 绑定
2. worktree 是否在会话启动时**自动**创建（隔离工作区默认开启与否）
3. `gyccode.json` 与 `~/.config/gyccode/` 的完整配置解析顺序（`src/core/config.ts` 加载逻辑）
