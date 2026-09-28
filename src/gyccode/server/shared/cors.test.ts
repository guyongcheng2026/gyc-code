import { describe, expect, test } from "bun:test"
import { isAllowedCorsOrigin, isAllowedRequestOrigin } from "./cors"

describe("isAllowedCorsOrigin", () => {
  test("no Origin header (non-browser) is allowed", () => {
    expect(isAllowedCorsOrigin(undefined)).toBe(true)
    expect(isAllowedCorsOrigin("")).toBe(true)
  })

  test("arbitrary loopback port is NOT allowed cross-origin by default", () => {
    expect(isAllowedCorsOrigin("http://localhost:5173")).toBe(false)
    expect(isAllowedCorsOrigin("http://127.0.0.1:3000")).toBe(false)
    expect(isAllowedCorsOrigin("http://[::1]:8080")).toBe(false)
  })

  test("attacker-controlled origins are denied by default", () => {
    expect(isAllowedCorsOrigin("http://evil.example")).toBe(false)
    expect(isAllowedCorsOrigin("https://gyccode.ai.evil.com")).toBe(false)
  })

  test("explicit cors option allows declared origin", () => {
    const opts = { cors: ["http://localhost:5173"] }
    expect(isAllowedCorsOrigin("http://localhost:5173", opts)).toBe(true)
    expect(isAllowedCorsOrigin("http://localhost:4000", opts)).toBe(false)
  })

  test("known first-party origins remain allowed", () => {
    expect(isAllowedCorsOrigin("oc://renderer")).toBe(true)
    expect(isAllowedCorsOrigin("tauri://localhost")).toBe(true)
    expect(isAllowedCorsOrigin("http://tauri.localhost")).toBe(true)
    expect(isAllowedCorsOrigin("https://gyccode.ai")).toBe(true)
    expect(isAllowedCorsOrigin("https://app.gyccode.ai")).toBe(true)
  })
})

describe("isAllowedRequestOrigin (same-origin via Host header)", () => {
  test("same-origin loopback requests pass regardless of port", () => {
    expect(isAllowedRequestOrigin("http://127.0.0.1:5173", "127.0.0.1:5173")).toBe(true)
    expect(isAllowedRequestOrigin("http://localhost:4099", "localhost:4099")).toBe(true)
    expect(isAllowedRequestOrigin("http://[::1]:8080", "[::1]:8080")).toBe(true)
  })

  test("same-origin default ports pass (Origin/Host omit :80)", () => {
    expect(isAllowedRequestOrigin("http://localhost", "localhost")).toBe(true)
  })

  test("cross-origin loopback (different port) denied without explicit cors", () => {
    expect(isAllowedRequestOrigin("http://localhost:5173", "localhost:4099")).toBe(false)
  })

  test("cross-origin denied even when origin equals another host's loopback name", () => {
    expect(isAllowedRequestOrigin("http://127.0.0.1:5173", "localhost:5173")).toBe(false)
  })

  test("no Origin header is allowed", () => {
    expect(isAllowedRequestOrigin(undefined, "localhost:5173")).toBe(true)
  })

  test("malformed Origin does not throw and falls back to cors check", () => {
    expect(isAllowedRequestOrigin("not a url", "localhost:5173")).toBe(false)
    expect(isAllowedRequestOrigin("not a url", undefined)).toBe(false)
  })
})
