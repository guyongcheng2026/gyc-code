import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { Loading } from "./Loading"

// vitest globals:false —— testing-library 不会自动 cleanup，需显式清理避免 DOM 累积导致元素重复
afterEach(cleanup)

describe("Loading", () => {
  it("渲染 label 文本", () => {
    render(<Loading label="加载中" />)
    expect(screen.getByText("加载中")).toBeTruthy()
  })

  it("无 label 时不渲染文字", () => {
    const { container } = render(<Loading />)
    expect(container.textContent).toBe("")
  })

  it("渲染 4 个 spinner 圆点", () => {
    const { container } = render(<Loading />)
    expect(container.querySelectorAll(".dot i").length).toBe(4)
  })
})
