import { expect, test } from "bun:test"
import { isStalledToolOnlyStep, stableStringify, toolSignatures } from "./tool-stall"

const tool = (name: string, status: string, input: Record<string, unknown>, type = "tool") => ({
  type,
  tool: name,
  state: { status, input },
})
const text = (synthetic = false) => ({ type: "text", synthetic })

test("stableStringify sorts keys and recurses", () => {
  expect(stableStringify({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}')
  expect(stableStringify(undefined)).toBe("undefined")
})

test("toolSignatures returns tool + stable input", () => {
  const sigs = toolSignatures([tool("read", "completed", { filePath: "/a" }), tool("read", "completed", { filePath: "/b" })])
  expect(sigs).toEqual(['read:{"filePath":"/a"}', 'read:{"filePath":"/b"}'])
})

test("正常工具轮（无文本、无失败、不重复）不算空转 —— 本次误杀场景", () => {
  const parts = [tool("read", "completed", { filePath: "/a" }), tool("bash", "completed", { command: "pwd" })]
  expect(isStalledToolOnlyStep({ finish: "tool-calls", parts, historySignatures: new Set() })).toBe(false)
})

test("有可见文本的工具轮不算空转", () => {
  const parts = [text(), tool("read", "error", { filePath: "/a" })]
  expect(isStalledToolOnlyStep({ finish: "tool-calls", parts, historySignatures: new Set() })).toBe(false)
})

test("synthetic 文本不算可见文本，仍可判定空转", () => {
  const parts = [text(true), tool("read", "error", { filePath: "/a" })]
  expect(isStalledToolOnlyStep({ finish: "tool-calls", parts, historySignatures: new Set() })).toBe(true)
})

test("工具失败/未完成计为空转", () => {
  const parts = [tool("bash", "error", { command: "x" })]
  expect(isStalledToolOnlyStep({ finish: "tool-calls", parts, historySignatures: new Set() })).toBe(true)
  const pending = [tool("bash", "pending", { command: "x" })]
  expect(isStalledToolOnlyStep({ finish: "tool-calls", parts: pending, historySignatures: new Set() })).toBe(true)
})

test("工具与历史完全重复计为空转", () => {
  const parts = [tool("bash", "completed", { command: "git status" })]
  const history = new Set(toolSignatures(parts))
  expect(isStalledToolOnlyStep({ finish: "tool-calls", parts, historySignatures: history })).toBe(true)
})

test("部分重复但存在新工具不算空转", () => {
  const repeat = [tool("bash", "completed", { command: "git status" })]
  const parts = [tool("bash", "completed", { command: "git status" }), tool("read", "completed", { filePath: "/new" })]
  const history = new Set(toolSignatures(repeat))
  expect(isStalledToolOnlyStep({ finish: "tool-calls", parts, historySignatures: history })).toBe(false)
})

test("finish 非 tool-calls 不算空转", () => {
  const parts = [tool("bash", "error", { command: "x" })]
  expect(isStalledToolOnlyStep({ finish: "stop", parts, historySignatures: new Set() })).toBe(false)
})

test("无工具调用轮不算空转", () => {
  expect(isStalledToolOnlyStep({ finish: "tool-calls", parts: [], historySignatures: new Set() })).toBe(false)
})
