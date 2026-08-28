import { describe, expect, it } from "bun:test"
import { buildMemoryAlertMessage, shouldEmitMemoryAlert } from "./memory-alert"

describe("buildMemoryAlertMessage", () => {
  it("critical: 建议关闭无关进程并给出内存数据", () => {
    const msg = buildMemoryAlertMessage({ level: "critical", rssMB: 900, totalMB: 3998, freeMB: 300 })
    expect(msg.variant).toBe("warning")
    expect(msg.title).toContain("内存")
    expect(msg.message).toContain("关闭")
    expect(msg.message).toContain("300")
    expect(msg.message).toContain("900")
  })

  it("severe: 提示可用内存极低（含即时风险与立即行动措辞）", () => {
    const msg = buildMemoryAlertMessage({ level: "severe", rssMB: 1000, totalMB: 3998, freeMB: 50 })
    expect(msg.variant).toBe("error")
    expect(msg.message).toContain("立即")
    expect(msg.message).toContain("50")
    expect(msg.message).toContain("关闭")
  })

  it("startup: 启动期内存偏低提示", () => {
    const msg = buildMemoryAlertMessage({ level: "startup", rssMB: 500, totalMB: 3998, freeMB: 100 })
    expect(msg.variant).toBe("warning")
    expect(msg.message).toContain("启动")
    expect(msg.message).toContain("关闭")
  })

  it("all levels mention gyc tui 与释放内存语义一致", () => {
    for (const level of ["startup", "critical", "severe"] as const) {
      const msg = buildMemoryAlertMessage({ level, rssMB: 800, totalMB: 3998, freeMB: 200 })
      expect(msg.message).toContain("gyc tui")
    }
  })
})

describe("shouldEmitMemoryAlert", () => {
  it("首次触发应提示", () => {
    expect(shouldEmitMemoryAlert(0, 1_000, 60_000)).toBe(true)
  })

  it("冷却期内不重复提示", () => {
    expect(shouldEmitMemoryAlert(1_000, 30_000, 60_000)).toBe(false)
  })

  it("冷却期后可再次提示", () => {
    expect(shouldEmitMemoryAlert(1_000, 200_000, 60_000)).toBe(true)
  })
})
