# @gyccode/protocol — gyc 自有协议基线

> 本包定义 gyc-code 的 Agent 协议（API 面、类型、插件接口），是客户端与服务端、TUI 与 web、宿主与插件之间的**自有协议基线**。

## 定位

- 源自 opencode SDK（MIT License，版权归 opencode 项目保留，见根 LICENSE），已完成**本地化改造**：去除 `@opencode-ai/sdk` / `@opencode-ai/plugin` 外部依赖，运行时落地到本包内。
- 在本地化基础上**独立演进**：新增 gyc 专属请求头、专属 API group，不再跟随上游协议变动。

## 结构

| 路径 | 内容 |
|------|------|
| `v1/` | 历史协议（gen 类型 + 客户端入口），服务 TUI/CLI 会话 |
| `v2/` | 现行协议（gen 类型 + 客户端 + 错误拦截），服务 web/服务端 API；新增能力优先落 v2 |
| `groups/` | API group 定义（18 个：agent/command/credential/event/fs/health/integration/location/message/model/permission/project-copy/provider/pty/question/reference/session/skill） |
| `plugin/` | 插件接口（v1 宿主插件 + v2 Effect 集成），供第三方插件开发 |
| `middleware/` | 请求中间件（目录/工作区头注入等） |
| `api.ts` / `errors.ts` | 客户端 API 面与错误类型 |

## gyc 专属扩展

- 请求头：`x-gyccode-directory`、`x-gyccode-workspace`（会话上下文传递，middleware 注入与清理）
- 客户端：`GyccodeClient`（v1/v2 统一入口，见 `api.ts`）
- 命名空间：`gyccode-instance`（v1 实例 API）与 `server`（v2 服务端 API）

## 演进策略

1. **v2 为统一目标方向**：新协议能力（事件、会话、模型、技能等）只落 v2；v1 维持兼容不再新增。
2. **不跟随上游**：协议语义、类型、错误格式以本包为准；上游 opencode 协议仅作参考。
3. **生态兼容**：`.opencode` skill 目录、`@gyccode/protocol/plugin` 插件接口保留第三方生态互通。

## 自主声明

- 协议设计承继 opencode（MIT），代码已本地化（无 `@opencode-ai/*` 依赖，见 bun.lock）。
- 协议演进方向由 gyc-code 自主决定，与上游无绑定关系。
