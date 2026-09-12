import { EOL } from "os"
import { Effect } from "effect"
import { FileSystem } from "@gyccode/core/filesystem"
import { LocationServiceMap, locationServiceMapLayer } from "@gyccode/core/location-services"
import { Location } from "@gyccode/core/location"
import { AbsolutePath, RelativePath } from "@gyccode/core/schema"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"

const filesystem = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) }))),
    Effect.provide(locationServiceMapLayer),
  )

const FileSearchCommand = effectCmd({
  command: "search <query>",
  describe: "按查询搜索文件",
  builder: (yargs) =>
    yargs.positional("query", {
      type: "string",
      demandOption: true,
      description: "搜索查询",
    }),
  handler: Effect.fn("Cli.debug.file.search")(function* (args) {
    const results = yield* Effect.orDie(filesystem(FileSystem.Service.use((svc) => svc.find({ query: args.query }))))
    process.stdout.write(results.map((item) => item.path).join(EOL) + EOL)
  }),
})

const FileReadCommand = effectCmd({
  command: "read <path>",
  describe: "以 JSON 形式读取文件内容",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "要读取的文件路径",
    }),
  handler: Effect.fn("Cli.debug.file.read")(function* (args) {
    const file = yield* filesystem(FileSystem.Service.use((svc) => svc.read({ path: RelativePath.make(args.path) })))
    process.stdout.write(
      JSON.stringify(
        { content: Buffer.from(file.content).toString("base64"), encoding: "base64", mime: file.mime },
        null,
        2,
      ) + EOL,
    )
  }),
})

const FileListCommand = effectCmd({
  command: "list <path>",
  describe: "列出目录中的文件",
  builder: (yargs) =>
    yargs.positional("path", {
      type: "string",
      demandOption: true,
      description: "要列出的文件路径",
    }),
  handler: Effect.fn("Cli.debug.file.list")(function* (args) {
    const files = yield* filesystem(FileSystem.Service.use((svc) => svc.list({ path: RelativePath.make(args.path) })))
    process.stdout.write(JSON.stringify(files, null, 2) + EOL)
  }),
})

export const FileCommand = cmd({
  command: "file",
  describe: "文件系统调试工具",
  builder: (yargs) =>
    yargs.command(FileReadCommand).command(FileListCommand).command(FileSearchCommand).demandCommand(),
  async handler() {},
})
