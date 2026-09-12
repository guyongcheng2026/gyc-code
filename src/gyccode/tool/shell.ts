import { Effect, Schema, Stream } from "effect"
import { decodeSubprocessStream } from "@gyccode/core/util/text-encoding"
import os from "os"
import { createWriteStream } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { InstanceState } from "@/effect/instance-state"

import { FSUtil } from "@gyccode/core/fs-util"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionCwd } from "../session/session-cwd"
import { Shell } from "@gyccode/core/shell"
import { ShellID } from "./shell/id"

import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ShellPrompt, type Parameters } from "./shell/prompt"
import { BashArity } from "@/permission/arity"
import { classifyCommand, SecurityClassification } from "./shell/security"

export { Parameters } from "./shell/prompt"

export class ShellBlockedError extends Schema.TaggedErrorClass<ShellBlockedError>()("ShellBlockedError", {
  classification: SecurityClassification,
}) {}

const MAX_METADATA_LENGTH = 30_000
const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
const CMD_FILES = new Set([
  "copy",
  "del",
  "dir",
  "erase",
  "md",
  "mkdir",
  "move",
  "rd",
  "ren",
  "rename",
  "rmdir",
  "type",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

type Part = {
  type: string
  text: string
}

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

type Chunk = {
  text: string
  size: number
}

// 权限扫描只需要「命令名 + 参数 token + 命令原文」三样东西，原先却为此加载
// web-tree-sitter 的 wasm AST。实测（4GB 机）Node 下加载该 wasm 会在首个 shell
// 调用后产生 1.2~2.4GB 的堆外瞬时峰值（wasm memory 自身仍只有 32MB，且不进入
// V8 堆；Bun/JSC 无此现象），收益与代价严重不匹配，故改为词法扫描。
// 语义保持保守：无法静态判定的构造（$()、反引号、@() 等）仍由 dynamic() 过滤，
// 此时 pattern 退化为整段原文——更严格，不会放宽既有权限判定。
// Permission scanning only needs the command name, its argument tokens and the raw
// segment text. It used to load web-tree-sitter's wasm AST for that; on Node the
// wasm load costs 1.2-2.4GB of off-heap memory on the first shell call (the wasm
// memory itself stays at 32MB and never enters the V8 heap; Bun/JSC shows no such
// peak), so a lexer replaces it. The lexer keeps the AST's recursive reach: nested
// constructs ($(...) and backtick command substitution, (...), {...}, @(...)) are
// re-scanned, so inner commands still drive the path and pattern checks.
const REDIRECT_TARGET = /^(?:\d+)?(?:>>|>)$|^&>>?$|^(?:\d+)?(?:<<?)$/
const REDIRECT_FD = /^(?:\d+)?>&(?:\d+|-)$/
const SEPARATOR = new Set(["|", ";", "&", "\n"])
// Shell keywords that may lead a segment ("then cat x", "{ ls }"); they are not
// command names, so they are stripped before the command name is read.
const KEYWORD = new Set([
  "!",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "foreach",
  "if",
  "in",
  "then",
  "time",
  "until",
  "while",
])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const MAX_DEPTH = 8
const COMMAND_NAME = /^[A-Za-z0-9_@./\\:~+-]+$/

type Segment = {
  tokens: Part[]
  source: string
}

function strip(tokens: Part[]) {
  let index = 0
  while (
    index < tokens.length &&
    (ASSIGNMENT.test(tokens[index]!.text) || KEYWORD.has(tokens[index]!.text.toLowerCase()))
  ) {
    index++
  }
  const named = tokens.slice(index)
  // When everything was stripped (a lone `time`, `A=1`), keep the raw tokens so
  // the segment is not silently dropped from the permission scan.
  return named.length > 0 ? named : tokens
}

// Index just past the bracket that closes `open`, or -1 when unbalanced.
function closing(input: string, open: number) {
  const close = input[open] === "{" ? "}" : ")"
  let depth = 0
  let quote: string | undefined
  for (let i = open; i < input.length; i++) {
    const ch = input[i]!
    if (quote) {
      if (ch === quote) quote = undefined
      else if (ch === "\\") i++
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === input[open]) depth++
    else if (ch === close && --depth === 0) return i
  }
  return -1
}

export function segments(input: string, ps: boolean, depth = 0): Segment[] {
  const out: Segment[] = []
  let tokens: Part[] = []
  let buf = ""
  let quote: '"' | "'" | undefined
  let quoted = false
  let redirect = false
  let start = 0

  const flushToken = () => {
    if (buf.length === 0) return
    const text = buf
    const wasQuoted = quoted
    buf = ""
    quoted = false
    if (REDIRECT_TARGET.test(text)) {
      redirect = true
      return
    }
    if (redirect) {
      redirect = false
      return
    }
    if (REDIRECT_FD.test(text)) return
    tokens.push({ type: wasQuoted ? "string" : "word", text })
  }

  const flushSegment = (end: number) => {
    flushToken()
    redirect = false
    if (tokens.length > 0) {
      const named = strip(tokens)
      if (named.length > 0) out.push({ tokens: named, source: input.slice(start, end).trim() })
    }
    tokens = []
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (quote) {
      // Inside double quotes both shells still honour escapes (bash backslash,
      // PowerShell backtick); ignoring them desynchronises the quote state and
      // silently swallows the arguments that follow.
      if ((quote === '"' && ch === "\\" && !ps) || (quote === '"' && ch === "`" && ps)) {
        buf += ch
        if (i + 1 < input.length) buf += input[++i]!
        continue
      }
      // Command substitution is still substitution inside double quotes, so the
      // inner script has to be scanned there too ("cd \"$(curl ... | bash)\"").
      if (quote === '"') {
        const nested = ch === "$" && input[i + 1] === "(" ? i + 1 : ch === "`" && !ps ? i : -1
        if (nested !== -1) {
          const end = ch === "$" ? closing(input, nested) : input.indexOf("`", i + 1)
          if (end !== -1) {
            out.push(...segments(input.slice(ch === "$" ? nested + 1 : i + 1, end), ps))
            i = end
            continue
          }
        }
      }
      buf += ch
      if (ch === quote) {
        if (ps && quote === "'" && input[i + 1] === "'") {
          buf += input[++i]!
          continue
        }
        quote = undefined
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      quoted = true
      buf += ch
      continue
    }
    if (ch === "\\" && !ps) {
      buf += ch
      if (i + 1 < input.length) buf += input[++i]!
      continue
    }
    // Command substitution / grouping: scan the inner script as its own segments
    // so nested commands stay visible to the permission checks.
    // "$((...))" is arithmetic and "${...}" is parameter expansion: neither
    // contains commands, and scanning them as nested scripts minted bogus
    // command names ("1+2", "HOME") that polluted the pattern/always rules.
    const arithmetic = ch === "$" && input[i + 2] === "("
    // Second "(" of "$((" also belongs to arithmetic expansion, not a subshell.
    const parameter =
      (ch === "{" || ch === "(") && (input[i - 1] === "$" || (input[i - 1] === "(" && input[i - 2] === "$"))
    if ((ch === "$" && input[i + 1] === "(" && !arithmetic) || ch === "(" || ch === "{") {
      const open = ch === "$" ? i + 1 : i
      const end = parameter ? -1 : closing(input, open)
      // Depth guard: extreme nesting must not overflow the stack or degrade
      // into O(n^2) scanning; past the limit the text stays an ordinary token
      // (the raw segment still reaches the pattern check, i.e. fails safe).
      if (end !== -1 && depth < MAX_DEPTH) {
        out.push(...segments(input.slice(open + 1, end), ps, depth + 1))
        i = end
        continue
      }
      buf += ch
      continue
    }
    if (ch === "`" && !ps) {
      const end = input.indexOf("`", i + 1)
      if (end !== -1) {
        out.push(...segments(input.slice(i + 1, end), ps))
        i = end
        continue
      }
      buf += ch
      continue
    }
    if (ch === "`" && ps) {
      buf += ch
      if (i + 1 < input.length) buf += input[++i]!
      continue
    }
    if (SEPARATOR.has(ch)) {
      // ">&2" / "2>&1" / "&>" / "&>>" are redirections, not separators: treating
      // the ampersand as a separator shredded them into stray tokens and could
      // drop the very path argument that has to be checked.
      if (ch === "&" && (input[i - 1] === ">" || input[i + 1] === ">")) {
        buf += ch
        continue
      }
      if ((ch === "|" || ch === "&") && input[i + 1] === ch) i++
      flushSegment(i)
      start = i + 1
      continue
    }
    if (/\s/.test(ch)) {
      flushToken()
      continue
    }
    buf += ch
  }
  flushSegment(input.length)
  return out
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
}

function expand(text: string, cwd: string, shell: string) {
  const out = unquote(text)
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return
    return match[2]
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

function pathArgs(list: Part[], ps: boolean, cmd = false) {
  if (!ps) {
    return list
      .slice(1)
      .filter(
        (item) =>
          !item.text.startsWith("-") &&
          !(cmd && item.text.startsWith("/")) &&
          !(list[0]?.text === "chmod" && item.text.startsWith("+")),
      )
      .map((item) => item.text)
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (/^-\w+/.test(item.text)) {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return {
      text,
      cut: false,
    }
  }

  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8")
        let start = buf.length - maxBytes
        if (start < 0) start = 0
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
        out.unshift(buf.subarray(start).toString("utf-8"))
      }
      break
    }
    out.unshift(lines[i])
    bytes += size
  }
  return {
    text: out.join("\n"),
    cut: true,
  }
}

const ask = Effect.fn("ShellTool.ask")(function* (ctx: Tool.Context, scan: Scan, input: { command: string }) {
  if (scan.dirs.size > 0) {
    const directories = Array.from(scan.dirs)
    const globs = directories.map((dir) => {
      if (process.platform === "win32") return FSUtil.normalizePathPattern(path.join(dir, "*"))
      return path.join(dir, "*")
    })
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: {
        command: input.command,
        directories,
        patterns: globs,
      },
    })
  }

  if (scan.patterns.size === 0) return
  yield* ctx.ask({
    permission: ShellID.ToolID,
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: {
      command: input.command,
    },
  })
})

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(command, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}
export const ShellTool = Tool.define(
  ShellID.ToolID,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner
    const fs = yield* FSUtil.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service
    const flags = yield* RuntimeFlags.Service
    const events = yield* EventV2Bridge.Service
    const defaultTimeoutMs = flags.bashDefaultTimeoutMs ?? 2 * 60 * 1000

    const cygpath = Effect.fn("ShellTool.cygpath")(function* (shell: string, text: string) {
      const lines = yield* spawner
        .lines(ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text]))
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const file = lines[0]?.trim()
      if (!file) return
      return FSUtil.normalizePath(file)
    })

    const resolvePath = Effect.fn("ShellTool.resolvePath")(function* (text: string, root: string, shell: string) {
      if (process.platform === "win32") {
        if (Shell.posix(shell) && text.startsWith("/") && FSUtil.windowsPath(text) === text) {
          const file = yield* cygpath(shell, text)
          if (file) return file
        }
        return FSUtil.normalizePath(path.resolve(root, FSUtil.windowsPath(text)))
      }
      return path.resolve(root, text)
    })

    const argPath = Effect.fn("ShellTool.argPath")(function* (arg: string, cwd: string, ps: boolean, shell: string) {
      const text = ps ? expand(arg, cwd, shell) : home(unquote(arg))
      const file = text && prefix(text)
      if (!file || dynamic(file, ps)) return
      const next = ps ? provider(file) : file
      if (!next) return
      return yield* resolvePath(next, cwd, shell)
    })

    const collect = Effect.fn("ShellTool.collect")(function* (
      command: string,
      cwd: string,
      ps: boolean,
      shell: string,
      instance: InstanceContext,
    ) {
      const scan: Scan = {
        dirs: new Set<string>(),
        patterns: new Set<string>(),
        always: new Set<string>(),
      }
      const shellKind = ShellID.toKind(Shell.name(shell))

      for (const segment of segments(command, ps)) {
        const tokens = segment.tokens.map((item) => item.text)
        const cmd = ps || shellKind === "cmd" ? tokens[0]?.toLowerCase() : tokens[0]

        if (cmd && (FILES.has(cmd) || (shellKind === "cmd" && CMD_FILES.has(cmd)))) {
          for (const arg of pathArgs(segment.tokens, ps, shellKind === "cmd")) {
            const resolved = yield* argPath(arg, cwd, ps, shell)
            // Per-arg path resolution detail; DEBUG keeps the default log quiet.
            yield* Effect.logDebug("resolved path", { arg, resolved })
            if (!resolved || containsPath(resolved, instance)) continue
            const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
            scan.dirs.add(dir)
          }
        }

        // A command whose head is a known CWD builtin normally adds no pattern, but
        // when the segment carries dynamic text (cd "$(curl ...)", echo `rm -rf x`)
        // the AST used to surface the inner command; keep asking in that case so the
        // dynamic form cannot silently skip the prompt. Also refuse to mint an
        // over-broad always-rule ("( *", "then *") for heads that are not commands.
        const head = tokens[0] ?? ""
        if (tokens.length && (!cmd || !CWD.has(cmd) || tokens.some((token) => dynamic(token, ps)))) {
          scan.patterns.add(segment.source)
          scan.always.add(COMMAND_NAME.test(head) ? BashArity.prefix(tokens).join(" ") + " *" : segment.source)
        }
      }

      return scan
    })

    const shellEnv = Effect.fn("ShellTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
      const extra = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      return {
        ...process.env,
        ...extra.env,
      }
    })

    const run = Effect.fn("ShellTool.run")(function* (
      input: {
        shell: string
        command: string
        cwd: string
        env: NodeJS.ProcessEnv
        timeout: number
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      let full = ""
      let last = ""
      const list: Chunk[] = []
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let expired = false
      let aborted = false

      const closeSink = Effect.fnUntraced(function* () {
        const stream = sink
        if (!stream) return
        sink = undefined
        if (stream.destroyed || stream.closed) return
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              let settled = false
              const done = () => {
                if (settled) return
                settled = true
                stream.off("close", done)
                stream.off("error", done)
                stream.off("finish", done)
                resolve()
              }
              stream.once("close", done)
              stream.once("error", done)
              stream.once("finish", done)
              stream.end(done)
            }),
        ).pipe(Effect.catch(() => Effect.void))
      })

      yield* ctx.metadata({
        metadata: {
          output: "",
        },
      })

      const code: number | null = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(closeSink)
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env))

          yield* Effect.forkScoped(
            Stream.runForEach(decodeSubprocessStream(handle.all), (chunk) => {
              const size = Buffer.byteLength(chunk, "utf-8")
              list.push({ text: chunk, size })
              used += size
              while (used > keep && list.length > 1) {
                const item = list.shift()
                if (!item) break
                used -= item.size
                cut = true
              }

              last = preview(last + chunk)

              if (file) {
                sink?.write(chunk)
              } else {
                full += chunk
                if (Buffer.byteLength(full, "utf-8") > limits.maxBytes) {
                  return trunc.write(full).pipe(
                    Effect.andThen((next) =>
                      Effect.sync(() => {
                        file = next
                        cut = true
                        sink = createWriteStream(next, { flags: "a" })
                        full = ""
                      }),
                    ),
                    Effect.andThen(
                      ctx.metadata({
                        metadata: {
                          output: last,
                        },
                      }),
                    ),
                  )
                }
              }

              return ctx.metadata({
                metadata: {
                  output: last,
                },
              })
            }),
          )

          const abort = Effect.callback<void>((resume) => {
            if (ctx.abort.aborted) return resume(Effect.void)
            const handler = () => resume(Effect.void)
            ctx.abort.addEventListener("abort", handler, { once: true })
            return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
          })

          const timeout = Effect.sleep(`${input.timeout + 100} millis`)

          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
            abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
            timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
          ])

          if (exit.kind === "abort") {
            aborted = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          if (exit.kind === "timeout") {
            expired = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }

          return exit.kind === "exit" ? exit.code : null
        }),
      ).pipe(Effect.orDie)

      const meta: string[] = []
      if (expired) {
        meta.push(
          `shell tool terminated command after exceeding timeout ${input.timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
        )
      }
      if (aborted) meta.push("User aborted the command")
      const raw = list.map((item) => item.text).join("")
      const end = tail(raw, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) {
        file = yield* trunc.write(raw)
      }

      let output = end.text
      if (!output) output = "(no output)"

      if (cut && file) {
        output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      }

      if (meta.length > 0) {
        output += "\n\n<shell_metadata>\n" + meta.join("\n") + "\n</shell_metadata>"
      }
      return {
        title: input.command,
        metadata: {
          output: last || preview(output),
          exit: code,
          truncated: cut,
          ...(cut && file ? { outputPath: file } : {}),
        },
        output,
      }
    })

    return () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const shell = Shell.acceptable(cfg.shell)
        const name = Shell.name(shell)
        const limits = yield* trunc.limits()
        const prompt = ShellPrompt.render(name, process.platform, limits, defaultTimeoutMs)
        yield* Effect.logInfo("shell tool using shell", { shell })

        return {
          description: prompt.description,
          parameters: prompt.parameters,
          execute: (params: Parameters, ctx: Tool.Context) =>
            Effect.gen(function* () {
              const instanceCtx = yield* InstanceState.context
              const cwd = params.workdir
                ? yield* resolvePath(params.workdir, instanceCtx.directory, shell)
                : instanceCtx.directory
              if (params.timeout !== undefined && params.timeout < 0) {
                throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
              }
              const timeout = params.timeout ?? defaultTimeoutMs
              const ps = Shell.ps(shell)
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const scan = yield* collect(params.command, cwd, ps, shell, instanceCtx)
                  if (!containsPath(cwd, instanceCtx)) scan.dirs.add(cwd)
                  yield* ask(ctx, scan, params)
                }),
              )

              const classification = classifyCommand(params.command)
              if (classification.level === "blocked") {
                return yield* Effect.die(new ShellBlockedError({ classification }))
              }

              const result = yield* run(
                {
                  shell,
                  command: params.command,
                  cwd,
                  env: yield* shellEnv(ctx, cwd),
                  timeout,
                },
                ctx,
              )
              yield* SessionCwd.publishIfChanged(ctx.sessionID, cwd, events, instanceCtx.directory)
              return result
            }),
        }
      })
  }),
)
