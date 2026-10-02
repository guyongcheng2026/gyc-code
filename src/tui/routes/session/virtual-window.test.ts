import { describe, expect, test } from "bun:test"
import {
  VIRTUAL_COLLAPSED_SUMMARY_LIMIT,
  VIRTUAL_DEFAULT_STATE,
  VIRTUAL_MAX_WINDOW,
  virtualCollapsedRenderFrom,
  virtualEnsureVisible,
  virtualExpandMore,
  virtualExpansionCapped,
  virtualOnNewMessage,
  virtualRenderFrom,
  type VirtualWindowState,
} from "./virtual-window"

// 生成 id 为 "m0".."m{N-1}" 的消息数组
const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }))

// 句柄预算：opentui 0.5.6 原生句柄表上限 65,535（实测第 65,535 次 createTextBuffer
// 返回无效句柄）。单个 <text> 约占 3 个句柄（text_buffer + text_buffer_view +
// native_renderable），带边框的 <box> 另占 1 个。实测「每条消息 2 个工具」的结构
// 在约 2,700 条全量渲染时即逼近上限（tools=6 时 1,300 条即耗尽）。
// 故任何状态下完整渲染的消息条数都不得超过 VIRTUAL_MAX_WINDOW。
const budgetFrom = (n: number) => Math.max(0, n - VIRTUAL_MAX_WINDOW)

describe("virtualRenderFrom", () => {
  test("短会话（≤40 条）恒为 0：零折叠，行为与虚拟化前一致", () => {
    expect(virtualRenderFrom(VIRTUAL_DEFAULT_STATE, msgs(0))).toBe(0)
    expect(virtualRenderFrom(VIRTUAL_DEFAULT_STATE, msgs(1))).toBe(0)
    expect(virtualRenderFrom(VIRTUAL_DEFAULT_STATE, msgs(40))).toBe(0)
  })

  test("长会话默认尾部窗口：len - 40", () => {
    expect(virtualRenderFrom(VIRTUAL_DEFAULT_STATE, msgs(41))).toBe(1)
    expect(virtualRenderFrom(VIRTUAL_DEFAULT_STATE, msgs(300))).toBe(260)
  })

  test("锚定消息 ID 而非绝对索引", () => {
    const state: VirtualWindowState = { anchorID: "m100", full: false }
    expect(virtualRenderFrom(state, msgs(300))).toBe(100)
  })

  test("锚点消息被删除（revert/undo）：回退到句柄预算起点而非全展开", () => {
    const state: VirtualWindowState = { anchorID: "m100", full: false }
    // revert 后 m100 不在列表中
    const list = msgs(300).filter((m) => m.id !== "m100")
    expect(virtualRenderFrom(state, list)).toBe(budgetFrom(list.length))
  })

  test("full 状态不超过句柄预算：只完整渲染最近 MAX_WINDOW 条", () => {
    expect(virtualRenderFrom({ anchorID: undefined, full: true }, msgs(1000))).toBe(400)
    expect(virtualRenderFrom({ anchorID: undefined, full: true }, msgs(2685))).toBe(2085)
  })

  test("≤MAX_WINDOW 的会话 full 仍为 0：全展开，行为不变", () => {
    expect(virtualRenderFrom({ anchorID: undefined, full: true }, msgs(150))).toBe(0)
    expect(virtualRenderFrom({ anchorID: undefined, full: true }, msgs(600))).toBe(0)
  })

  test("锚点早于预算起点时被钳制：任何状态都不会超预算", () => {
    const state: VirtualWindowState = { anchorID: "m10", full: false }
    expect(virtualRenderFrom(state, msgs(2685))).toBe(budgetFrom(2685))
  })

  test("锚点在预算内时按锚点定位（短会话锚定行为不变）", () => {
    const state: VirtualWindowState = { anchorID: "m100", full: false }
    expect(virtualRenderFrom(state, msgs(300))).toBe(100)
  })
})

describe("virtualExpandMore", () => {
  test("无折叠时不可再展开（幂等）", () => {
    expect(virtualExpandMore(VIRTUAL_DEFAULT_STATE, msgs(40))).toBe(VIRTUAL_DEFAULT_STATE)
  })

  test("中长会话逐步展开：260 → 200 → 140 → 80 → 20 → full（未触预算）", () => {
    let state = VIRTUAL_DEFAULT_STATE
    const list = msgs(300)
    state = virtualExpandMore(state, list)
    expect(virtualRenderFrom(state, list)).toBe(200)
    expect(state.anchorID).toBe("m200")
    state = virtualExpandMore(state, list)
    expect(virtualRenderFrom(state, list)).toBe(140)
    state = virtualExpandMore(state, list)
    expect(virtualRenderFrom(state, list)).toBe(80)
    state = virtualExpandMore(state, list)
    expect(virtualRenderFrom(state, list)).toBe(20)
    // 300 条 ≤ MAX_WINDOW：预算不介入，展开到顶即全展开
    state = virtualExpandMore(state, list)
    expect(state.full).toBe(true)
    expect(virtualRenderFrom(state, list)).toBe(0)
  })

  test("达到句柄预算上限后幂等：不再向更早处展开", () => {
    const list = msgs(2685)
    const atLimit: VirtualWindowState = { anchorID: undefined, full: true }
    expect(virtualRenderFrom(atLimit, list)).toBe(budgetFrom(2685))
    expect(virtualExpandMore(atLimit, list)).toBe(atLimit)
  })

  test("超长会话展开到底也停在预算起点，绝不进入全量渲染", () => {
    let state = VIRTUAL_DEFAULT_STATE
    const list = msgs(2685)
    for (let i = 0; i < 100; i++) state = virtualExpandMore(state, list)
    expect(virtualRenderFrom(state, list)).toBe(budgetFrom(2685))
    expect(virtualCollapsedRenderFrom(state, list)).toBe(
      budgetFrom(2685) - VIRTUAL_COLLAPSED_SUMMARY_LIMIT,
    )
  })

  test("短会话展开到顶仍转 full（全展开行为不变）", () => {
    const list = msgs(150)
    let state = VIRTUAL_DEFAULT_STATE
    for (let i = 0; i < 10; i++) state = virtualExpandMore(state, list)
    expect(state.full).toBe(true)
    expect(virtualRenderFrom(state, list)).toBe(0)
  })

  test("展开锚点跨过 0 时直接转 full", () => {
    // 150 条会话预算起点为 0：renderFrom=50 < STEP=60 → next=0 → full
    const state = virtualExpandMore({ anchorID: "m50", full: false }, msgs(150))
    expect(state.full).toBe(true)
  })
})

describe("virtualEnsureVisible", () => {
  test("目标在窗口内：不动", () => {
    const state = virtualEnsureVisible(VIRTUAL_DEFAULT_STATE, msgs(300), "m299")
    expect(state).toBe(VIRTUAL_DEFAULT_STATE)
  })

  test("目标不存在：不动", () => {
    const state = virtualEnsureVisible(VIRTUAL_DEFAULT_STATE, msgs(300), "nope")
    expect(state).toBe(VIRTUAL_DEFAULT_STATE)
  })

  test("目标在折叠区：展开到目标上方 5 条", () => {
    const state = virtualEnsureVisible(VIRTUAL_DEFAULT_STATE, msgs(300), "m10")
    expect(state.anchorID).toBe("m5")
    expect(virtualRenderFrom(state, msgs(300))).toBe(5)
  })

  test("目标接近顶部（<5）：直接 full", () => {
    const state = virtualEnsureVisible(VIRTUAL_DEFAULT_STATE, msgs(300), "m2")
    expect(state.full).toBe(true)
  })

  test("超长会话跳转到很早的消息：落在预算内，不触发全量渲染", () => {
    const list = msgs(2685)
    const state = virtualEnsureVisible(VIRTUAL_DEFAULT_STATE, list, "m5")
    expect(virtualRenderFrom(state, list)).toBe(budgetFrom(2685))
  })
})

describe("virtualExpansionCapped", () => {
  test("默认尾部窗口尚未触顶：可继续展开", () => {
    expect(virtualExpansionCapped(VIRTUAL_DEFAULT_STATE, msgs(2685))).toBe(false)
  })

  test("已顶到句柄预算：提示 UI 改用「请用搜索查看」文案", () => {
    const list = msgs(2685)
    let state = VIRTUAL_DEFAULT_STATE
    for (let i = 0; i < 200; i++) state = virtualExpandMore(state, list)
    expect(virtualExpansionCapped(state, list)).toBe(true)
    expect(virtualExpansionCapped({ anchorID: undefined, full: true }, list)).toBe(true)
  })

  test("≤MAX_WINDOW 的会话未触顶：提示文案与引入预算前一致", () => {
    // 300 条会话展开途中：仍可继续向上展开
    const mid: VirtualWindowState = { anchorID: "m50", full: false }
    expect(virtualRenderFrom(mid, msgs(300))).toBe(50)
    expect(virtualExpansionCapped(mid, msgs(300))).toBe(false)
  })
})

describe("virtualOnNewMessage", () => {  test("默认窗口 + 新消息：不动（renderFrom 自动前移）", () => {
    const state = virtualOnNewMessage(VIRTUAL_DEFAULT_STATE, msgs(301), true)
    expect(state).toBe(VIRTUAL_DEFAULT_STATE)
  })

  test("full + 超过 MAX_WINDOW：回默认窗口防无限增长", () => {
    const state = virtualOnNewMessage({ anchorID: undefined, full: true }, msgs(601), true)
    expect(state).toStrictEqual(VIRTUAL_DEFAULT_STATE)
  })

  test("full + 未超限：保持 full", () => {
    const state = virtualOnNewMessage({ anchorID: undefined, full: true }, msgs(150), true)
    expect(state.full).toBe(true)
  })

  test("锚定 + 用户在底部：回默认尾部窗口", () => {
    const state = virtualOnNewMessage({ anchorID: "m100", full: false }, msgs(301), true)
    expect(state).toStrictEqual(VIRTUAL_DEFAULT_STATE)
  })

  test("锚定 + 用户在看历史（不贴底）：保持锚点不动", () => {
    const anchored: VirtualWindowState = { anchorID: "m100", full: false }
    const state = virtualOnNewMessage(anchored, msgs(301), false)
    expect(state).toBe(anchored)
  })
})

// 折叠摘要同样要挂 renderable（每个 <box>+<text> 约占 5 个原生句柄）：
// 2,600+ 条超长会话若逐条渲染摘要，仍会撞上 opentui 65,535 句柄表上限，
// 表现为「一开启会话就退出」。故折叠区只保留最近 LIMIT 条摘要节点。
describe("virtualCollapsedRenderFrom", () => {
  test("短会话无折叠区：不额外裁剪", () => {
    expect(virtualCollapsedRenderFrom(VIRTUAL_DEFAULT_STATE, msgs(40))).toBe(0)
  })

  test("折叠区小于上限：一条摘要都不丢（渲染起点为 0）", () => {
    const list = msgs(300)
    const from = virtualRenderFrom(VIRTUAL_DEFAULT_STATE, list) // 260
    expect(from).toBeLessThan(VIRTUAL_COLLAPSED_SUMMARY_LIMIT)
    expect(virtualCollapsedRenderFrom(VIRTUAL_DEFAULT_STATE, list)).toBe(0)
  })

  test("折叠区超过上限：只保留最近 LIMIT 条摘要节点", () => {
    const list = msgs(2685)
    const from = virtualRenderFrom(VIRTUAL_DEFAULT_STATE, list) // 2645
    expect(virtualCollapsedRenderFrom(VIRTUAL_DEFAULT_STATE, list)).toBe(from - VIRTUAL_COLLAPSED_SUMMARY_LIMIT)
  })

  test("裁剪后仍保留全部消息的语义：被裁掉区间不挂节点，其余照常", () => {
    const list = msgs(2685)
    const renderFrom = virtualCollapsedRenderFrom(VIRTUAL_DEFAULT_STATE, list)
    const collapsedFrom = virtualRenderFrom(VIRTUAL_DEFAULT_STATE, list)
    expect(renderFrom).toBeGreaterThan(0)
    expect(renderFrom).toBeLessThan(collapsedFrom)
    // 裁剪后的折叠节点数恰好等于上限
    expect(collapsedFrom - renderFrom).toBe(VIRTUAL_COLLAPSED_SUMMARY_LIMIT)
  })

  test("full 状态同样受摘要上限约束：更早的消息不挂 renderable", () => {
    const list = msgs(2685)
    const state: VirtualWindowState = { anchorID: undefined, full: true }
    const renderFrom = virtualRenderFrom(state, list)
    expect(renderFrom).toBe(budgetFrom(2685))
    expect(virtualCollapsedRenderFrom(state, list)).toBe(renderFrom - VIRTUAL_COLLAPSED_SUMMARY_LIMIT)
  })

  test("用户主动展开（锚定）：折叠区同样受摘要上限约束", () => {
    const list = msgs(2685)
    const state = virtualExpandMore(VIRTUAL_DEFAULT_STATE, list) // 展开 60 条
    expect(state.anchorID).not.toBeUndefined()
    const from = virtualRenderFrom(state, list)
    expect(from).toBeGreaterThan(0)
    expect(virtualCollapsedRenderFrom(state, list)).toBe(from - VIRTUAL_COLLAPSED_SUMMARY_LIMIT)
  })

  test("短会话 full：折叠区为 0，不额外裁剪，行为不变", () => {
    const list = msgs(150)
    const state: VirtualWindowState = { anchorID: undefined, full: true }
    expect(virtualRenderFrom(state, list)).toBe(0)
    expect(virtualCollapsedRenderFrom(state, list)).toBe(0)
  })

  test("上限为正且为整数（句柄预算可计算）", () => {
    expect(Number.isInteger(VIRTUAL_COLLAPSED_SUMMARY_LIMIT)).toBe(true)
    expect(VIRTUAL_COLLAPSED_SUMMARY_LIMIT).toBeGreaterThan(0)
  })

  test("完整渲染条数不超过句柄预算（回归：opentui 65,535 句柄表）", () => {
    // 复现崩溃会话规模：2,685 条消息。任何状态、任何展开深度下，
    // 挂载的 renderable 总量（完整 + 摘要）都必须留在预算内。
    const list = msgs(2685)
    let state = VIRTUAL_DEFAULT_STATE
    for (let i = 0; i < 200; i++) {
      state = virtualExpandMore(state, list)
      const mounted =
        list.length - virtualCollapsedRenderFrom(state, list)
      expect(mounted).toBeLessThanOrEqual(VIRTUAL_MAX_WINDOW + VIRTUAL_COLLAPSED_SUMMARY_LIMIT)
    }
    const stateFull: VirtualWindowState = { anchorID: undefined, full: true }
    expect(list.length - virtualCollapsedRenderFrom(stateFull, list)).toBeLessThanOrEqual(
      VIRTUAL_MAX_WINDOW + VIRTUAL_COLLAPSED_SUMMARY_LIMIT,
    )
  })
})
