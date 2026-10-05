import { describe, expect, it } from "bun:test"
import { checkSource } from "./check-bug-patterns.mjs"

describe("check-bug-patterns 规则 A：空 catch", () => {
  it("detects a bare empty catch", () => {
    expect(checkSource("try { f() } catch {}").some((h) => h.includes("empty catch"))).toBe(true)
  })

  it("detects a cross-line empty catch", () => {
    expect(checkSource("try {\n  f()\n} catch (e) {\n}").some((h) => h.includes("empty catch"))).toBe(true)
  })

  it("does not flag a catch that explains itself in a comment", () => {
    const src = `try {\n  f()\n} catch {\n  // 可忽略：force:true 下失败即文件已不存在\n}`
    expect(checkSource(src).some((h) => h.includes("empty catch"))).toBe(false)
  })

  it("does not flag a catch with a real statement", () => {
    expect(checkSource("try { f() } catch (e) { logError(e) }").some((h) => h.includes("empty catch"))).toBe(false)
  })
})

describe("check-bug-patterns 规则 C：空 catch 回调", () => {
  it("detects .catch(() => {})", () => {
    expect(checkSource("void p.catch(() => {})").some((h) => h.includes("空 catch 回调"))).toBe(true)
  })

  it("detects multi-line .catch(() => {})", () => {
    expect(checkSource("void p\n  .catch(() => {})\n").some((h) => h.includes("空 catch 回调"))).toBe(true)
  })

  it("detects .catch(function () {})", () => {
    expect(checkSource("void p.catch(function () {})").some((h) => h.includes("空 catch 回调"))).toBe(true)
  })

  it("does not flag a catch callback that explains itself", () => {
    const src = "void p.catch(() => {\n  // 可忽略（纯诊断旁路）：诊断日志写失败不影响主流程\n})"
    expect(checkSource(src).some((h) => h.includes("空 catch 回调"))).toBe(false)
  })

  it("does not flag a catch callback with a statement", () => {
    expect(checkSource('void p.catch((e) => logError("x", e))').some((h) => h.includes("空 catch 回调"))).toBe(false)
  })

  it("does not flag a non-empty arrow body on one line", () => {
    expect(checkSource("void p.catch(() => undefined)").some((h) => h.includes("空 catch 回调"))).toBe(false)
  })
})

describe("check-bug-patterns 规则 B：空壳自递归", () => {
  it("detects a self-recursive no-op function", () => {
    const src = "function getMemoryDir() {\n  return getMemoryDir()\n}"
    expect(checkSource(src).some((h) => h.includes("空壳自递归"))).toBe(true)
  })

  it("does not flag a normal recursive function", () => {
    const src = "function walk(n) {\n  if (n > 0) walk(n - 1)\n}"
    expect(checkSource(src).some((h) => h.includes("空壳自递归"))).toBe(false)
  })
})