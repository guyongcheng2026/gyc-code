import type { Session as SDKSession, Message, Part } from "@gyccode/protocol/v2"
import { SessionV1 } from "@gyccode/core/v1/session"
import { Session } from "@/session/session"
import { CliError, effectCmd, fail } from "../effect-cmd"
import { Database } from "@gyccode/core/database/database"
import { SessionTable, MessageTable, PartTable } from "@gyccode/core/session/sql"
import { InstanceRef } from "@/effect/instance-ref"
import { EOL } from "os"
import path from "path"
import { FSUtil } from "@gyccode/core/fs-util"
import { Effect, Schema } from "effect"
import type { InstanceContext } from "@/project/instance-context"

const decodeMessageInfo = Schema.decodeUnknownSync(SessionV1.Info)
const decodePart = Schema.decodeUnknownSync(SessionV1.Part)

export function formatImportFileError(file: string, error: FSUtil.Error) {
  if (error._tag === "PlatformError") {
    if (error.reason._tag === "NotFound") return `未找到文件：${file}`
    if (error.reason._tag === "PermissionDenied") return `读取文件失败：权限不足`
    return `读取文件失败：${error.message}`
  }

  const detail = error.cause instanceof Error ? error.cause.message : error.message
  return `${file} 中的 JSON 无效：${detail}`
}

type ExportData = { info: SDKSession; messages: Array<{ info: Message; parts: Part[] }> }

export const ImportCommand = effectCmd({
  command: "import <file>",
  describe: "从 JSON 文件导入会话数据",
  builder: (yargs) =>
    yargs.positional("file", {
      describe: "JSON 文件路径",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.import")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die("InstanceRef not provided")
    return yield* runImport(args.file, ctx)
  }),
})

const runImport = Effect.fn("Cli.import.body")(function* (file: string, ctx: InstanceContext) {
  const fs = yield* FSUtil.Service
  const { db } = yield* Database.Service

  if (file.startsWith("http://") || file.startsWith("https://"))
    return yield* fail("不再支持从分享 URL 导入：会话分享功能已下线")

  const exportData = (yield* fs
    .readJson(file)
    .pipe(Effect.mapError((error) => new CliError({ message: formatImportFileError(file, error) })))) as ExportData

  if (!exportData) {
    process.stdout.write(`读取会话数据失败`)
    process.stdout.write(EOL)
    return
  }

  const info = Schema.decodeUnknownSync(Session.Info)({
    ...exportData.info,
    projectID: ctx.project.id,
    directory: ctx.directory,
    path: path.relative(path.resolve(ctx.worktree), ctx.directory).replaceAll("\\", "/"),
  }) as Session.Info
  const row = Session.toRow(info)
  yield* db
    .insert(SessionTable)
    .values(row)
    .onConflictDoUpdate({
      target: SessionTable.id,
      set: { project_id: row.project_id, directory: row.directory, path: row.path },
    })
    .run()
    .pipe(Effect.orDie)

  for (const msg of exportData.messages) {
    const msgInfo = decodeMessageInfo(msg.info) as SessionV1.Info
    const { id, sessionID: _, ...msgData } = msgInfo
    yield* db
      .insert(MessageTable)
      .values({
        id,
        session_id: row.id,
        time_created: msgInfo.time?.created ?? Date.now(),
        data: msgData as never,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)

    for (const part of msg.parts) {
      const partInfo = decodePart(part) as SessionV1.Part
      const { id: partId, sessionID: _s, messageID, ...partData } = partInfo
      yield* db
        .insert(PartTable)
        .values({
          id: partId,
          message_id: messageID,
          session_id: row.id,
          data: partData,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
    }
  }

  process.stdout.write(`已导入会话：${exportData.info.id}`)
  process.stdout.write(EOL)
})
