import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const src = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8")

/**
 * P0-2（对标指标 8 · Git 集成）：此前 snapshot 影子仓库只 write-tree，存的是
 * 裸 tree 对象——没有 commit、没有父子关系、没有 message。tree 能支撑
 * 「本轮改了什么」的 diff，却撑不起「一整轮任务」这个粒度的回退。
 *
 * 这里锁的是**设计约束**而非 git 行为（git 行为由真实 git 保证）：
 * 影子仓库与用户真实仓库通过 alternates 共享 objects，任何移动 HEAD 或
 * 分支指针的操作都会污染用户仓库，所以实现必须走 commit-tree + 独立 ref。
 *
 * 读源码文本做断言看着别扭，但这条约束一旦破例后果是跨仓库污染，
 * 而它又无法用纯函数测试覆盖——故保留，并在注释里说明取舍。
 */
const slice = (from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to))

describe("P0-2 影子仓库任务历史的设计约束", () => {
  it("任务历史存在独立 ref 上，不是 HEAD 也不是分支", () => {
    const line = src.split("\n").find((l) => l.includes("const TASK_REF"))
    expect(line).toBeDefined()
    expect(line).toContain("refs/gyc/task")
    expect(line).not.toContain("refs/heads")
  })

  it("commit 走 commit-tree 构造对象", () => {
    expect(slice("const commit =", "const history =")).toContain("commit-tree")
  })

  it("commit 内不出现会移动 HEAD 或分支指针的命令", () => {
    const body = slice("const commit =", "const history =")
    expect(body).not.toContain("checkout")
    expect(body).not.toContain("reset")
    expect(body).not.toContain("branch ")
  })

  it("回退只改工作区与索引，不做 hard reset", () => {
    const body = slice("const revertToCommit =", "const diffFull =")
    expect(body).toContain("checkout")
    expect(body).not.toContain("reset --hard")
  })

  it("history 在 ref 尚未建立时返回空数组而非报错", () => {
    expect(slice("const history =", "const revertToCommit =")).toContain("if (result.code !== 0) return []")
  })

  it("无变更或空 message 时不制造空提交", () => {
    const body = slice("const commit =", "const history =")
    expect(body).toContain("if (!changed)")
    expect(body).toContain("message.trim()")
  })

  it("history 的分隔符与 git 输出格式一致（都用 unit separator）", () => {
    const body = slice("const history =", "const revertToCommit =")
    expect(body).toContain("%x1f")
    expect(body).toContain("FIELD_SEP")
  })
})