import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@gyccode/core/v1/session"
import { injectComposeReminder } from "./reminders"
import PROMPT_COMPOSE from "./prompt/compose.txt"

const text = (value: string) => ({
  id: `part_${Math.random().toString(36).slice(2)}`,
  messageID: "msg_1",
  sessionID: "ses_1",
  type: "text",
  text: value,
})

const userMessage = (agent: string, parts: unknown[] = [text("hello")]): SessionV1.WithParts =>
  ({
    info: {
      id: `msg_${Math.random().toString(36).slice(2)}`,
      sessionID: "ses_1",
      role: "user",
      agent,
      time: { created: Date.now() },
      model: { providerID: "test", modelID: "test" },
    },
    parts,
  }) as unknown as SessionV1.WithParts

const first = (messages: SessionV1.WithParts[]): SessionV1.WithParts => {
  const msg = messages[0]
  if (!msg) throw new Error("expected at least one message")
  return msg
}

const syntheticTexts = (msg: SessionV1.WithParts): string[] =>
  msg.parts.flatMap((p) =>
    p.type === "text" && p.synthetic === true && typeof p.text === "string" ? [p.text] : [],
  )

describe("injectComposeReminder", () => {
  test("prepends the compose system prompt to the first compose user message", () => {
    const messages = [userMessage("compose")]
    injectComposeReminder(messages)
    const msg = first(messages)
    const injected = syntheticTexts(msg)
    expect(injected).toHaveLength(1)
    expect(injected[0]?.startsWith(PROMPT_COMPOSE)).toBe(true)
    const head = msg.parts[0]
    expect(head?.type).toBe("text")
    expect(head && "synthetic" in head ? head.synthetic : false).toBe(true)
    expect(msg.parts).toHaveLength(2)
  })

  test("includes the compose_skills block when skills are enabled", () => {
    const messages = [userMessage("compose")]
    delete process.env.GYCCODE_DISABLE_COMPOSE_SKILLS
    injectComposeReminder(messages)
    const head = first(messages).parts[0]
    expect(head && "text" in head ? head.text : "").toContain("<compose_skills>")
  })

  test("is idempotent: running twice does not accumulate copies", () => {
    const messages = [userMessage("compose")]
    injectComposeReminder(messages)
    injectComposeReminder(messages)
    const msg = first(messages)
    expect(syntheticTexts(msg)).toHaveLength(1)
    expect(msg.parts).toHaveLength(2)
  })

  test("leaves non-compose user messages untouched", () => {
    const messages = [userMessage("build")]
    injectComposeReminder(messages)
    const msg = first(messages)
    expect(syntheticTexts(msg)).toHaveLength(0)
    expect(msg.parts).toHaveLength(1)
  })

  test("no-op when there are no user messages", () => {
    const messages: SessionV1.WithParts[] = []
    expect(() => injectComposeReminder(messages)).not.toThrow()
    expect(messages).toHaveLength(0)
  })

  test("injects only into the first compose user message", () => {
    const firstMsg = userMessage("compose")
    const secondMsg = userMessage("compose")
    injectComposeReminder([firstMsg, secondMsg])
    expect(syntheticTexts(firstMsg)).toHaveLength(1)
    expect(syntheticTexts(secondMsg)).toHaveLength(0)
  })
})
