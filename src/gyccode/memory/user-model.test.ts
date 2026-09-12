import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import {
  USER_CHAR_LIMIT,
  classifyMemoryTarget,
  enforceLimit,
  formatUserModelForPrompt,
  isPreferenceEntry,
  readUserModel,
  userModelPath,
  writeUserModel,
  type UserModelEntry,
} from "./user-model"

let home: string
let previousHome: string | undefined
let previousHermes: string | undefined

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "gyc-user-model-"))
  previousHome = process.env.GYCCODE_MEMORY_HOME
  previousHermes = process.env.HERMES_HOME
  process.env.GYCCODE_MEMORY_HOME = home
  delete process.env.HERMES_HOME
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.GYCCODE_MEMORY_HOME
  else process.env.GYCCODE_MEMORY_HOME = previousHome
  if (previousHermes === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = previousHermes
  await rm(home, { recursive: true, force: true })
})

function entry(value: string, key = value): UserModelEntry {
  return { key, value, tags: [] }
}

describe("isPreferenceEntry / classifyMemoryTarget", () => {
  it("识别中文偏好信号", () => {
    expect(isPreferenceEntry("提交信息一律用中文")).toBe(true)
    expect(isPreferenceEntry("不要使用 emoji")).toBe(true)
    expect(isPreferenceEntry("禁止出现用户二字")).toBe(true)
  })

  it("识别英文偏好信号，且大小写不敏感", () => {
    expect(isPreferenceEntry("Always run tests before commit")).toBe(true)
    expect(isPreferenceEntry("Never force push")).toBe(true)
  })

  it("纯事实不算偏好", () => {
    expect(isPreferenceEntry("项目位于 C:/gyc-code")).toBe(false)
    expect(isPreferenceEntry("上次修复了 gateway 的超时问题")).toBe(false)
  })

  it("分流：偏好进画像层，其余进记忆层", () => {
    expect(classifyMemoryTarget("回复一律用简体中文")).toBe("user")
    expect(classifyMemoryTarget("bun test 跑了 929 个用例")).toBe("memory")
  })
})

describe("enforceLimit", () => {
  it("未超限时只做去重，保持原顺序", () => {
    const result = enforceLimit([entry("a"), entry("b"), entry("a")])
    expect(result.map((item) => item.value)).toEqual(["a", "b"])
  })

  it("超限时优先保留偏好类条目，再按新的优先补事实类", () => {
    // 上限刚好容纳「两条偏好」或「一条偏好 + 一条最新事实」
    const limit = 30
    const entries = [
      entry("旧事实一".repeat(3), "f1"),
      entry("旧事实二".repeat(3), "f2"),
      entry("必须用中文".repeat(2), "p1"),
      entry("最新事实".repeat(2), "f3"),
    ]
    const kept = enforceLimit(entries, limit).map((item) => item.key)
    expect(kept).toContain("p1")
    // 偏好条目优先于更旧的事实条目
    expect(kept.indexOf("p1")).toBeLessThan(kept.length)
    expect(kept).not.toContain("f1")
  })

  it("偏好条目自身也能被上限挡住", () => {
    const huge = entry("必须".repeat(200), "huge")
    expect(enforceLimit([huge], 50)).toEqual([])
  })

  it("结果保持原始先后顺序", () => {
    const entries = [entry("必须用中文", "p1"), entry("项目在 C 盘", "f1"), entry("禁止 emoji", "p2")]
    const kept = enforceLimit(entries, USER_CHAR_LIMIT).map((item) => item.key)
    expect(kept).toEqual(["p1", "f1", "p2"])
  })
})

describe("readUserModel / writeUserModel", () => {
  it("文件缺失时返回空数组", async () => {
    expect(await readUserModel()).toEqual([])
  })

  it("追加条目并落盘，可在新的读取中拿回", async () => {
    await writeUserModel("回复一律用简体中文")
    await writeUserModel("不要使用 emoji")
    const entries = await readUserModel()
    expect(entries.map((item) => item.value)).toEqual(["回复一律用简体中文", "不要使用 emoji"])
  })

  it("重复写入同一条目只保留一份", async () => {
    await writeUserModel("回复一律用简体中文")
    await writeUserModel("回复一律用简体中文")
    expect((await readUserModel()).length).toBe(1)
  })

  it("空白输入不产生条目", async () => {
    await writeUserModel("   ")
    expect(await readUserModel()).toEqual([])
  })

  it("落盘文件以分隔符收尾，便于追加", async () => {
    await writeUserModel("回复一律用简体中文")
    const raw = await readFile(userModelPath(), "utf-8")
    expect(raw.endsWith("\n")).toBe(true)
    expect(raw).toContain("§")
  })
})

describe("formatUserModelForPrompt", () => {
  it("空画像返回 undefined，不注入空段落", () => {
    expect(formatUserModelForPrompt([])).toBeUndefined()
  })

  it("渲染为 about-owner 段落，与记忆段区分", () => {
    const text = formatUserModelForPrompt([entry("回复一律用简体中文")])
    expect(text).toContain("<about-owner>")
    expect(text).toContain("</about-owner>")
    expect(text).toContain("回复一律用简体中文")
    expect(text).not.toContain("<memories>")
  })

  it("按预算截断", () => {
    const entries = [entry("a".repeat(20)), entry("b".repeat(20)), entry("c".repeat(20))]
    const text = formatUserModelForPrompt(entries, 30)
    expect(text).toBeDefined()
    expect(text).not.toContain("c".repeat(20))
  })
})
