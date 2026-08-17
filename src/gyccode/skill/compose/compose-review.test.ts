import { describe, expect, test } from "bun:test"
import { COMPOSE_BUNDLE as bundle } from "./bundle.gen"

// fork 自 MiMo Code compose-review.test.ts（2026-08-17），品牌与加载方式本地化。
// 契约：spec 锚点、两阶段结构化 spec 审查、intent 注入、actor 派发词汇表。
// 防止未来与上游同步 compose 技能包时退化。

describe("compose spec-anchored review contract", () => {
  describe("Task 1: spec section anchors (brainstorm)", () => {
    test("brainstorm SKILL instructs anchor assignment", () => {
      const md = bundle["brainstorm"]["SKILL.md"]
      expect(md).toContain("Spec Section Anchors")
      expect(md).toMatch(/\[S1\]/)
    })

    test("spec-document reviewer checks anchors are present and unique", () => {
      const md = bundle["brainstorm"]["spec-document-reviewer-prompt.md"]
      expect(md).toContain("Anchors")
      expect(md).toMatch(/unique/i)
    })
  })

  describe("Task 2: plan covers field + coverage matrix", () => {
    test("plan SKILL task structure has a Covers field", () => {
      const md = bundle["plan"]["SKILL.md"]
      expect(md).toContain("**Covers:**")
    })

    test("plan SKILL self-review includes a spec-coverage check", () => {
      const md = bundle["plan"]["SKILL.md"]
      expect(md).toMatch(/Covers:.*resolve to a real spec section/is)
    })

    test("plan-document reviewer builds a spec-coverage matrix", () => {
      const md = bundle["plan"]["plan-document-reviewer-prompt.md"]
      expect(md).toContain("Spec Coverage")
      expect(md).toMatch(/matrix/i)
    })
  })

  describe("Task 3: implementer intent injection", () => {
    test("implementer prompt has an Intent section", () => {
      const md = bundle["subagent"]["implementer-prompt.md"]
      expect(md).toContain("## Intent (from spec)")
    })

    test("implementer prompt states a scope boundary", () => {
      const md = bundle["subagent"]["implementer-prompt.md"]
      expect(md).toContain("Scope boundary")
      expect(md).toMatch(/do NOT build other claims/i)
    })
  })

  describe("Task 4: two-phase structured spec reviewer", () => {
    const md = () => bundle["subagent"]["spec-reviewer-prompt.md"]

    test("defines a two-phase protocol", () => {
      expect(md()).toContain("Phase 1")
      expect(md()).toContain("Phase 2")
    })

    test("phase 1 excludes the implementer report", () => {
      expect(md()).toMatch(/no implementer report/i)
    })

    test("phase 2 cannot add passes, only downgrade", () => {
      expect(md()).toMatch(/cannot.*(add|manufacture).*pass/i)
      expect(md()).toMatch(/cannot upgrade.*fail.*pass/is)
      // 防自相矛盾的逃生口：phase 2 不得允许"无新证据"的 fail→pass 升级
      //（那属于 phase-1 重审的职责）。
      expect(md()).not.toMatch(/upgrade a[\s\S]*?pass[\s\S]*?without fresh evidence/i)
    })

    test("returns structured per-claim verdicts keyed to anchors", () => {
      expect(md()).toContain("in-scope")
      expect(md()).toContain("out-of-scope-for-this-task")
    })

    test("requires verifiable evidence; status without evidence fails", () => {
      expect(md()).toContain("evidence")
      expect(md()).toMatch(/file:line/)
      expect(md()).toContain("unverifiable")
    })
  })

  describe("Task 5: subagent orchestration (gate + two-phase + intent)", () => {
    const md = () => bundle["subagent"]["SKILL.md"]

    test("orchestration injects covered spec text as intent", () => {
      expect(md()).toContain("Intent (from spec)")
    })

    test("orchestration runs spec review in two phases", () => {
      expect(md()).toMatch(/phase 1/i)
      expect(md()).toMatch(/phase 2/i)
    })

    test("defines a completion gate on the structured verdict", () => {
      expect(md()).toMatch(/gate/i)
      expect(md()).toContain("unverifiable")
    })

    test("advises reviewer model tier >= implementer", () => {
      expect(md()).toMatch(/reviewer.*tier|tier.*reviewer/i)
    })
  })

  describe("Task 6: final reviewer anchor-keying", () => {
    test("code reviewer references spec anchors in plan alignment", () => {
      const md = bundle["review"]["code-reviewer.md"]
      expect(md).toMatch(/\[Sn\]|spec anchor/i)
    })
  })

  describe("dispatch vocabulary uses gyc-code's actor tool, not Claude Code's", () => {
    test("no bundle file uses Claude Code's 'Task tool' / 'general-purpose' phrasing", () => {
      const offenders = Object.entries(bundle).flatMap(([skill, files]) =>
        Object.entries(files)
          .filter(([, content]) => /Task tool|Task Tool|general-purpose|general_purpose/.test(content))
          .map(([rel]) => `${skill}/${rel}`),
      )
      expect(offenders).toEqual([])
    })

    test("dispatch templates name the real actor tool + general subagent type", () => {
      // 派发子代理的 reviewer/implementer 模板应在正文中点名 `actor` 工具与
      // `general` 子代理类型——且不得内嵌 actor 的调用语法（operation/
      // discriminator），调用语法权威地存在于 actor 工具自身的描述
      //（actor.txt）。内嵌伪调用块曾在真实运行中产生畸形调用。
      for (const rel of ["spec-reviewer-prompt.md", "code-quality-reviewer-prompt.md", "implementer-prompt.md"]) {
        const md = bundle["subagent"][rel]
        expect(md).toMatch(/\bactor\b/)
        expect(md).toMatch(/general/)
        // 无内嵌 operation-discriminator 调用语法
        expect(md).not.toMatch(/operation:\s*run/)
      }
    })
  })

  describe("gyc 本地化完整性", () => {
    test("bundle 不残留上游品牌名（mimocode/MiMo Code）", () => {
      const offenders = Object.entries(bundle).flatMap(([skill, files]) =>
        Object.entries(files)
          .filter(([, content]) => /mimocode|mimo code|MiMoCode/i.test(content))
          .map(([rel]) => `${skill}/${rel}`),
      )
      expect(offenders).toEqual([])
    })
  })
})
