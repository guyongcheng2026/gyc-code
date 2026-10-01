import { describe, expect, it } from "bun:test"
import { destructiveGuard } from "./git"

/**
 * P0-3（对标指标 8 · Git 集成）：模型此前没有 git 工具，只能靠 shell 敲命令。
 *
 * 这里只测**破坏性操作的放行判定**——它是纯函数，刻意从 Effect 里抽出来：
 * 「删分支要 force、pop 暂存要 force」一旦被绕过，丢的是未合并的提交，
 * 这种安全约定不该只靠跑通真实仓库的集成测试来兜底。
 * 参数转发与 git 调用本身由 Git.Service 负责，不在本文件范围。
 */
describe("git 工具破坏性操作守卫", () => {
  it("删除分支：未传 force 时拒绝，并说明后果与补救方式", () => {
    const reason = destructiveGuard("delete", "feature-x", undefined)
    expect(reason).not.toBeNull()
    // 理由必须让模型知道「下一步怎么做」，否则它会反复重试同一个调用
    expect(reason).toContain("force=true")
    expect(reason).toContain("feature-x")
  })

  it("删除分支：force=false 不算显式确认（不能靠传 false 绕过）", () => {
    expect(destructiveGuard("delete", "feature-x", false)).not.toBeNull()
  })

  it("删除分支：force=true 才放行", () => {
    expect(destructiveGuard("delete", "feature-x", true)).toBeNull()
  })

  it("删除分支：没给分支名时先报缺参，而不是拿 undefined 去删", () => {
    const reason = destructiveGuard("delete", undefined, true)
    expect(reason).toContain("name")
  })

  it("stash pop：未传 force 时拒绝（可能与工作区冲突）", () => {
    const reason = destructiveGuard("pop", undefined, undefined)
    expect(reason).not.toBeNull()
    expect(reason).toContain("force=true")
  })

  it("stash pop：force=true 才放行", () => {
    expect(destructiveGuard("pop", undefined, true)).toBeNull()
  })

  it("非破坏性操作不受 force 约束", () => {
    expect(destructiveGuard("list", undefined, undefined)).toBeNull()
    expect(destructiveGuard("push", undefined, undefined)).toBeNull()
    expect(destructiveGuard("create", "new-thing", undefined)).toBeNull()
    expect(destructiveGuard("switch", "main", undefined)).toBeNull()
  })

  it("create/switch 缺 name 时拦截——否则会拿 undefined 当分支名传给 git", () => {
    expect(destructiveGuard("create", undefined, undefined)).toContain("name")
    expect(destructiveGuard("switch", undefined, undefined)).toContain("name")
  })
})