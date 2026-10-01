import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as Truncate from "./truncate"
import * as ShellBackground from "./shell/background"

const Parameters = Schema.Struct({
  action: Schema.Literals(["status", "kill", "list"]).annotate({
    description: `status: report whether the process is running, its recent output and exit code. kill: terminate the process (and its child processes). list: show all background commands.`,
  }),
  shell_id: Schema.optional(Schema.String).annotate({
    description: `The shell_id returned by the bash tool when background=true. Required for "status" and "kill"; omit it for "list".`,
  }),
  maxBytes: Schema.optional(Schema.Number).annotate({
    description: `How many trailing bytes of output to return for "status". Defaults to the output limit.`,
  }),
})

export type Parameters = Schema.Schema.Type<typeof Parameters>

/**
 * P0-4（对标指标 · Shell 执行）：bash 工具加了 background 后只能启动，
 * 模型还需要能回头看进度、拿退出码、终止进程。这个工具补上这段闭环——
 * 没有它，background 就只是「把进程丢出去不管」。
 */
export const BashBackgroundTool = Tool.define(
  "bash_background",
  Effect.gen(function* () {
    const trunc = yield* Truncate.Service

    return {
      description: `Inspect or stop a command that was started with the bash tool's "background" parameter.

Use action "status" to check whether the process is still running, read its recent output, and get its exit code once it finishes. Use action "kill" to terminate it. Use action "list" to see every background command started in this session.

Background commands are not bound by the bash tool's timeout, so a long-running dev server or watcher stays alive until you kill it. Remember to kill background commands you no longer need.`,
      parameters: Parameters,
      execute: (params: Parameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.metadata({ metadata: { output: "" } })

          if (params.action === "list") {
            const jobs = ShellBackground.list()
            const text =
              jobs.length === 0
                ? "(no background commands)"
                : jobs
                    .map(
                      (job) =>
                        `${job.id}  ${job.status.padEnd(7)}  ${new Date(job.startedAt).toISOString()}  ${job.command}`,
                    )
                    .join("\n")
            return {
              title: "background commands",
              metadata: { output: text, exit: null, truncated: false },
              output: text,
            }
          }

          const id = params.shell_id
          if (!id) {
            const text = `bash_background 失败：action "${params.action}" 需要 shell_id 参数。`
            return {
              title: "bash_background",
              metadata: { output: text, exit: null, truncated: false },
              output: text,
            }
          }

          if (params.action === "kill") {
            const result = ShellBackground.kill(id)
            const text = result.ok
              ? `已请求终止 shell_id=${id}。`
              : `bash_background kill 失败：${
                  result.reason === "unknown"
                    ? `找不到 shell_id=${id}（可能已因会话结束或超出保留上限被回收）。`
                    : `shell_id=${id} 已经结束，无需终止。`
                }`
            return {
              title: "bash_background",
              metadata: { output: text, exit: null, truncated: false },
              output: text,
            }
          }

          const limits = yield* trunc.limits()
          const maxBytes =
            params.maxBytes && params.maxBytes > 0 ? params.maxBytes : limits.maxBytes
          const snapshot = yield* Effect.promise(() => ShellBackground.tail(id, maxBytes))
          if (!snapshot) {
            const text = `bash_background status 失败：找不到 shell_id=${id}。`
            return {
              title: "bash_background",
              metadata: { output: text, exit: null, truncated: false },
              output: text,
            }
          }

          const { job, text } = snapshot
          const state =
            job.status === "running"
              ? "running"
              : `exited (exit code ${job.exitCode}${job.signal ? `, signal ${job.signal}` : ""})`
          const output = [
            `shell_id: ${job.id}`,
            `status: ${state}`,
            `command: ${job.command}`,
            `cwd: ${job.cwd}`,
            `output file: ${job.outputPath}`,
            `--- output ---`,
            text,
          ].join("\n")

          return {
            title: job.command,
            metadata: {
              output: text,
              exit: job.exitCode,
              truncated: text.startsWith("...earlier output omitted..."),
            },
            output,
          }
        }),
    }
  }),
)