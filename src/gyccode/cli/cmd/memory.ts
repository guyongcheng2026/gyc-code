import { cmd } from "./cmd"
import { readHermesMemories, writeHermesMemoryFile, syncHermesMemories } from "../../memory/hermes-bridge"

export const MemoryCommand = cmd({
  command: "memory",
  describe: "manage cross-session memory",
  builder: (yargs) =>
    yargs
      .command({
        command: "read",
        describe: "read stored memories",
        handler: async () => {
          const memories = await readHermesMemories()
          if (memories.length === 0) {
            console.log("No memories found.")
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
        describe: "write a memory entry",
        builder: (yargs) =>
          yargs
            .positional("key", { type: "string", demandOption: true, describe: "memory key" })
            .positional("value", { type: "string", demandOption: true, describe: "memory value" }),
        handler: async (argv) => {
          await writeHermesMemoryFile({
            key: argv.key as string,
            value: (argv.value as string[]).join(" "),
          })
          console.log(`Memory "${argv.key}" saved.`)
        },
      })
      .command({
        command: "sync",
        describe: "sync all memories",
        handler: async () => {
          await syncHermesMemories()
          console.log("Memories synced.")
        },
      })
      .demandCommand(),
  async handler() {},
})