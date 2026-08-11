# gyc 内存与存储资源优化记录（2026-08-11）

计划项：排查内存与数据库问题 / API key 一致性 / 代码内存热点 / 存储冗余 / 实施优化 / 验证记录

## 一、调查发现

### 1. 数据库与 WAL
- `~/.local/share/gyccode/gyccode-local.db` 65MB，`integrity_check` OK，无损坏
- WAL 4.1MB 未 checkpoint（实例运行中；`database.ts` 启动时已做 PASSIVE checkpoint，正常关机即合并）
- **孤儿数据：无**。event/part/message 全部关联存在的 session
- 遗留空表（0 行）：`session_message`、`session_input`、`session_share`、`permission`、`workspace` 等（历史迁移遗留，不占空间）

### 2. 存储冗余（可安全精简项）
| 项目 | 大小 | 处置 |
|---|---|---|
| `gyccode-local.db.bak-sessionclean-20260811` | **571MB** | 今日 sessionclean 操作的备份残留；当前 DB 仅 65MB，备份为压缩前快照。删除可回收 571MB（**需用户确认，脚本不自动删**） |
| event 表 `message.part.updated.1` | 15,917 行 / 34MB | 每次流式 delta 持久化完整 part 快照；TUI 通过 `session/messages`（物化表）加载会话，event 仅用于实时增量同步。已完成会话的历史事件冗余，建议后续加保留策略（本次未实施，涉及同步架构风险） |
| tool-output/ | 33MB / 64 文件 | 均在 7 天保留期内，应用内 ToolOutputStore 每小时清理，正常 |
| `gyccode.log.1` | 10MB | 旧轮转日志；新轮转已按 10MB 上限工作 |
| part 表 | 6,209 行 / 11.6MB | 物化当前状态，正常 |

### 3. API key 配置一致性与安全
- `opencode` provider 走 `OPENCODE_API_KEY` 环境变量（已设置），auth.json 无该条目属正常
- **根因问题**：`provider.getSmallModel("opencode")` 自动选中 `gemini-3.6-flash`（family gemini-flash，由 zen API 自动发现），该模型返回 **Unauthorized**。导致记忆提取每 3 轮执行一次注定失败的 LLM 调用 + 刷 ERROR 日志（`AI_APICallError: Unauthorized`）
- `alibaba` 在 auth.json 有 key 但不在 `enabled_providers`（不一致，不影响运行）
- `github-copilot` token `expires: 0`、access==refresh（可疑/陈旧，但已通 provider 凭据修复）
- auth.json 明文存储，按代码以 0600 写入（Windows 下 ACL 生效）

### 4. 代码层内存热点（473MB）
- 3 个 `bun --smol dist/index.js` 实例并存（PID 2672/6544/6676，合计 WS ~1.5GB、Private ~3.7GB）——内存放大主因是**多实例**，非单实例泄漏
- TUI 侧此前已优化：流式 30ms 合并、targetFps=30、动画/音效默认关、轮询 200ms/1000ms、hermes 检索 TTL 缓存
- 数据库 `cache_size=-16000`（16MB）已调优
- 结论：代码层无新增泄漏；可优化点是记忆提取失败重试风暴（见下）

## 二、实施改动

### 1. 记忆提取失败冷却（代码）
`src/gyccode/session/prompt.ts`：
- 新增模块级 `MEMORY_EXTRACTION_COOLDOWN_MS`（10 分钟）与 `extractionCooldowns` Map
- 提取前检查冷却；失败时记录冷却时间并停止每 3 轮重复发起注定失败的调用（`Effect.catch` 替代 `Effect.ignore`，兼容 effect 4.0 改名）
- 效果：Unauthorized 类故障下不再每 3 轮重试刷日志；瞬态故障 10 分钟后可自愈重试

### 2. small_model 配置修复（根因）
`~/.config/gyccode/gyccode.json`（已备份 `.bak-20260811-perf`）：
- 新增 `"small_model": "opencode/deepseek-v4-flash-free"`，记忆提取改用已验证可用的模型，不再选中未授权的 gemini-3.6-flash

### 3. 存储维护脚本（新增）
`scripts/maintain-data.mjs`：
- 默认 dry-run：报告 DB/WAL/.bak/日志/tool-output 占用与可清理项
- `--checkpoint`：PASSIVE WAL checkpoint（已验证：109 帧合并，busy=0）
- `--clean`：仅删除超过 7 天保留期的 `.bak*` 与 `log/gyccode.log.N`（今天的 571MB 备份不动）

### 4. 运维动作
- 已对本地库执行一次 PASSIVE WAL checkpoint（109 帧合并回主库）

## 三、验证结果
- `node node_modules/typescript/bin/tsc --noEmit`：**我的改动区域 0 错误**（注意：并行会话提交 9799f73 引入 1 处 prompt.ts:1598 类型错误，属其进行中工作，非本次改动）
- `bun test --preload ./scripts/bun-solid-preload.ts`：**362 pass / 0 fail**
- `bun build.mjs`：**build done, exit 0**
- `scripts/maintain-data.mjs` dry-run 与 `--checkpoint`：工作正常

## 四、遗留待办（需用户决策）
1. **删除 571MB `.bak-sessionclean-20260811`**：确认当前 DB 正常后执行 `Remove-Item -LiteralPath "$env:USERPROFILE\.local\share\gyccode\gyccode-local.db.bak-sessionclean-20260811"`，可回收 571MB
2. **event 表保留策略**：建议对已完成会话的 `message.part.updated` 事件加保留期（如 30 天），可回收 ~34MB 及未来增量；涉及同步架构，需专项设计
3. **多实例收敛**：3 个 bun 实例（PID 2672/6544/6676）为内存主因，确认无活动会话后可关闭陈旧实例（6676 自 08-09 运行）
4. **并行会话提示**：会话期间检测到另一 gyc 会话在同一仓库提交（d8c8444/9799f73，DeepSeek 缓存优化），其 cache-probe.mjs 仍在工作区未提交，注意协调

## 五、后续执行（用户确认后）
### 1. 删除 571MB 备份残留（已完成）
- 确认当前 DB 正常（integrity ok）后，删除 `gyccode-local.db.bak-sessionclean-20260811`（544.6MB）
- 数据目录从 ~650MB 降至 ~119MB（含工具输出等）

### 2. event 表保留策略（已完成）
新增 `maintain-data.mjs --prune-events[=H]`（默认 24h）：
- 仅针对 `message.part.updated.*` 流式中间快照；会话最近事件超过 H 小时才裁剪
- **始终保留每 part 最新一条事件**（最终状态保全；TUI 以物化 part/message 表为准，sync/replay 不受影响）
- dry-run 默认只报告；`--clean` 才真正删除
- 实测：24h 保留期删除 1,885 行 / 8.8MB；完整性 ok；无孤儿；活跃会话未触碰
- 建议定期执行：`bun scripts/maintain-data.mjs --prune-events --clean --checkpoint`

### 3. 遗留建议（未执行）
- 更短保留期可回收更多（如 12h 会把 8.8h 前的 9MB 会话也裁剪）；由用户权衡
- 多实例收敛（3 个 bun 实例）为内存主因，确认无活动会话后可关闭陈旧实例
