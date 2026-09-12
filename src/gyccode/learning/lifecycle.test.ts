import { describe, expect, it } from "bun:test"
import { DEFAULT_LIFECYCLE_CONFIG, planTransitions } from "./lifecycle"
import type { SkillUsageEntry, SkillUsageTable } from "./usage"

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000

function entry(overrides: Partial<SkillUsageEntry> = {}): SkillUsageEntry {
  return {
    origin: "agent",
    state: "active",
    pinned: false,
    useCount: 1,
    viewCount: 1,
    patchCount: 0,
    createdAt: NOW,
    lastActivityAt: NOW,
    ...overrides,
  }
}

describe("planTransitions", () => {
  it("pinned 技能无论闲置多久都不产生转换", () => {
    const usage: SkillUsageTable = {
      "pinned-skill": entry({ pinned: true, lastActivityAt: NOW - 365 * DAY }),
    }
    expect(planTransitions(usage, { now: NOW })).toEqual([])
  })

  it("闲置超过 archiveAfterDays 转为 archived", () => {
    const usage: SkillUsageTable = { "old-skill": entry({ lastActivityAt: NOW - 100 * DAY }) }
    expect(planTransitions(usage, { now: NOW })).toEqual([{ name: "old-skill", to: "archived" }])
  })

  it("闲置介于两个阈值之间转为 stale", () => {
    const usage: SkillUsageTable = { "warm-skill": entry({ lastActivityAt: NOW - 45 * DAY }) }
    expect(planTransitions(usage, { now: NOW })).toEqual([{ name: "warm-skill", to: "stale" }])
  })

  it("活跃技能不产生任何转换", () => {
    const usage: SkillUsageTable = { "fresh-skill": entry({ lastActivityAt: NOW - DAY }) }
    expect(planTransitions(usage, { now: NOW })).toEqual([])
  })

  it("从未被用过但在宽限期内不转换", () => {
    const usage: SkillUsageTable = {
      "brand-new": entry({
        useCount: 0,
        viewCount: 0,
        createdAt: NOW - 10 * DAY,
        lastActivityAt: NOW - 10 * DAY,
      }),
    }
    expect(planTransitions(usage, { now: NOW })).toEqual([])
  })

  it("从未被用过且已超出宽限期转为 stale", () => {
    const usage: SkillUsageTable = {
      "never-used": entry({
        useCount: 0,
        viewCount: 0,
        createdAt: NOW - 40 * DAY,
        lastActivityAt: NOW - 40 * DAY,
      }),
    }
    expect(planTransitions(usage, { now: NOW })).toEqual([{ name: "never-used", to: "stale" }])
  })

  it("已归档但近期有活动则重新激活", () => {
    const usage: SkillUsageTable = {
      "revived": entry({ state: "archived", lastActivityAt: NOW - 5 * DAY }),
    }
    expect(planTransitions(usage, { now: NOW })).toEqual([{ name: "revived", to: "active" }])
  })

  it("目标状态与当前一致时不产生转换", () => {
    const usage: SkillUsageTable = {
      "already-stale": entry({ state: "stale", lastActivityAt: NOW - 45 * DAY }),
      "already-archived": entry({ state: "archived", lastActivityAt: NOW - 200 * DAY }),
    }
    expect(planTransitions(usage, { now: NOW })).toEqual([])
  })

  it("返回结果按 name 排序，保证同输入同输出", () => {
    const usage: SkillUsageTable = {
      "zeta-skill": entry({ lastActivityAt: NOW - 100 * DAY }),
      "alpha-skill": entry({ lastActivityAt: NOW - 100 * DAY }),
      "mid-skill": entry({ lastActivityAt: NOW - 100 * DAY }),
    }
    expect(planTransitions(usage, { now: NOW }).map((item) => item.name)).toEqual([
      "alpha-skill",
      "mid-skill",
      "zeta-skill",
    ])
  })

  it("可覆盖默认阈值", () => {
    const usage: SkillUsageTable = { "short-lived": entry({ lastActivityAt: NOW - 2 * DAY }) }
    const config = { staleAfterDays: 1, archiveAfterDays: 3 }
    expect(planTransitions(usage, { now: NOW, config })).toEqual([{ name: "short-lived", to: "stale" }])
  })

  it("默认阈值为 30 天与 90 天", () => {
    expect(DEFAULT_LIFECYCLE_CONFIG.staleAfterDays).toBe(30)
    expect(DEFAULT_LIFECYCLE_CONFIG.archiveAfterDays).toBe(90)
  })
})
