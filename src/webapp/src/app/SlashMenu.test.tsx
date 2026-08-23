import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SlashMenu } from "./SlashMenu"
import type { CommandItem } from "../client/useCommands"

afterEach(cleanup)

const items: CommandItem[] = [
  { name: "init", description: "Create or update AGENTS.md" },
  { name: "compact", description: "Compact the conversation" },
]

describe("SlashMenu 命令面板", () => {
  it("渲染命令列表（名称 + 描述）", () => {
    render(<SlashMenu items={items} selected={0} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText("/init")).toBeTruthy()
    expect(screen.getByText("Create or update AGENTS.md")).toBeTruthy()
    expect(screen.getByText("/compact")).toBeTruthy()
    expect(screen.getByText("Compact the conversation")).toBeTruthy()
  })

  it("点击命令项调用 onSelect(index)", () => {
    const onSelect = vi.fn()
    render(<SlashMenu items={items} selected={0} onSelect={onSelect} onClose={() => {}} />)
    fireEvent.click(screen.getByText("/compact"))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it("列表为空时不渲染（返回 null）", () => {
    const { container } = render(<SlashMenu items={[]} selected={0} onSelect={() => {}} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it("显示键盘提示（↑↓/Enter/Esc）", () => {
    render(<SlashMenu items={items} selected={0} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText("↑↓ 选择")).toBeTruthy()
    expect(screen.getByText("Enter 执行")).toBeTruthy()
    expect(screen.getByText("Esc 关闭")).toBeTruthy()
  })
})
