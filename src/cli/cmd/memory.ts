import { cmd } from "./cmd"
import { readMemories, writeMemoryFile, syncMemories } from "@/memory/memory-bridge"

export const MemoryCommand = cmd({
  command: "memory",
  describe: "管理跨会话记忆",
  builder: (yargs) =>
    yargs
      .command({
        command: "read",
        describe: "读取已存储的记忆",
        handler: async () => {
          const memories = await readMemories()
          if (memories.length === 0) {
            console.log("未找到任何记忆。")
            return
          }
          console.log(`Memories (${memories.length}):`)
          for (const m of memories) {
            console.log(`\n${m.key}:`)
            console.log(m.value.slice(0, 200))
            if (m.value.length > 200) console.log("...")
          }
        },
      })
      .command({
        command: "write <key> <value..>",
        describe: "写入一条记忆",
        builder: (yargs) =>
          yargs
            .positional("key", { type: "string", demandOption: true, describe: "记忆键" })
            .positional("value", { type: "string", array: true, demandOption: true, describe: "记忆值" }),
        handler: async (argv) => {
          await writeMemoryFile({
            key: argv.key as string,
            value: (argv.value as string[]).join(" "),
          })
          console.log(`Memory "${argv.key}" saved.`)
        },
      })
      .command({
        command: "sync",
        describe: "同步所有记忆",
        handler: async () => {
          await syncMemories()
          console.log("Memories synced.")
        },
      })
      .demandCommand(),
  async handler() {},
})