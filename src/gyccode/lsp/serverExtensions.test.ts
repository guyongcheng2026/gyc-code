import { describe, test, expect } from "bun:test"
import { SourceKit } from "./server"

describe("LSP SourceKit extensions", () => {
  test("all SourceKit extensions are dot-prefixed", () => {
    expect(SourceKit.extensions.every((ext) => ext.startsWith("."))).toBe(true)
  })

  test("SourceKit includes .objcpp", () => {
    expect(SourceKit.extensions).toContain(".objcpp")
  })
})