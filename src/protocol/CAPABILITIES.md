# gyc 协议 v2 能力矩阵

协议自有基线审计（2026-08-13 实测）。声明能力 = `src/protocol/README.md` 基线 + v2 group 定义；实现状态以代码与端到端验证为准。

## 能力矩阵

| 能力 | 协议定义 | 实现 | 验证 |
|------|----------|------|------|
| 会话持久化 | `groups/session.ts`（create/list/get/active/switchAgent/switchModel/delete） | `src/core/session/store.ts`（SQLite，`src/core/database`） | ✅ 端到端：serve 重启后历史 session 完整恢复（5/5） |
| 会话压缩（compaction） | 无显式 group（客户端侧能力） | `src/gyccode/session/compaction.ts`（395+ 行）+ `src/core/config/compaction.ts` | 承继层自带，配置项 `compaction` 生效 |
| 工具解析 | `groups/command.ts`、`groups/reference.ts`、`plugin/` 接口 | `src/codemode/tool-schema.ts` + 各 handler | 承继层自带，随命令/参考执行路径生效 |
| 事件流 | `groups/event.ts` | `src/server/handlers/event.ts` | 就位 |
| 18 API group 全覆盖 | `src/protocol/groups/*.ts`（agent/command/credential/event/fs/health/integration/location/message/model/permission/project-copy/provider/pty/question/reference/session/skill） | `src/server/handlers/*.ts` 一一对应 | ✅ 目录比对 18/18 无缺 |
| gyc 专属请求头 | `x-gyccode-directory` / `x-gyccode-workspace` | `src/gyccode/server/routes/instance/httpapi/middleware/workspace-routing.ts`（注入）+ `proxy-util.ts`（清理） | ✅ serve 实测按目录路由 |
| 统一客户端 | `GyccodeClient`（v1/v2 统一入口，`api.ts`） | `src/protocol/api.ts` + `src/gyccode/acp/*` | 就位 |
| 命名空间 | `gyccode-instance`（v1）/ `server`（v2） | `src/gyccode/server/routes/` | 就位 |
| 错误拦截 | `v2/error-interceptor.ts` | 就位 | 就位 |

## 结论

- 协议 v2 三项候选能力（session 持久化 / compaction / 工具解析）**均已实现**，其中会话持久化经重启恢复实测验证
- 18 个 API group 定义与服务端 handler 一一对应，无声明缺口
- gyc 专属扩展（请求头 / 客户端 / 命名空间）全部落地，协议自有基线成立
- 后续演进（v2 新能力）按 `README.md` 演进策略：只落 v2、不跟随上游、生态兼容 .opencode skill
