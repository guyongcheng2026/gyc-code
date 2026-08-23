import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ModeSwitcher } from "./ModeSwitcher"

afterEach(cleanup)

describe("ModeSwitcher 激活态", () => {
  it("当前模式按钮高亮（背景为品牌色），其余模式不高亮", () => {
    render(<ModeSwitcher current="build" disabled={false} onSelect={() => {}} />)
    const build = screen.getByRole("button", { name: "build" })
    const plan = screen.getByRole("button", { name: "plan" })
    expect(build.style.background).toBe("var(--brand)")
    expect(build.style.color).toBe("rgb(255, 255, 255)")
    expect(plan.style.background).toBe("transparent")
  })

  it("点击模式按钮调用 onSelect 且传入该模式 id", () => {
    const onSelect = vi.fn()
    render(<ModeSwitcher current="build" disabled={false} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole("button", { name: "compose" }))
    expect(onSelect).toHaveBeenCalledWith("compose")
  })

  it("current 不匹配任何模式时无高亮（兜底不误标）", () => {
    render(<ModeSwitcher current="unknown-mode" disabled={false} onSelect={() => {}} />)
    for (const id of ["plan", "build", "compose"]) {
      expect(screen.getByRole("button", { name: id }).style.background).toBe("transparent")
    }
  })
})
