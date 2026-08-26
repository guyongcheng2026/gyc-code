import { describe, expect, test } from "bun:test"
import {
  VIRTUAL_DEFAULT_STATE,
  virtualEnsureVisible,
  virtualExpandMore,
  virtualOnNewMessage,
  virtualRenderFrom,
  type VirtualWindowState,
} from "./virtual-window"

// 生成 id 为 "m0".."m{N-1}" 的消息数组
const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }))

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

  test("锚点消息被删除（revert/undo）：安全回退全展开", () => {
    const state: VirtualWindowState = { anchorID: "m100", full: false }
    // revert 后 m100 不在列表中
    const list = msgs(300).filter((m) => m.id !== "m100")
    expect(virtualRenderFrom(state, list)).toBe(0)
  })

  test("full 状态恒为 0（全展开）", () => {
    expect(virtualRenderFrom({ anchorID: undefined, full: true }, msgs(1000))).toBe(0)
  })
})

describe("virtualExpandMore", () => {
  test("无折叠时不可再展开（幂等）", () => {
    expect(virtualExpandMore(VIRTUAL_DEFAULT_STATE, msgs(40))).toBe(VIRTUAL_DEFAULT_STATE)
  })

  test("长会话逐步展开：260 → 200 → 140 → 80 → 20 → full", () => {
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
    state = virtualExpandMore(state, list)
    expect(state.full).toBe(true)
    expect(virtualRenderFrom(state, list)).toBe(0)
  })

  test("展开锚点跨过 0 时直接转 full", () => {
    // renderFrom=30 < STEP=60 → next=0 → full
    const state = virtualExpandMore({ anchorID: "m30", full: false }, msgs(300))
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
})

describe("virtualOnNewMessage", () => {
  test("默认窗口 + 新消息：不动（renderFrom 自动前移）", () => {
    const state = virtualOnNewMessage(VIRTUAL_DEFAULT_STATE, msgs(301), true)
    expect(state).toBe(VIRTUAL_DEFAULT_STATE)
  })

  test("full + 超过 MAX_WINDOW：回默认窗口防无限增长", () => {
    const state = virtualOnNewMessage({ anchorID: undefined, full: true }, msgs(201), true)
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
