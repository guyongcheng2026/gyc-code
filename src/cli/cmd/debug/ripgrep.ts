import { EOL } from "os"
import { Effect } from "effect"
import { Ripgrep } from "@gyccode/core/ripgrep"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import { InstanceRef } from "@/effect/instance-ref"

export const RipgrepCommand = cmd({
  command: "rg",
  describe: "ripgrep 调试工具",
  builder: (yargs) => yargs.command(FilesCommand).command(SearchCommand).demandCommand(),
  async handler() {},
})

const FilesCommand = effectCmd({
  command: "files",
  describe: "使用 ripgrep 列出文件",
  builder: (yargs) =>
    yargs
      .option("query", {
        type: "string",
        description: "按查询筛选文件",
      })
      .option("glob", {
        type: "string",
        description: "用于匹配文件的 Glob 模式",
      })
      .option("limit", {
        type: "number",
        description: "限制结果数量",
      }),
  handler: Effect.fn("Cli.debug.rg.files")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const ripgrep = yield* Ripgrep.Service
    const files = yield* ripgrep
      .glob({
        cwd: ctx.directory,
        pattern: args.glob ?? "**/*",
        limit: args.limit ?? 10_000,
      })
      .pipe(Effect.orDie)
    process.stdout.write(files.map((file) => file.path).join(EOL) + EOL)
  }),
})

const SearchCommand = effectCmd({
  command: "search <pattern>",
  describe: "使用 ripgrep 搜索文件内容",
  builder: (yargs) =>
    yargs
      .positional("pattern", {
        type: "string",
        demandOption: true,
        description: "搜索模式",
      })
      .option("glob", {
        type: "array",
        description: "文件 Glob 模式",
      })
      .option("limit", {
        type: "number",
        description: "限制结果数量",
      }),
  handler: Effect.fn("Cli.debug.rg.search")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const ripgrep = yield* Ripgrep.Service
    const results = yield* ripgrep
      .grep({
        cwd: ctx.directory,
        pattern: args.pattern,
        include: args.glob?.[0],
        limit: args.limit ?? 10_000,
      })
      .pipe(Effect.orDie)
    process.stdout.write(JSON.stringify(results, null, 2) + EOL)
  }),
})
