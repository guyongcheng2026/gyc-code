// location-guard.ts 路径穿越防护回归测试（等保三级 · 访问控制）
// 未配置 GYCCODE_SERVER_ROOTS 时保持既有行为（放行任意目录，单用户本机开发）；
// 配置后必须拒绝越界目录与 ../ 穿越。
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { guardDirectory } from "./location-guard"

const originalRoots = process.env.GYCCODE_SERVER_ROOTS

let base: string
let allowedRoot: string
let outsideDir: string

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "gyc-loc-")))
  allowedRoot = join(base, "allowed")
  outsideDir = join(base, "outside")
  mkdirSync(allowedRoot)
  mkdirSync(outsideDir)
  process.env.GYCCODE_SERVER_ROOTS = allowedRoot
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
  if (originalRoots === undefined) delete process.env.GYCCODE_SERVER_ROOTS
  else process.env.GYCCODE_SERVER_ROOTS = originalRoots
})

describe("location 目录白名单", () => {
  it("未配置白名单时放行（保持本机开发既有行为）", () => {
    delete process.env.GYCCODE_SERVER_ROOTS
    expect(guardDirectory(outsideDir)).toBe(outsideDir)
  })

  it("白名单内目录放行", () => {
    expect(guardDirectory(allowedRoot)).toBe(allowedRoot)
  })

  it("白名单外目录拒绝", () => {
    expect(() => guardDirectory(outsideDir)).toThrow(/not permitted/)
  })

  it("../ 穿越到白名单外被拒绝", () => {
    expect(() => guardDirectory(join(allowedRoot, "..", "outside"))).toThrow(/not permitted/)
  })

  it("白名单内子目录放行", () => {
    const child = join(allowedRoot, "sub", "deep")
    expect(guardDirectory(child)).toBe(child)
  })

  it("多根白名单（分号分隔）中任一根均可", () => {
    process.env.GYCCODE_SERVER_ROOTS = `${allowedRoot};${outsideDir}`
    expect(guardDirectory(outsideDir)).toBe(outsideDir)
  })

  it("相邻前缀目录不放行（startsWith 边界穿越）", () => {
    // 白名单是 .../allowed，若用朴素 startsWith，.../allowed-secret 会被误放行
    const sibling = join(base, "allowed-secret")
    mkdirSync(sibling)
    expect(() => guardDirectory(sibling)).toThrow(/not permitted/)
  })

  it("空白白名单项被忽略，不误放行", () => {
    process.env.GYCCODE_SERVER_ROOTS = `  ; ${allowedRoot} ;`
    expect(() => guardDirectory(outsideDir)).toThrow(/not permitted/)
  })
})
