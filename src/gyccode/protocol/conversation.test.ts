import { expect, test } from "bun:test"
import {
  convertRequest,
  type Conversation,
  type ResponseFormat,
  type ConversionOptions,
} from "./conversation"

test("convertRequest handles MessagesRequest", () => {
  const input = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ],
  }
  const result = convertRequest(input) as Conversation
  expect(result.messages).toHaveLength(3)
  expect(result.messages[0]!.role).toBe("system")
  expect(result.messages[0]!.content).toEqual([{ type: "text", text: "You are a helpful assistant" }])
  expect(result.messages[1]!.role).toBe("user")
  expect(result.messages[2]!.role).toBe("assistant")
  expect(result.format).toEqual({ type: "text" })
})

test("convertRequest handles ChatCompletionsRequest with json_schema", () => {
  const input = {
    model: "deepseek-chat",
    messages: [{ role: "user", content: "Extract name" }],
    response_format: { type: "json_schema", json_schema: { type: "object", properties: { name: { type: "string" } } } },
  }
  const result = convertRequest(input) as Conversation
  expect(result.format).toEqual({
    type: "json_schema",
    schema: { type: "object", properties: { name: { type: "string" } } },
  })
  expect(result.messages[0]!.role).toBe("user")
})

test("convertRequest handles ResponsesRequest", () => {
  const input = {
    model: "deepseek-chat",
    input: "What is 2+2?",
    text: { format: { type: "text" } },
  }
  const result = convertRequest(input) as Conversation
  expect(result.messages).toHaveLength(1)
  expect(result.messages[0]!.role).toBe("user")
  expect(result.messages[0]!.content).toEqual([{ type: "text", text: "What is 2+2?" }])
  expect(result.format).toEqual({ type: "text" })
})

test("convertRequest handles ACP PromptRequest", () => {
  const input = {
    sessionId: "sess-123",
    messageId: "msg-456",
    prompt: [
      { type: "text", text: "Hello from ACP" },
      { type: "text", text: "Second block" },
    ],
  }
  const result = convertRequest(input) as Conversation
  expect(result.messages).toHaveLength(1)
  expect(result.messages[0]!.role).toBe("user")
  expect(result.messages[0]!.content).toEqual([
    { type: "text", text: "Hello from ACP" },
    { type: "text", text: "Second block" },
  ])
})

test("convertRequest replaces DeepSeek V4 image with placeholder", () => {
  const input = {
    sessionId: "sess-123",
    prompt: [
      { type: "image", data: "base64data", mimeType: "image/png", uri: null },
      { type: "text", text: "Describe this" },
    ],
  }
  const result = convertRequest(input, { deepSeekV4: true }) as Conversation
  expect(result.messages[0]!.content).toEqual([
    { type: "text", text: "[Unsupported Image]" },
    { type: "text", text: "Describe this" },
  ])
})

test("convertRequest preserves image for non-V4", () => {
  const input = {
    sessionId: "sess-123",
    prompt: [{ type: "image", data: "base64data", mimeType: "image/png" }],
  }
  const result = convertRequest(input) as Conversation
  expect(result.messages[0]!.content).toEqual([
    { type: "image", data: "base64data", mimeType: "image/png" },
  ])
})

test("convertRequest returns empty conversation for unknown input", () => {
  const result = convertRequest("not a request") as Conversation
  expect(result.messages).toEqual([])
  expect(result.format).toEqual({ type: "text" })
})
