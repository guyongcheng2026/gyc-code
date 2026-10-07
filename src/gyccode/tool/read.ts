import { Effect, Option, Schema, Scope, Stream } from "effect"
import { NonNegativeInt } from "@gyccode/core/schema"
import * as path from "path"
import * as Tool from "./tool"
import { FSUtil } from "@gyccode/core/fs-util"
import { LSP } from "@/lsp/lsp"
import DESCRIPTION from "./read.txt"
import { InstanceState } from "@/effect/instance-state"
import { Config } from "@/config/config"
import { assertExternalDirectoryEffect } from "./external-directory"
import { Instruction } from "../session/instruction"
import { isPdfAttachment, sniffAttachmentMime } from "@/util/media"
import { extractPdfText } from "@/util/pdf"

/** PDF 文字抽取的页数上限，避免超长文档把上下文一次撑爆 */
const PDF_MAX_PAGES = 50
import { ReadCache, FILE_UNCHANGED_STUB, type StatLike } from "./read-cache"
import { createFileDecoder, detectTextEncoding } from "@gyccode/core/util/text-encoding"
import { maybeRegisterMagicDoc } from "../magic-docs"
import { compact, shouldCompact } from "./read-compaction"
import * as Truncate from "./truncate"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`
const SAMPLE_BYTES = 4096
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

const readCache = ReadCache()

/**
 * R-3（对标指标 23 · 可靠性与安全）：凭据文件屏蔽。
 *
 * 此前 `read('.env')` 会原样把密钥回灌给模型，模型随后极可能把它抄进日志、
 * 提交或后续对话。这里在工具入口直接拦掉，并返回结构化说明而不是静默空内容，
 * 让模型知道「这是被拦的、为什么被拦、正确做法是找用户要凭据」。
 *
 * 判定与文案都是纯函数（同 MATCH_LIMIT / compaction 的分层），执行路径只做调用。
 */

/** 放行名单：这些是样例/模板，不含真实凭据，不应被拦 */
export const SENSITIVE_FILE_ALLOWLIST: readonly string[] = [".env.example", ".env.sample", ".env.template"]

/**
 * 敏感文件名规则（作用于 basename，已转小写）。
 * `pattern` 是纯正则，`reason` 会原样出现在屏蔽说明里，供模型与用户理解拦截依据。
 */
export const SENSITIVE_FILE_RULES: readonly { id: string; pattern: RegExp; reason: string }[] = [
  {
    id: "env-file",
    pattern: /^\.env($|\.)/,
    reason: "环境变量文件，通常包含 API Key、令牌与数据库口令等明文凭据",
  },
  {
    id: "private-key",
    pattern: /\.(pem|key|p8)$/,
    reason: "PEM/私钥文件，密钥材料不得进入模型上下文",
  },
  {
    id: "ssh-private-key",
    pattern: /^id_(rsa|dsa|ecdsa|ed25519)$/,
    reason: "SSH 私钥文件，属于最高敏感度的凭据",
  },
  {
    id: "key-store",
    pattern: /\.(p12|pfx|jks|keystore)$/,
    reason: "密钥库/证书包，通常打包了私钥",
  },
  {
    id: "credentials-json",
    pattern: /(^|[-_.])credentials(\.json|\.yml|\.yaml)?$/,
    reason: "凭据配置文件，通常保存服务账号的密钥对",
  },
]

export type SensitiveVerdict =
  | { blocked: true; reason: string; ruleId: string }
  | { blocked: false }

/**
 * 判定某路径是否命中屏蔽清单（纯函数，无 IO）。
 * basename 大小写不敏感；`.pub` 结尾视为公钥，不屏蔽。
 */
export const evaluateSensitiveFile = (filepath: string): SensitiveVerdict => {
  const base = path.basename(filepath.replace(/\\/g, "/")).toLowerCase()
  if (!base) return { blocked: false }
  if (SENSITIVE_FILE_ALLOWLIST.includes(base)) return { blocked: false }
  // 公钥可以公开，不作为凭据拦截
  if (base.endsWith(".pub")) return { blocked: false }

  for (const rule of SENSITIVE_FILE_RULES) {
    if (rule.pattern.test(base)) return { blocked: true, reason: rule.reason, ruleId: rule.id }
  }
  return { blocked: false }
}

/**
 * 被拦截时返回给模型的结构化说明（纯函数）。
 * 明确写出路径、原因与「不要绕过、需要凭据请让用户提供」，避免模型静默得到空内容。
 */
export const buildSensitiveBlockedOutput = (input: { filepath: string; reason: string }): string =>
  [
    `<path>${input.filepath}</path>`,
    `<type>sensitive</type>`,
    "<blocked>",
    `该文件因疑似凭据/密钥材料已被屏蔽，未读取任何内容。`,
    `屏蔽原因：${input.reason}`,
    "",
    "请不要尝试绕过此限制（例如改用 grep/shell/base64/改名读取等方式）。",
    "如果任务确实需要其中的凭据，请让用户提供凭据本身或由用户确认后再继续。",
    "若用户明确知情并坚持读取，可在本工具上显式传入 allow_sensitive=true；否则到此为止。",
    "</blocked>",
  ].join("\n")

/** 显式放行时的告知文案：让模型知道本次内容并非默认读取而来 */
export const buildSensitiveBypassNotice = (input: { filepath: string; reason: string }): string =>
  [
    `<sensitive-notice>`,
    `${input.filepath} 是敏感文件（${input.reason}），本次是显式放行读取（allow_sensitive=true）。`,
    "请勿把其中的密钥写入日志、提交或后续对话；如无必要应尽快停止引用。",
    "</sensitive-notice>",
  ].join("\n")

class ReadStop extends Schema.TaggedErrorClass<ReadStop>()("ReadStop", {}) {}


// `offset` and `limit` were originally `z.coerce.number()` — the runtime
// coercion was useful when the tool was called from a shell but serves no
// purpose in the LLM tool-call path (the model emits typed JSON). The JSON
// Schema output is identical (`type: "number"`), so the LLM view is
// unchanged; purely CLI-facing uses must now send numbers rather than strings.
export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file or directory to read" }),
  offset: Schema.optional(NonNegativeInt).annotate({
    description: "The line number to start reading from (1-indexed)",
  }),
  limit: Schema.optional(NonNegativeInt).annotate({
    description: "The maximum number of lines to read (defaults to 2000)",
  }),
  allow_sensitive: Schema.optional(Schema.Boolean).annotate({
    description:
      "Set to true to read a credential/secret file that would otherwise be blocked (e.g. .env, *.pem, id_rsa). Default false. Only use when the user has explicitly asked for it.",
  }),
})

type Display =
  | {
      type: "directory"
      path: string
      entries: string[]
      offset: number
      totalEntries: number
      truncated: boolean
    }
  | {
      type: "file"
      path: string
      text: string
      lineStart: number
      lineEnd: number
      totalLines: number
      truncated: boolean
    }

type Metadata = {
  preview: string
  truncated: boolean
  /** 是否走了 P1-3 自动折叠：输出为「骨架 + 指针」而非原始内容 */
  compacted?: boolean
  loaded: string[]
  display?: Display
}

export const ReadTool = Tool.define<
  typeof Parameters,
  Metadata,
  FSUtil.Service | Instruction.Service | LSP.Service | Scope.Scope | Truncate.Service
>(
  "read",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const instruction = yield* Instruction.Service
    const lsp = yield* LSP.Service
    const scope = yield* Scope.Scope
    // execute 必须留在 R=never 通道，故 Truncate 只能在 init 阶段解析后闭包捕获
    const truncate = yield* Truncate.Service
    const configSvc = yield* Effect.serviceOption(Config.Service)
    const configInfo = Option.isSome(configSvc)
      ? yield* configSvc.value.get().pipe(Effect.catch(() => Effect.succeed(undefined)))
      : undefined

    const miss = Effect.fn("ReadTool.miss")(function* (filepath: string) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)
      const items = yield* fs.readDirectory(dir).pipe(
        Effect.map((items) =>
          items
            .filter(
              (item) =>
                item.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(item.toLowerCase()),
            )
            .map((item) => path.join(dir, item))
            .slice(0, 3),
        ),
        Effect.catch(() => Effect.succeed([] as string[])),
      )

      if (items.length > 0) {
        return yield* Effect.fail(
          new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${items.join("\n")}`),
        )
      }

      return yield* Effect.fail(new Error(`File not found: ${filepath}`))
    })

    const list = Effect.fn("ReadTool.list")(function* (filepath: string) {
      const items = yield* fs.readDirectoryEntries(filepath)
      return yield* Effect.forEach(
        items,
        Effect.fnUntraced(function* (item) {
          if (item.type === "directory") return item.name + "/"
          if (item.type !== "symlink") return item.name

          const target = yield* fs.stat(path.join(filepath, item.name)).pipe(Effect.catch(() => Effect.void))
          if (target?.type === "Directory") return item.name + "/"
          return item.name
        }),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items: string[]) => items.sort((a, b) => a.localeCompare(b))))
    })

    const warm = Effect.fn("ReadTool.warm")(function* (filepath: string) {
      // LSP warm-up is optional; do not let a background defect fail an otherwise successful read.
      yield* lsp.touchFile(filepath).pipe(Effect.ignoreCause, Effect.forkIn(scope))
    })

    const readSample = Effect.fn("ReadTool.readSample")(function* (
          filepath: string,
          fileSize: number,
          ctx: Tool.Context<Metadata>,
        ) {
          if (fileSize === 0) return new Uint8Array()

          // Sample size: respect tool_output.max_bytes if set, else fall back to constant
          const maxSample = configInfo?.tool_output?.max_bytes ?? MAX_BYTES
          const sampleSize = Math.min(fileSize, maxSample)

          return yield* Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fs.open(filepath, { flag: "r" })
              return Option.getOrElse(yield* file.readAlloc(sampleSize), () => new Uint8Array())
            }),
          )
        })

    const lines = Effect.fn("ReadTool.lines")(function* (
      filepath: string,
      opts: { limit: number; offset: number },
      sample: Uint8Array,
    ) {
      const start = opts.offset - 1
      const raw: string[] = []
      // countExact：count 是否等于全文件总行数。行数/字节上限命中时会提前终止上游
      // 流（否则 read(file, limit=1) 会把整个文件读完），此时 count 只是「扫描到的位置」，
      // 调用方不得再把它当成总行数展示，否则会给出错误总数。
      const flags = { bytes: 0, count: 0, cut: false, more: false, done: false, countExact: true }

      // Note: prefer manual TextDecoder over Stream.decodeText — when the source stream
      // ends without flushing, decodeText drops the final unterminated line. We also
      // avoid Stream.runForEachWhile (it currently swallows the final unterminated
      // line of the upstream splitLines pipeline) and use a tagged error to stop the
      // upstream file stream as soon as the byte cap is reached.
      const encoding = detectTextEncoding(sample)
      const decoder = createFileDecoder(encoding)
      yield* fs.stream(filepath).pipe(
        Stream.map((bytes) => decoder.decode(bytes, { stream: true })),
        Stream.splitLines,
        Stream.runForEach((text) =>
          Effect.gen(function* () {
            if (flags.done) return yield* new ReadStop()
            flags.count += 1
            if (flags.count <= start) return

            if (raw.length >= opts.limit) {
              flags.more = true
              flags.done = true
              flags.countExact = false
              return yield* new ReadStop()
            }

            const line = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text
            const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
            if (flags.bytes + size <= MAX_BYTES) {
              raw.push(line)
              flags.bytes += size
              return
            }

            flags.cut = true
            flags.more = true
            flags.done = true
            flags.countExact = false
            return yield* new ReadStop()
          }),
        ),
        Effect.catchTag("ReadStop", () => Effect.void),
      )

      return {
        raw,
        count: flags.count,
        countExact: flags.countExact,
        cut: flags.cut,
        more: flags.more,
        offset: opts.offset,
        encoding,
      }
    })

    const isBinaryFile = (filepath: string, bytes: Uint8Array) => {
      const ext = path.extname(filepath).toLowerCase()
      switch (ext) {
        case ".zip":
        case ".tar":
        case ".gz":
        case ".exe":
        case ".dll":
        case ".so":
        case ".class":
        case ".jar":
        case ".war":
        case ".7z":
        case ".doc":
        case ".docx":
        case ".xls":
        case ".xlsx":
        case ".ppt":
        case ".pptx":
        case ".odt":
        case ".ods":
        case ".odp":
        case ".bin":
        case ".dat":
        case ".obj":
        case ".o":
        case ".a":
        case ".lib":
        case ".wasm":
        case ".pyc":
        case ".pyo":
          return true
      }

      if (bytes.length === 0) return false

      let nonPrintableCount = 0
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i]
        if (byte === undefined) continue
        if (byte === 0) return true
        if (byte < 9 || (byte > 13 && byte < 32)) {
          nonPrintableCount++
        }
      }

      return nonPrintableCount / bytes.length > 0.3
    }

    const run = Effect.fn("ReadTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context<Metadata>,
    ) {
      const instance = yield* InstanceState.context
      let filepath = params.filePath
      if (!path.isAbsolute(filepath)) {
        filepath = path.resolve(instance.directory, filepath)
      }
      if (process.platform === "win32") {
        filepath = FSUtil.normalizePath(filepath)
      }
      const title = path.relative(instance.worktree, filepath)

        const stat = yield* fs.stat(filepath).pipe(
          Effect.catchIf(
            (err) => "reason" in err && err.reason._tag === "NotFound",
            () => Effect.succeed(undefined),
          ),
        )
      yield* assertExternalDirectoryEffect(ctx, filepath, {
        bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
        kind: stat?.type === "Directory" ? "directory" : "file",
      })

      yield* ctx.ask({
        permission: "read",
        patterns: [path.relative(instance.worktree, filepath)],
        always: ["*"],
        metadata: {},
      })

      if (!stat) return yield* miss(filepath)

      // R-3（对标指标 23）：凭据文件默认屏蔽。放在权限询问之后、任何内容读取之前，
      // 保证密钥不会进入上下文；模型显式传 allow_sensitive=true 时放行并在输出中注明。
      const sensitiveVerdict = evaluateSensitiveFile(filepath)
      const sensitiveBypassed = stat.type !== "Directory" && sensitiveVerdict.blocked && params.allow_sensitive === true
      if (stat.type !== "Directory" && sensitiveVerdict.blocked && !sensitiveBypassed) {
        return {
          title,
          output: buildSensitiveBlockedOutput({ filepath, reason: sensitiveVerdict.reason }),
          metadata: {
            preview: `已屏蔽敏感文件：${filepath}`,
            truncated: false,
            loaded: [] as string[],
          },
        }
      }
      const sensitiveNotice = sensitiveBypassed
        ? buildSensitiveBypassNotice({ filepath, reason: sensitiveVerdict.reason })
        : undefined

      if (stat.type === "Directory") {
        const items = yield* list(filepath)
        const limit = params.limit ?? DEFAULT_READ_LIMIT
        const offset = params.offset || 1
        const start = offset - 1
        const sliced = items.slice(start, start + limit)
        const truncated = start + sliced.length < items.length

        return {
          title,
          output: [
            `<path>${filepath}</path>`,
            `<type>directory</type>`,
            `<entries>`,
            sliced.join("\n"),
            truncated
              ? `\n(Showing ${sliced.length} of ${items.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
              : `\n(${items.length} entries)`,
            `</entries>`,
          ].join("\n"),
          metadata: {
            preview: sliced.slice(0, 20).join("\n"),
            truncated,
            loaded: [] as string[],
            display: {
              type: "directory" as const,
              path: filepath,
              entries: sliced,
              offset,
              totalEntries: items.length,
              truncated,
            },
          },
        }
      }

      // 缓存短路必须排在外部目录校验与 read 权限询问之后（此前提前 return 会绕过两者），
      // 且仅对默认的整文件读取生效：带 offset/limit 的请求命中缓存会拿不到请求区段。
      if (!params.offset && !params.limit) {
        const cachedStat = readCache.getStat(filepath)
        const statMtime = Option.getOrUndefined(stat.mtime)?.getTime?.()
        const statSize = stat.size === undefined ? undefined : Number(stat.size)
        if (
          cachedStat &&
          cachedStat !== FILE_UNCHANGED_STUB &&
          cachedStat?.mtime?.getTime?.() === statMtime &&
          cachedStat?.size === statSize
        ) {
          // Content already seen in this session; keep the read-state marker
          // so the read-before-write guard is satisfied.
          readCache.markRead(filepath)
          return {
            title,
            output: FILE_UNCHANGED_STUB,
            metadata: {
              preview: "",
              truncated: false,
              loaded: [],
            },
          }
        }
      }

      const loaded = yield* instruction.resolve(ctx.messages, filepath, ctx.messageID)
      const sample = yield* readSample(filepath, Number(stat.size), ctx)

      const mime = sniffAttachmentMime(sample, FSUtil.mimeType(filepath))
      const isImage = SUPPORTED_IMAGE_MIMES.has(mime)

      if (isImage || isPdfAttachment(mime)) {
        const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10MB
        if (Number(stat.size) > MAX_ATTACHMENT_SIZE) {
          return yield* Effect.fail(
            new Error(`File too large for inline reading: ${filepath} (${Math.round(Number(stat.size) / 1024 / 1024)}MB). Use a different approach.`),
          )
        }
        const bytes = yield* fs.readFile(filepath)

        // P1-8（对标指标 8 · PDF 解析）：PDF 自带文字层时在本地抽成文本直接回灌，
        // 不必把整份 PDF base64 塞进上下文（几十万 token 且要求模型具备 PDF 能力）。
        // 抽不出文字（扫描件、加密、不支持的过滤器）才回退到整份附件交给视觉模型。
        if (isPdfAttachment(mime)) {
          const pdf = extractPdfText(bytes, { maxPages: PDF_MAX_PAGES })
          if (pdf.hasText) {
            const body = pdf.pages.map((p) => `<!-- page ${p.page} -->\n${p.text}`).join("\n\n")
            const output = [
              `<path>${filepath}</path>`,
              `<type>pdf</type>`,
              `<pages>${pdf.pageCount}</pages>`,
              "<content>\n",
              body,
              "\n</content>",
              // 抽取过程中的降级说明必须回灌给模型：截断到前 N 页、字符上限截断、
              // 加密/DRM、若干页解码失败……此前 pdf.warnings 全段未被引用，
              // 模型只会看到「读取成功」+ 正文，以为拿到了全文，
              // 实际缺的页与降级原因一律静默丢失。
              ...(pdf.warnings.length > 0 ? ["", "<warnings>", ...pdf.warnings, "</warnings>"] : []),
            ].join("\n")
            return {
              title,
              output,
              metadata: {
                preview: pdf.warnings.length
                  ? `PDF read successfully (${pdf.pageCount} 页，${pdf.warnings.length} 条降级说明)`
                  : `PDF read successfully (${pdf.pageCount} 页)`,
                truncated: false,
                loaded: loaded.map((item) => item.filepath),
              },
            }
          }
        }

        const msg = isPdfAttachment(mime) ? "PDF read successfully" : "Image read successfully"
        return {
          title,
          output: msg,
          metadata: {
            preview: msg,
            truncated: false,
            loaded: loaded.map((item) => item.filepath),
          },
          attachments: [
            {
              type: "file" as const,
              mime,
              url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
            },
          ],
        }
      }

      if (isBinaryFile(filepath, sample)) {
        return yield* Effect.fail(new Error(`Cannot read binary file: ${filepath}`))
      }

      const file = yield* lines(filepath, { limit: params.limit ?? DEFAULT_READ_LIMIT, offset: params.offset || 1 }, sample)
      if (file.count < file.offset && !(file.count === 0 && file.offset === 1)) {
        return yield* Effect.fail(
          new Error(`Offset ${file.offset} is out of range for this file (${file.count} lines)`),
        )
      }

      let output = [`<path>${filepath}</path>`, `<type>file</type>`, "<content>\n"].join("\n")
      if (sensitiveNotice) output += `${sensitiveNotice}\n`
      output += file.raw.map((line, i) => `${i + file.offset}: ${line}`).join("\n")

      const last = file.offset + file.raw.length - 1
      const next = last + 1
      const truncated = file.more || file.cut
      // P1-3（对标指标 6 · §1.3「read 无自动 compaction」）：整文件读取被超限截断时，
      // 默认折叠为「符号骨架 + 首尾样本 + 落盘指针」，模型不必再花一次工具调用翻页。
      // 模型显式给了 offset/limit 时尊重其窗口，仍走原有的 offset 提示路径。
      let compacted = false
      // 折叠路径会整读全文，可用它给出真实总行数（file.count 在提前终止后只是扫描位置）
      let compactionTotal: number | undefined
      if (shouldCompact({ truncated, offset: params.offset, limit: params.limit })) {
        const full = yield* fs.readFile(filepath).pipe(
          Effect.map((bytes) => createFileDecoder(file.encoding).decode(bytes)),
          // 极端情况下二次读取失败：退回已读到的窗口内容，绝不让整个 read 失败
          Effect.catch(() => Effect.succeed(file.raw.join("\n"))),
        )
        output = (yield* compact(truncate, { filepath, text: full })).content
        // 末尾换行会让 split 多出一个空串，去掉后才是行数
        compactionTotal = full === "" ? 0 : full.endsWith("\n") ? full.split("\n").length - 1 : full.split("\n").length
        compacted = true
      } else if (file.cut) {
        output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)\n</content>`
      } else if (file.more) {
        // countExact 为假时 count 只是扫描到的位置，展示「of N」会给出错误总数
        output += file.countExact
          ? `\n\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue.)\n</content>`
          : `\n\n(Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)\n</content>`
      } else {
        output += `\n\n(End of file - total ${file.count} lines)\n</content>`
      }

      yield* warm(filepath)

      if (loaded.length > 0) {
        output += `\n\n<system-reminder>\n${loaded.map((item) => item.content).join("\n\n")}\n</system-reminder>`
      }

        // Cache file content and stat for future reads
        readCache.markRead(filepath)
        // 折叠后模型看到的是骨架，display 必须与之一致，否则 TUI 展示与模型所见不符
        const displayText = compacted ? output : file.raw.join("\n")
        const displayEnd = compacted ? Math.max(compactionTotal ?? 0, file.count) : last
        // 仅当整文件完整读入（未截断、未带 offset/limit）时才缓存内容，
        // 否则会把分页窗口缓存成"已读全文"，后续请求会拿到错误的 unchanged 占位。
        if (truncated || params.offset || params.limit) return {
          title,
          output,
          metadata: {
            preview: file.raw.slice(0, 20).join("\n"),
            truncated,
            compacted,
            loaded: loaded.map((item) => item.filepath),
            display: {
              type: "file" as const,
              path: filepath,
              text: displayText,
              lineStart: file.offset,
              lineEnd: displayEnd,
              totalLines: file.count,
              truncated,
            },
          },
        }
        readCache.set(filepath, file.raw.join("\n"), {
          mtime: Option.getOrUndefined(stat.mtime),
          size: stat.size === undefined ? undefined : Number(stat.size),
          type: stat.type,
        }, file.encoding);
        // Auto-maintained documentation (MAGIC DOC): register so the session can
        // refresh it in the background when idle (aligned with reference agent MagicDocs).
        maybeRegisterMagicDoc(filepath, file.raw.join("\n"))
        return {
          title,
          output,
          metadata: {
            preview: file.raw.slice(0, 20).join("\n"),
            truncated,
            compacted,
            loaded: loaded.map((item) => item.filepath),
            display: {
              type: "file" as const,
              path: filepath,
              text: displayText,
              lineStart: file.offset,
              lineEnd: displayEnd,
              totalLines: file.count,
              truncated,
            },
          },
        }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
