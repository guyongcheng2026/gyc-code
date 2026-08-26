# RendererBackend 抽象层设计冻结（P2 前置交付）

日期：2026-08-26 · 状态：冻结（供立项评审）

## 一、定位

本文档是《opentui 全面替换》立项前置条件 P2 的交付物：**RendererBackend 接口评审稿**。接口一经冻结，S0（抽象层产线接入）期间只做实现与接线，不再改契约面；如需变更须回到本文档修订并重走评审。

## 二、接口契约（src/tui/fallback/renderer-backend.ts）

```ts
export type RendererBackendEvent = "resize" | "frame" | "destroy"

export interface RendererBackend {
	readonly isDestroyed: boolean
	readonly width: number
	readonly height: number
	requestRender(): void
	on(event: RendererBackendEvent, listener: () => void): () => void
	once(event: "destroy", listener: () => void): void
	setTerminalTitle(title: string): void
	useMouse: boolean
	suspend(): void
	resume(): void
	setBackgroundColor(color: unknown): void
	toggleDebugOverlay(): void
}
```

## 三、成员决策依据（以 app.tsx 实际使用面为基准）

| 契约成员 | app.tsx 使用点 | opentui 映射 | fallback 映射 |
|----------|---------------|--------------|---------------|
| `isDestroyed` | L573/580/588/602…（守卫渲染器销毁） | `CliRenderer.isDestroyed` | `!started`（适配层 destroy 置位） |
| `width`/`height` | useTerminalDimensions 内部（经渲染器事件） | `CliRenderer.width/height` | `backend.getWidth()/getHeight()` |
| `requestRender()` | 渲染循环驱动 | `CliRenderer.requestRender()` | `present(noop)`（差分调度） |
| `on("resize")` | 终端尺寸变化 | `renderer.on("resize")` | `backend.onResize` 转发 |
| `once("destroy")` | L330 shutdown Deferred | `renderer.once("destroy")` | 适配层 emit |
| `setTerminalTitle` | L825/832/837/842/1246 | 原生实现 | 空实现（契约保留） |
| `useMouse` | L583 setter 运行时补启 | 原生鼠标事件 | 恒 false（无鼠标层） |
| `suspend`/`resume` | L1233/1234 SIGTSTP/SIGCONT | 原生实现 | 空实现 |
| `setBackgroundColor` | theme.tsx L267 | RGBA 入参 | 空实现 |
| `toggleDebugOverlay` | L1199 | 原生实现 | 空实现 |

**收窄原则**：只收录 app.tsx 主链路实际消费的成员；`console`（TerminalConsole 对象）、`clearSelection`、scrollback surface 等深耦合面**不进入本契约**——它们属于 S1 组件桥接层要解决的深水区，提前纳入会使接口冻结失去意义。

## 四、双实现（src/tui/fallback/renderer-backend-adapters.ts）

- **OpentuiRendererBackend**：包装 `CliRendererLike`（结构性子集，非 opentui 类型直引——避免本层测试载荷带起原生依赖；产线接入时 createCliRenderer 结果天然满足该结构）。
- **FallbackRendererBackend**：包装自研 `FallbackRenderer`；present 即 requestRender；resize 事件转发；destroy 幂等。

**可编译切换验证**：`renderer-backend.test.ts` 5 用例——透传、destroy 事件、resize 转发、幂等 destroy、双实现同构（契约成员逐一 typeof 断言）。

## 五、已知边界与 S0 计划

1. `setBackgroundColor(color: unknown)` 的 `unknown` 是过渡形态——opentui 用 RGBA 类型、fallback 用不到色值；S0 接入时若 fallback 侧需要背景色，升级为 `string | null`（hex），此时修订本文档。
2. `frame` 事件在 opentui 适配层暂为 no-op 消费点（opentui 有 FRAME 事件，fallback 无逐帧回调概念）；S0 若依赖帧同步需补充语义。
3. 本契约不含输入/keymap 面——键盘输入走各自的 KeyHandler 体系（opentui keymap / fallback input.ts），S1 组件桥接时再统一。

## 六、评审结论

- 接口成员 12 个，全部映射到 app.tsx 真实调用点，无臆造成员；
- 双实现可编译切换（测试同构断言通过）；
- 性能基线：富文本维度扩展后全量帧 0.150ms（80x24），仍余量 13 倍（<2ms 目标）；
- 结论：**通过冻结，可进入 S0**。
