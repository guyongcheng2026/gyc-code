import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ModelPicker } from "./ModelPicker"
import type { ModelOption } from "../client/useModels"

// vitest globals:false —— testing-library 不会自动 cleanup，需显式清理避免 DOM 累积导致元素重复
afterEach(cleanup)

const models: ModelOption[] = [
  {
    providerID: "nvidia",
    providerName: "NVIDIA",
    modelID: "nemotron",
    modelName: "NVIDIA Nemotron 3 Ultra",
    label: "nvidia/nemotron",
    variants: ["default"],
  },
]

// 主按钮（模型选择触发钮）
const openButton = () => screen.getByRole("button", { name: /^模型/ })

describe("ModelPicker", () => {
  it("loading 中点击按钮仍可打开下拉（显示加载中提示，而非无反应）", () => {
    render(<ModelPicker models={[]} current="" loading onSelect={() => {}} />)
    fireEvent.click(openButton())
    expect(screen.getByText("模型列表加载中...")).toBeTruthy()
  })

  it("点击按钮打开下拉并渲染模型列表", () => {
    render(<ModelPicker models={models} current="nvidia/nemotron" loading={false} onSelect={() => {}} />)
    fireEvent.click(openButton())
    // 按钮 + 下拉列表项都含该文本
    expect(screen.getAllByText("NVIDIA Nemotron 3 Ultra").length).toBeGreaterThanOrEqual(2)
  })

  it("点击模型项调用 onSelect(label) 并关闭下拉", () => {
    const onSelect = vi.fn()
    render(<ModelPicker models={models} current="nvidia/nemotron" loading={false} onSelect={onSelect} />)
    fireEvent.click(openButton())
    // 第二个匹配是下拉里的模型项
    fireEvent.click(screen.getAllByText("NVIDIA Nemotron 3 Ultra")[1])
    expect(onSelect).toHaveBeenCalledWith("nvidia/nemotron")
    // 下拉关闭后仅剩按钮文本
    expect(screen.getAllByText("NVIDIA Nemotron 3 Ultra").length).toBe(1)
  })

  it("无模型时打开下拉显示「暂无可用模型」", () => {
    render(<ModelPicker models={[]} current="" loading={false} onSelect={() => {}} />)
    fireEvent.click(openButton())
    expect(screen.getByText("暂无可用模型")).toBeTruthy()
  })

  it("displayName 按 label 匹配当前模型全名（label 与 current 同格式 `${providerID}/${modelID}`）", () => {
    render(<ModelPicker models={models} current="nvidia/nemotron" loading={false} onSelect={() => {}} />)
    expect(openButton().textContent).toContain("NVIDIA Nemotron 3 Ultra")
  })

  it("label 与 current 格式不一致时回退显示 current（不误匹配）", () => {
    render(<ModelPicker models={models} current="other/mismatch" loading={false} onSelect={() => {}} />)
    expect(openButton().textContent).toContain("other/mismatch")
  })
})
