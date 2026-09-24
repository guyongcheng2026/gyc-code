// T1 token 优化：plan 裁剪集 → Permission.disabled 链路回归防护。
// 断言 agent.ts plan 定义所用的 PLAN_PRUNED_TOOLS 配 *:deny 后全部被
// resolveTools 链路（Permission.disabled）从 tool schema 去除，且只读工具
// 与 edit 族（plans/*.md 写入能力）不受影响。
import { describe, expect, test } from "bun:test"
import { PLAN_PRUNED_TOOLS } from "./plan-tools"
import { disabled, fromConfig } from "../permission"

describe("PLAN_PRUNED_TOOLS（plan 只读裁剪集）", () => {
  const rules = fromConfig(Object.fromEntries(PLAN_PRUNED_TOOLS.map((key) => [key, "deny"])))
  const all = [
    ...PLAN_PRUNED_TOOLS,
    "read",
    "glob",
    "grep",
    "edit",
    "write",
    "apply_patch",
    "task",
    "plan_enter",
    "plan_exit",
    "webfetch",
  ]
  const cut = disabled(all, rules)

  test("裁剪集全部命中 disabled → 不进 tool schema", () => {
    for (const id of PLAN_PRUNED_TOOLS) expect(cut.has(id)).toBe(true)
  })

  test("只读工具与 edit 族不受影响（保留 plans/*.md 写入）", () => {
    for (const id of ["read", "glob", "grep", "task", "plan_enter", "plan_exit", "webfetch"]) {
      expect(cut.has(id)).toBe(false)
    }
    for (const id of ["edit", "write", "apply_patch"]) expect(cut.has(id)).toBe(false)
  })
})
