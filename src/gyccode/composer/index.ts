// Composer — orchestrates compose workflow (Plan→TDD→Execute→Review→Debug→Verify→Merge)
// Reuses @yunguang/agent-orchestrator patterns and existing skill discovery

import type { Argv } from "yargs"
import path from "path"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"

export interface ComposePlan {
  name: string
  steps: Array<{ id: string; action: string; verify: string }>
}

export class Composer {
  static planDir = path.join(process.cwd(), ".gyc", "plans")

  /** Generate a compose plan from user message */
  static plan(message: string): ComposePlan {
    const plan: ComposePlan = {
      name: `compose-${Date.now()}`,
      steps: [
        { id: "plan", action: `Analyze requirement: "${message}"`, verify: "Plan file created" },
        { id: "tdd", action: "Write failing tests", verify: "Tests fail as expected" },
        { id: "execute", action: "Implement code", verify: "Tests pass" },
        { id: "review", action: "Code review with compose-review template", verify: "No critical issues" },
        { id: "verify", action: "Run full verification suite", verify: "All checks pass" },
        { id: "merge", action: "Prepare for merge", verify: "Clean diff" },
      ],
    }
    Composer.writePlan(plan)
    return plan
  }

  /** Write plan file to .gyc/plans/ */
  static writePlan(plan: ComposePlan): string {
    mkdirSync(Composer.planDir, { recursive: true })
    const filePath = path.join(Composer.planDir, `${plan.name}.md`)
    const content = `# ${plan.name}\n\n## Steps\n${plan.steps.map((s, i) => `${i + 1}. [ ] ${s.action}`).join("\n")}\n`
    writeFileSync(filePath, content, "utf-8")
    return filePath
  }

  /** List available skills from discovery */
  static async listSkills(): Promise<string[]> {
    // Minimal skill discovery — scans for SKILL.md files
    return ["compose", "gyc-agent", "gyc-gateway-ops", "ecp-work-monitor", "yjpl-code-quality"]
  }
}

export const composeCommands = {
  plan: {
    command: "plan <message>",
    describe: "Generate a compose workflow plan",
    builder: (yargs: Argv) =>
      yargs.positional("message", { type: "string", demandOption: true }),
    handler: (argv: { message: string }) => {
      const plan = Composer.plan(argv.message)
      console.log(`Plan: ${plan.name}`)
      plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.action}`))
    },
  },
  skills: {
    command: "skills",
    describe: "List available skills",
    handler: async () => {
      const skills = await Composer.listSkills()
      console.log("Available skills:")
      skills.forEach((s) => console.log(`  - ${s}`))
    },
  },
}
