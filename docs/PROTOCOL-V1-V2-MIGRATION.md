# 协议 v1 → v2 迁移清单（2026-08-31）

> 背景：`@gyccode/protocol` v1/v2 并存——webapp 走 v1（`client/sdk.ts`），CLI/TUI 走 v2。
> v2 是协议基线（CAPABILITIES.md 口径），v1 为 opencode 兼容入口，已标记 **FROZEN**
> （见 `src/protocol/v1/index.ts`）。本清单把 webapp 全部 v1 调用点逐一映射到 v2，
> 迁移完成后 v1 入口退役。
>
> 客户端形态差异：v1 为 `sdk(directory).<域>.<方法>()`；v2 为 `v2(directory).v2.<域>.<方法>()`。
> v2 生成物已覆盖全部域（session/file/pty/provider/model/permission/question/event 等），
> 且额外提供 v1 缺失的服务端能力（switchAgent/switchModel/compact）。

## 一、切换点映射（文件 → 调用点 → v2 等价）

### `src/client/useSessions.ts`
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).session.list()` | `v2(d).v2.session.list()` |
| `sdk(d).session.delete({ path: { id } })` | `v2(d).v2.session.delete({ path: { sessionID } })` |

### `src/client/useChatSession.ts`
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).session.messages({ path: { id } })` | `v2(d).v2.session.messages({ path: { sessionID: id } })` |

### `src/client/useSessionDiff.ts`
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).session.diff({ path: { id } })` | `v2(d).v2.session.diff({ path: { sessionID: id } })` |

### `src/client/useSessionInfo.ts`
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d)`（SSE 订阅） | `v2(d)` 事件订阅（v2 事件通道） |
| `sdk(d).session.status()` | `v2(d).v2.session.status()` |

### `src/client/useSessionActions.ts`（当前 v1/v2 混用，收口）
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).session.update({ path: { id }, body: { title } })` | `v2(d).v2.session.update({ path: { sessionID: id }, body: { title } })` |
| `sdk(d).session.fork({ path: { id } })` | `v2(d).v2.session.fork({ path: { sessionID: id } })` |
| `sdk(d).session.delete({ path: { id } })` | `v2(d).v2.session.delete({ path: { sessionID: id } })` |
| `sdk(d).session.abort({ path: { id } })` | `v2(d).v2.session.abort({ path: { sessionID: id } })` |
| `sdk(d).session.summarize(...)` ×2 | `v2(d).v2.session.summarize(...)`（或改用 v2 专属 compact） |
| `sdk(d).session.revert({ path: { id }, body: { messageID } })` | `v2(d).v2.session.revert({ path: { sessionID: id }, body })` |
| `sdk(d).session.command({ path: { id }, body })` | `v2(d).v2.session.command({ path: { sessionID: id }, body })` |
| `v2(d).v2.session.switchAgent/switchModel`（已 v2） | 不变 |

### `src/client/useSendPrompt.ts`（收口）
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).session.promptAsync({...})` | `v2(d).v2.session.prompt({...})`（v2 prompt 为流式；后台执行用 `experimental.session.background`） |
| `v2(d).v2.session.prompt`（已 v2） | 不变 |

### `src/client/usePty.ts`
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).pty.create({ body: { command, cwd } })` | `v2(d).v2.pty.create({ body })` |
| `sdk(d).pty.update({ path: { id }, body: { size } })` | `v2(d).v2.pty.update({ path: { id }, body: { size } })`（以 v2 gen 签名为准） |
| `sdk(d).pty.remove({ path: { id } })` | `v2(d).v2.pty.remove({ path: { id } })` |

### `src/client/usePermissions.ts`
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).postSessionIdPermissionsPermissionId({...})` | `v2(d).v2.permission.reply(...)`（v2 permission 域为显式方法命名，对照 `src/protocol/groups/permission.ts`） |

### `src/client/useFileTree.ts`
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).file.list({ query: { path } })` | `v2(d).v2.file.list({ query: { path } })` |
| `sdk(d).file.status()` | `v2(d).v2.file.status()` |

### `src/client/useFileContent.ts`
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).file.read({ query: { path } })` | `v2(d).v2.file.read({ query: { path } })` |

### `src/client/useModels.ts`（收口）
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).provider.list()` | `v2(d).v2.provider.list()`（该文件其余调用已是 v2） |

### `src/client/useEvents.ts` / `useCommands.ts`
| v1 调用 | v2 等价 |
|---|---|
| `void sdk(d)`（连接预热/SSE） | `void v2(d)` |

### `src/app/App.tsx` / `src/app/ChatPanel.tsx`
| v1 调用 | v2 等价 |
|---|---|
| `sdk(d).session.create({ body: {} })` ×2 | `v2(d).v2.session.create({ body: {} })` |
| `sdk(d).session.abort({ path: { id } })` | `v2(d).v2.session.abort({ path: { sessionID: id } })` |

## 二、执行步骤

1. `src/webapp/src/client/sdk.ts` 改为从 `@gyccode/protocol/v2` 创建并保留 `sdk()` 名称
   （把 v2 命名空间扁平化导出，可让 12 个消费点零改动切换），或逐文件替换 import。
   **推荐前者**：单点切换、diff 最小。
2. 参数名差异核对：v2 生成物 path 参数用 `sessionID`（v1 部分为 `id`），逐处对照
   `src/protocol/v2/gen/sdk.gen.ts` 签名。
3. 验证：`bun run test:web`（vitest）+ `bun run webapp:build`；关注 useSessions/
   useChatSession/useSessionActions 三个带测试的文件。
4. 全绿后：删除 `src/webapp/src/client/v1` 消费（sdk.ts 旧 import），
   在 `src/protocol/package.json` 移除 `"./v1"` exports，物理删除 `src/protocol/v1/`。

## 三、注意事项

- v1 与 v2 的 `directory` 路由头语义一致（`x-gyccode-directory`），v2 额外支持
  `x-gyccode-workspace`，webapp 无需改动路由逻辑。
- v1 的 `postSessionIdPermissionsPermissionId` 是 hey-api 路径推断命名，v2 已改为
  语义化方法，切换时以 `groups/permission.ts` 的 v2 API 定义为准。
- v1 `session.promptAsync` 与 v2 `session.prompt`（流式）/`experimental.session.background`
  的语义差异需在切换时确认 UI 期望（同步等待 vs 后台执行）。
