import { test, expect } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { View } from "./context"
import type { AssistantMessage, Message } from "@gyccode/protocol/v2"

function assistant(id: string, tokens: any, completed = 1000): Message {
  return {
    id, role: "assistant", sessionID: "ses1", time: { created: 0, completed },
    cost: 0.11, model: { providerID: "deepseek", modelID: "deepseek-v4-flash" },
    agent: "primary", tokens, parts: [],
  } as unknown as AssistantMessage
}

const c = (hex: string) => RGBA.fromHex(hex)
const theme = {
  current: {
    text: c("#ffffff"), textMuted: c("#b4b4b4"), warning: c("#ffc800"), error: c("#ff5050"),
    primary: c("#ffffff"), secondary: c("#000000"), accent: c("#000000"), success: c("#00ff00"),
    info: c("#0000ff"), background: c("#000000"), backgroundPanel: c("#101010"),
    backgroundElement: c("#202020"), backgroundMenu: c("#303030"), border: c("#404040"),
    borderActive: c("#505050"), borderSubtle: c("#606060"),
  },
  selected: "dark", has: () => false, set: () => false, install: async () => {}, mode: () => "dark" as const, ready: true,
}

test("View renders real tokens, CH, and cost", async () => {
  const msgs: Message[] = [
    { id: "u1", role: "user", sessionID: "ses1", time: { created: 0 }, parts: [] } as unknown as Message,
    assistant("a1", { input: 100, output: 0, reasoning: 200, cache: { read: 900, write: 50 } }),
    assistant("a2", { input: 100, output: 0, reasoning: 180, cache: { read: 800, write: 50 } }),
    assistant("a3", { input: 100, output: 0, reasoning: 160, cache: { read: 700, write: 50 } }),
  ]
  const api: any = {
    theme,
    state: {
      session: { messages: () => msgs, get: () => undefined },
      part: () => [],
      provider: [{ id: "deepseek", models: { "deepseek-v4-flash": { id: "deepseek-v4-flash", limit: { context: 128000 } } } }],
      config: {},
    },
    ui: { dialog: { replace: () => {} } },
  }
  const setup = await testRender(() => <View api={api} session_id="ses1" />, { width: 80, height: 10 })
  await setup.flush()
  const frame = setup.captureCharFrame()
  expect(frame).toContain("3,390 tokens")
  expect(frame).toContain("CH 84.2%")
  expect(frame).toContain("$0.33 spent")
})

test("View hides CH with fewer than 2 completed turns", async () => {
  const msgs: Message[] = [
    { id: "u1", role: "user", sessionID: "ses1", time: { created: 0 }, parts: [] } as unknown as Message,
    assistant("a1", { input: 100, output: 0, reasoning: 200, cache: { read: 900, write: 50 } }),
  ]
  const api: any = {
    theme,
    state: {
      session: { messages: () => msgs, get: () => undefined },
      part: () => [],
      provider: [{ id: "deepseek", models: { "deepseek-v4-flash": { id: "deepseek-v4-flash", limit: { context: 128000 } } } }],
      config: {},
    },
    ui: { dialog: { replace: () => {} } },
  }
  const setup = await testRender(() => <View api={api} session_id="ses1" />, { width: 80, height: 10 })
  await setup.flush()
  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("CH ")
})

test("View shows non-zero tokens for reasoning-only DeepSeek turns", async () => {
  const msgs: Message[] = [
    { id: "u1", role: "user", sessionID: "ses1", time: { created: 0 }, parts: [] } as unknown as Message,
    assistant("a1", { input: 100, output: 0, reasoning: 500, cache: { read: 0, write: 0 } }),
  ]
  const api: any = {
    theme,
    state: {
      session: { messages: () => msgs, get: () => undefined },
      part: () => [],
      provider: [{ id: "deepseek", models: { "deepseek-v4-flash": { id: "deepseek-v4-flash", limit: { context: 128000 } } } }],
      config: {},
    },
    ui: { dialog: { replace: () => {} } },
  }
  const setup = await testRender(() => <View api={api} session_id="ses1" />, { width: 80, height: 10 })
  await setup.flush()
  const frame = setup.captureCharFrame()
  expect(frame).toContain("600 tokens")
})
