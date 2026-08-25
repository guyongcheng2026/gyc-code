# gyc TUI 消息网关能力增强计划（微信 iLink 通道）

- 日期：2026-08-25
- 状态：执行中
- 来源：hermes agent v0.20.5 微信网关排障与源码研读（`gateway/platforms/weixin.py`）

## 背景与实证结论

本次为谷总排查 hermes 微信网关「发送限流」问题，直连 iLink API 探测后确认：

1. 服务端原始返回 `ret=-2, errmsg="prepare failed"`，并非真实限流，而是回复凭证 `context_token` 过期（8 月 14 日后未刷新）。
2. `context_token` 仅能由用户在微信中主动给 bot 发消息触发服务端下发，无法程序侧伪造；收到消息后适配器自动持久化新凭证，随后外发即恢复。
3. hermes 将 "prepare failed" 归类为限流并开熔断，掩盖了根因——错误分类必须区分「限流／凭证失效／会话过期」。

iLink 协议要点（base：`https://ilinkai.weixin.qq.com`）：

| 端点 | 用途 |
|------|------|
| `ilink/bot/getupdates` | 长轮询收信（35s），游标 `get_updates_buf` 断点续传 |
| `ilink/bot/sendmessage` | 发文本（15s 超时） |
| `ilink/bot/getconfig` | 取 typing_ticket 等 |
| `ilink/bot/get_bot_qrcode` / `get_qrcode_status` | 扫码配对登录 |

请求头：`Authorization: Bearer <token>`、`AuthorizationType: ilink_bot_token`、`X-WECHAT-UIN`（随机）、`iLink-App-Id: bot`、`iLink-App-ClientVersion: 131328`（2<<16|2<<8|0）。消息体：`{msg:{to_user_id, client_id, message_type:2, message_state:2, item_list:[{type:1,text_item:{text}}], context_token?}, base_info:{channel_version:"2.2.0"}}`。错误码：`-2` 限流或凭证失效（"prepare failed"/"unknown error"）、`-14` 会话过期。

## 目标

gyc-code 具备自有消息出口能力：`gyc send --to weixin "文本"` 可向微信 clawbot home 频道投递文本，供脚本、Cron 与 TUI 内部复用；错误提示可指导用户自助恢复凭证。

## P0 — 消息出口能力（本轮交付）

### 1. GatewayAdapter 统一接口
- 新文件：`src/gyccode/gateway/adapter.ts`
- 定义平台无关接口：`connect / poll / sendText / disconnect`，及 `GatewayMessage`、`GatewayTarget` 类型
- 多平台扩展点：weixin 为首个实现，后续可挂 telegram 等

### 2. iLink 微信协议 MVP
- 新文件：`src/gyccode/gateway/weixin.ts`
- 能力：sendmessage 文本发送；context_token 读盘/写盘持久化（`~/.gyc/data/weixin/context-tokens.json`）；长轮询 poll（供后续守护进程复用）
- 配置（环境变量或 `~/.gyc/.env`）：`GYC_WEIXIN_TOKEN`、`GYC_WEIXIN_ACCOUNT_ID`、`GYC_WEIXIN_BASE_URL`（默认官方地址）、`GYC_WEIXIN_HOME_CHANNEL`

### 3. gyc send CLI 命令
- 新文件：`src/gyccode/cli/cmd/send.ts`，注册于 `src/gyccode/index.ts` COMMANDS
- 用法：`gyc send --to weixin "文本"`（省略 `--to` 时发 home 频道）；`--json` 输出机器可读结果
- 不依赖项目实例（`instance: false`），启动开销最小化

## P1 — 可靠性补强（并入本轮实现）

### 4. 凭证生命周期
- 凭证持久化 + 时间戳记录；发送遇 `ret=-2 "prepare failed"` 时给出明确指引：「请在微信里给机器人发一条消息以刷新回复凭证，然后重试」
- 收到用户消息时自动捕获并持久化新凭证（poll 路径）

### 5. 错误分类器
- 新文件：`src/gyccode/gateway/errors.ts`
- 分类：限流（rate_limited）/ 凭证失效（credential_stale）/ 会话过期（session_expired）/ 网络（network）/ 未知（unknown）
- 每类附中文恢复建议；杜绝误导性报警

### 6. 心跳与陈旧进程检测
- 发送成功后更新心跳文件 `~/.gyc/data/weixin/heartbeat.json`（pid + 时间戳）
- 启动时检测心跳 pid 是否为其他存活进程，提示并发共用同一 bot token 的风险（对应 hermes 孤儿网关双消费教训）

## P2 — 体验增强（预留接口，后续迭代）

7. 消息分段：超长文本按上限切分（本轮内置基础版）；typing 指示器、AES 加密媒体通道留待下轮
8. TUI 任务完成事件推送微信：复用 adapter 的 `sendText`，在 TUI 完成钩子处接入（本轮仅保证函数可复用，不改动 TUI 渲染层）

## 验收标准

1. `bun tsc`（或项目既有 typecheck）零新增错误
2. 以本机真实凭证执行 `gyc send --to weixin "..."` 返回 success 且微信实际收到
3. 人为构造凭证失效场景时，输出「凭证失效」分类与恢复指引，而非「限流」

## 铁律遵循

- 品牌合规：全部命名使用 gyc 前缀，不引入任何第三方 AI 产品品牌字眼
- 数据安全：token 仅经环境变量注入，日志与输出不回显密钥
- 极简主义：仅交付上述范围，不做推测性扩展
