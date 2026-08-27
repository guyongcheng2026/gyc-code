# gyc web 云就绪抽象边界（v2 远程沙箱预留）

> [!NOTE]
> This document may not reflect the current implementation.
> See the final report for up-to-date state:
> [Final Report](../reports/gyc-web.md)

> 日期：2026-08-15
> 阶段：P4（云就绪）—— 只文档化抽象边界与扩展点，**不实现远程沙箱**。
> 关联：`docs/compose/specs/2026-08-15-gyc-web-design.md`（§3 总体架构「v2=远程沙箱（预留接口）」）。
> 目标读者：后续实施云端沙箱的开发者。

## 一、结论

gyc 的 server 层**已内建云就绪抽象**：工作区可声明 `local`（本机目录）或 `remote`（远端 URL + 鉴权头）两种目标，请求经 `WorkspaceRoutingMiddleware` 按规则路由——本地走 `InstanceContextMiddleware` 加载本机 agent 实例，远端经 `HttpApiProxy` 转发到沙箱地址。v2 只需补一个「沙箱供应适配器」（创建远端工作区并返回 URL），即可把 agent 运行环境从本机搬到云端，前端零改动。

## 二、现有云就绪抽象（代码即现状）

### 2.1 目标模型 — `src/gyccode/control-plane/types.ts`

```ts
export type Target =
  | { type: "local"; directory: string }        // 本机 agent 运行
  | { type: "remote"; url: string | URL; headers?: HeadersInit }  // 远端沙箱
```

工作区（`WorkspaceInfo`）通过 `WorkspaceAdapter`（`control-plane/workspace.ts` + `adapters/`）配置目标与创建。

### 2.2 请求路由 — `server/routes/instance/httpapi/middleware/workspace-routing.ts`

- `WorkspaceRoutingMiddleware` 读取 `directory` / `workspace` 查询参数，产出 `RequestPlan`：`InvalidWorkspace` / `MissingWorkspace` / `Local {directory, workspaceID?}` / `Remote {request, workspace, target, url}`。
- 路由规则 `RULES`（`shared/workspace-routing.ts`）控制哪些路由留在本地（如 `/experimental/workspace`、`GET /session`），其余默认转发到远端目标。
- `workspaceProxyURL(target, requestURL)` 构造转发 URL：**剥离 `directory` 查询参数**（本机 Windows 路径对沙箱无意义且危险，会 `path.resolve` 出错误路径）与 `workspace` 参数，与 `ProxyUtil.headers` 剥离 `x-gyccode-directory` 头一致。

### 2.3 实例上下文 — `middleware/instance-context.ts`

- `InstanceContextMiddleware` 按 `directory` 从 `InstanceStore` 加载 `InstanceRef`（agent 运行上下文：目录、会话状态等），并提供 `WorkspaceRef`。
- 这是「agent runtime 抽象边界」的本地实现：所有 handler 只依赖 `InstanceRef`/`WorkspaceRef` 服务，不感知本地或远端。

### 2.4 会话归属与代理

- `getWorkspaceRouteSessionID(url)` 从 URL 提取会话 ID，用于会话级路由决策。
- `HttpApiProxy`（`middleware/proxy.ts`）执行远端转发；`Fence`（`shared/fence.ts`）做代理安全围栏。

## 三、前端边界（webapp 已协议化）

`src/webapp` 前端只依赖 `@gyccode/protocol/v1` 生成的 HTTP/SSE/WS 客户端（`createGyccodeClient`），通过同源 `/...` 与 server 通信：

- **不引用任何本地文件系统/进程 API**（文件/PTY/会话全部走 server 协议）。
- `directory` 经 `x-gyccode-directory` header / `workspace` 查询参数透传，由 server 决定本地还是远端。
- 因此**把 agent 迁到云端沙箱时，webapp 无需改动**——只需 server 端把目标配置为 `remote`。

**边界约束**：webapp 不得新增对「本机」的假设（绝对路径、本机 shell 等）；所有路径以 `directory` 参数为锚，交由 server 归一化。

## 四、v2 沙箱扩展点（本期不实现，仅契约）

要实现云端沙箱，按以下接口补齐（对齐现有 `WorkspaceAdapter` 模式）：

### 4.1 沙箱供应适配器（SandboxAdapter）

实现 `WorkspaceAdapter` 接口（`control-plane/types.ts`）：

```
create(info, ctx)   → 在沙箱供应商（如容器/VM 编排）申请环境，返回其 agent 服务 URL
configure(info, ctx) → 把 WorkspaceInfo 的 target 标记为 { type: "remote"; url; headers }
```

要点：
- **鉴权**：`headers` 携带沙箱签名令牌（短期 JWT），远端 server 校验后放行；禁止把主控端密码下发到沙箱。
- **生命周期**：沙箱随工作区生命周期（创建/删除）管理，需清理函数；空闲回收策略留待 v2。
- **失败语义**：沙箱不可达时，`HttpApiProxy` 应返回可读错误（502 + 重试提示），不悬挂。

### 4.2 路由规则扩展

`RULES` 中新增按工作区类型的动态规则：本地工作区全走本地，远端工作区按现有默认转发；`/experimental/workspace`、`GET /session` 等「控制面」路由始终本地（避免把控制面请求代理进沙箱）。

### 4.3 会话与事件

- 远端会话事件经现有 `global.event`（SSE）从远端 server 流回主控端；主控端做事件聚合后推送 webapp。
- `pty` 走远端 `/pty/{id}/connect` WebSocket（现有协议天然支持跨机）。

### 4.4 安全边界（强制）

- `workspaceProxyURL` 剥离 `directory` 参数 + `ProxyUtil.headers` 剥离 `x-gyccode-directory` 头（已实现，防路径穿越）。
- 沙箱网络隔离：默认禁止沙箱访问主控端内网（SSRF 防护沿用 webfetch fail-closed 策略）。
- 审计：远端操作经 `EventV2` 记录，主控端留痕。

## 五、数据流（本地 v1 → 云端 v2）

```
webapp ──(同源协议)──▶ gyc server(主控) ── WorkspaceRouting ──▶ local: InstanceContextMiddleware → 本机 agent
                                                        └────▶ remote: HttpApiProxy → 沙箱 agent(远端 server)
```

webapp 发送 `?workspace=<id>` 或默认 `directory`；主控 server 依据工作区 target 决定本地/远端，前端无感知。

## 六、本期不做（P4 明确排除）

- 沙箱供应商实现（容器/VM/云编排）。
- 云端账号体系与计费（`services/account` 已自建，后续对接）。
- 沙箱资源回收调度。
- 多区域/高可用。

## 七、后续工作项（进入 v2 时）

1. 新增 `control-plane/adapters/<provider>/` 实现 `WorkspaceAdapter`（create/configure/cleanup）。
2. `RULES` 动态化 + 沙箱健康探测与重连。
3. 远端会话事件聚合与断线缓存。
4. 沙箱安全基线审计（网络/存储/密钥）。

## 八、参考

- `src/gyccode/control-plane/types.ts`、`workspace.ts`、`workspace-adapter-runtime.ts`
- `src/gyccode/server/routes/instance/httpapi/middleware/{workspace-routing,instance-context,proxy,fence}.ts`
- `src/gyccode/server/shared/workspace-routing.ts`
- `src/webapp/src/client/*`（webapp 协议边界）
