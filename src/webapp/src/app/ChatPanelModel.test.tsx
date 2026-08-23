import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ChatPanel } from "./ChatPanel"

const switchModel = vi.fn(() => Promise.resolve({}))
const promptAsync = vi.fn(() => Promise.resolve({}))

vi.mock("@gyccode/protocol/v1", () => ({
  createGyccodeClient: () => ({
    session: {
      promptAsync,
      get: () => Promise.resolve({ data: { title: "" } }),
      status: () => Promise.resolve({ data: {} }),
      todo: () => Promise.resolve({ data: [] }),
      update: () => Promise.resolve({}),
      fork: () => Promise.resolve({ data: { id: "s2" } }),
      abort: () => Promise.resolve({}),
      summarize: () => Promise.resolve({}),
      revert: () => Promise.resolve({}),
      command: () => Promise.resolve({}),
    },
    command: { list: () => Promise.resolve({ data: [] }) },
    provider: { list: () => Promise.resolve({ data: { all: [] } }) },
    global: { event: () => Promise.resolve({}) },
  }),
}))

vi.mock("../client/useChatSession", () => ({
  useChatSession: () => ({ messages: [], idle: true, busy: false }),
}))
vi.mock("../client/useSendPrompt", () => ({
  useSendPrompt: () => ({ send: vi.fn(() => Promise.resolve()), deliver: vi.fn(() => Promise.resolve()) }),
}))
vi.mock("../client/usePermissions", () => ({
  usePermissions: () => ({ queue: [], resolve: vi.fn() }),
}))
vi.mock("../client/useQuestions", () => ({
  useQuestions: () => ({ requests: [], reply: vi.fn(), reject: vi.fn() }),
}))
vi.mock("../client/useSessionActions", () => ({
  useSessionActions: () => ({
    command: vi.fn(() => Promise.resolve()),
    abort: vi.fn(() => Promise.resolve()),
    fork: vi.fn(() => Promise.resolve("s2")),
    summarize: vi.fn(() => Promise.resolve()),
    compact: vi.fn(() => Promise.resolve()),
    switchAgent: vi.fn(() => Promise.resolve()),
    switchModel,
    background: vi.fn(() => Promise.resolve()),
  }),
}))
vi.mock("../client/useCommands", () => ({
  useCommands: () => ({ commands: [] }),
}))
vi.mock("../client/useSessionInfo", () => ({
  useSessionInfo: () => ({
    info: {
      id: "s1",
      title: "",
      model: { providerID: "nvidia", modelID: "nemotron" },
      agent: "build",
      todos: [],
    },
    refresh: vi.fn(() => Promise.resolve()),
  }),
}))
vi.mock("../client/useModels", () => ({
  useModels: () => ({
    models: [
      {
        providerID: "nvidia",
        providerName: "NVIDIA",
        modelID: "nemotron",
        modelName: "NVIDIA Nemotron 3 Ultra",
        label: "nvidia/nemotron",
        variants: [],
      },
    ],
    loading: false,
  }),
}))
vi.mock("../client/useQueue", () => ({
  useQueue: () => ({ queue: [] }),
}))

afterEach(cleanup)

describe("ChatPanel 模型选择与标题", () => {
  it("点击模型项调用 switchModel(sessionID, providerID, modelID) 且不抛错", () => {
    render(<ChatPanel sessionID="s1" />)
    // 打开 ModelPicker 下拉
    fireEvent.click(screen.getByRole("button", { name: /^模型/ }))
    // 点击下拉里的模型项（第二个匹配 = 下拉列表项，第一个是按钮）
    fireEvent.click(screen.getAllByText("NVIDIA Nemotron 3 Ultra")[1])
    expect(switchModel).toHaveBeenCalledWith("s1", "nvidia", "nemotron")
  })

  it("会话标题为空字符串时显示「会话」兜底", () => {
    render(<ChatPanel sessionID="s1" />)
    expect(screen.getByText("会话")).toBeTruthy()
  })
})
