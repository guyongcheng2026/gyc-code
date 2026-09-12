import { cmd } from "./cmd"
import { readUsage } from "@/learning/usage"
import { readLedger, rollbackEntry } from "@/learning/ledger"
import { make as makeSkillStore } from "@/learning/skill-store"
import { applyTransitions, planTransitions } from "@/learning/lifecycle"
import { gycSkillsHome, skillsRoot } from "@/learning/paths"

/** 技能沉淀闭环的运维入口：查看账本、回滚单次变更、归档与恢复技能。 */
export const LearningCommand = cmd({
  command: "learning",
  describe: "技能沉淀闭环：查看 / 回滚 / 归档 / 生命周期",
  builder: (yargs) =>
    yargs
      .command({
        command: "status",
        describe: "查看自建技能库概况",
        handler: async () => {
          const root = gycSkillsHome()
          const store = makeSkillStore(root)
          const usage = await readUsage(root)
          const ledger = await readLedger(root)
          const names = await store.list()
          const entries = Object.values(usage)
          const pinned = entries.filter((entry) => entry.pinned).length
          const stale = entries.filter((entry) => entry.state === "stale").length
          const archived = entries.filter((entry) => entry.state === "archived").length
          const last = ledger[ledger.length - 1]

          console.log(`技能根目录: ${skillsRoot(root)}`)
          console.log(`自建技能: ${names.length}`)
          console.log(`状态分布: active ${names.length - stale - archived} / stale ${stale} / archived ${archived}`)
          console.log(`pinned: ${pinned}`)
          console.log(`账本条目: ${ledger.length}`)
          console.log(`最近一次变更: ${last ? `${last.ts} ${last.action} ${last.skill}` : "无"}`)
        },
      })
      .command({
        command: "usage",
        describe: "按最近活动时间列出用量",
        handler: async () => {
          const usage = await readUsage(gycSkillsHome())
          const rows = Object.entries(usage).toSorted((a, b) => b[1].lastActivityAt - a[1].lastActivityAt)
          if (rows.length === 0) {
            console.log("尚无用量记录。")
            return
          }
          for (const [name, entry] of rows) {
            const stamp = new Date(entry.lastActivityAt).toISOString().slice(0, 19).replace("T", " ")
            console.log(
              `${name}\t${entry.origin}\t${entry.state}${entry.pinned ? " (pinned)" : ""}\t` +
                `use ${entry.useCount} / view ${entry.viewCount} / patch ${entry.patchCount}\t${stamp}`,
            )
          }
        },
      })
      .command({
        command: "rollback <id>",
        describe: "回滚账本中某一次技能变更",
        builder: (inner) =>
          inner.positional("id", { type: "string", demandOption: true, describe: "账本条目 id" }),
        handler: async (argv) => {
          // 回滚是唯一 fail-closed 的操作：失败必须以非零退出码收场。
          try {
            await rollbackEntry(gycSkillsHome(), argv.id as string)
            console.log(`已回滚账本条目 ${argv.id}。`)
          } catch (error) {
            console.error(`回滚失败: ${error instanceof Error ? error.message : String(error)}`)
            process.exitCode = 1
          }
        },
      })
      .command({
        command: "archive <name>",
        describe: "手工归档一个自建技能",
        builder: (inner) =>
          inner.positional("name", { type: "string", demandOption: true, describe: "技能名" }),
        handler: async (argv) => {
          const name = argv.name as string
          const result = await makeSkillStore(gycSkillsHome()).archive({ name, sessionId: "cli", reason: "manual" })
          if (result.ok) {
            console.log(`已归档 ${name}。`)
            return
          }
          console.error(`归档失败: ${result.reason} ${result.message}`)
          process.exitCode = 1
        },
      })
      .command({
        command: "restore <name>",
        describe: "从归档区恢复一个技能",
        builder: (inner) =>
          inner.positional("name", { type: "string", demandOption: true, describe: "技能名" }),
        handler: async (argv) => {
          const name = argv.name as string
          const result = await makeSkillStore(gycSkillsHome()).restore({ name, sessionId: "cli" })
          if (result.ok) {
            console.log(`已恢复 ${name}。`)
            return
          }
          console.error(`恢复失败: ${result.reason} ${result.message}`)
          process.exitCode = 1
        },
      })
      .command({
        command: "tick",
        describe: "按闲置时长推进生命周期（stale 30 天 / archive 90 天）",
        handler: async () => {
          const root = gycSkillsHome()
          const transitions = planTransitions(await readUsage(root), { now: Date.now() })
          if (transitions.length === 0) {
            console.log("无需变更。")
            return
          }
          await applyTransitions(root, transitions)
          for (const transition of transitions) {
            console.log(`${transition.name} -> ${transition.to}`)
          }
        },
      })
      .demandCommand(),
  async handler() {},
})
