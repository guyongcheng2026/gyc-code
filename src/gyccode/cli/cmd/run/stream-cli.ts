// 流式事件渲染（纯 CLI 版）：把 session 事件流镜像到 stdout。
// 非交互 CLI（gyc run / gyc "msg"）与纯 CLI 交互（gyc 无参）共用，
// 保证两种入口的流式输出行为完全一致。
import { EOL } from "os"
import { UI } from "../../ui"
import { type GyccodeClient, type ToolPart } from "@gyccode/protocol/v2"

type Inline = {
  icon: string
  title: string
  description?: string
}

function inline(info: Inline) {
  const suffix = info.description ? UI.Style.TEXT_DIM + ` ${info.description}` + UI.Style.TEXT_NORMAL : ""
  UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title + suffix)
}

function block(info: Inline, output?: string) {
  UI.empty()
  inline(info)
  if (!output?.trim()) return
  UI.println(output)
  UI.empty()
}

async function tool(part: ToolPart) {
  try {
    const { toolInlineInfo } = await import("./tool")
    const next = toolInlineInfo(part)
    if (next.mode === "block") {
      block(next, next.body)
      return
    }

    inline(next)
  } catch {
    inline({
      icon: "🅃",
      title: part.tool,
    })
  }
}

async function toolError(part: ToolPart) {
  try {
    const { toolInlineInfo } = await import("./tool")
    const next = toolInlineInfo(part)
    inline({
      icon: "✗",
      title: `${next.title} failed`,
      ...(next.description && { description: next.description }),
    })
    return
  } catch {
    inline({
      icon: "✗",
      title: `${part.tool} failed`,
    })
  }
}

export type PermissionAsk = {
  id: string
  sessionID: string
  permission: string
  patterns: Array<string>
  /** 请求来自子代理会话（对齐上游 opencode v1.18.20：run 模式需应答子代理权限） */
  subagent?: boolean
}

export type QuestionAsk = {
  id: string
  sessionID: string
  questions: Array<{
    header: string
    question: string
    options: Array<{ label: string; description?: string }>
    multiple?: boolean
    custom?: boolean
  }>
}

export type StreamInteractive = {
  askPermission: (permission: PermissionAsk) => Promise<"once" | "always" | "reject">
  askQuestion: (request: QuestionAsk) => Promise<Array<Array<string>> | undefined>
}

export type StreamQuestion = {
  reply: (requestID: string, answers: Array<Array<string>>) => Promise<unknown>
  reject: (requestID: string) => Promise<unknown>
}

export type SubagentInfo = {
  type: string
  description?: string
  status: string
  title?: string
}

export type StreamLoopInput = {
  client: GyccodeClient
  events: Awaited<ReturnType<GyccodeClient["event"]["subscribe"]>>
  sessionID: string
  format: "default" | "json"
  thinking: boolean
  auto: boolean
  interactive?: StreamInteractive
  question?: StreamQuestion
  onSubagent?: (info: SubagentInfo) => void
}

// 消费一个已订阅的事件流并镜像到 stdout/UI，直到会话 idle。
// 返回会话错误文本（若有）；调用方据此设置退出码。
export async function streamLoop(input: StreamLoopInput): Promise<string | undefined> {
  const { client, events, sessionID, format, thinking, auto, interactive, question, onSubagent } = input
  const toggles = new Map<string, boolean>()
  // 逐 token 流式输出：partID -> 已输出到 stdout 的字符数（part.text 是累计全文，差量即新增）
  const streamed = new Map<string, number>()
  // 流式文本已写出但行未闭合（避免工具/错误输出拼在半行文本后）
  let lineOpen = false
  const closeLine = () => {
    if (lineOpen) {
      process.stdout.write(EOL)
      lineOpen = false
    }
  }
  let error: string | undefined

  function emit(type: string, data: Record<string, unknown>) {
    if (format === "json") {
      process.stdout.write(
        JSON.stringify({
          type,
          timestamp: Date.now(),
          sessionID,
          ...data,
        }) + EOL,
      )
      return true
    }
    return false
  }

  for await (const event of events.stream) {
    if (
      event.type === "message.updated" &&
      event.properties.sessionID === sessionID &&
      event.properties.info.role === "assistant" &&
      format !== "json" &&
      toggles.get("start") !== true
    ) {
      UI.empty()
      // 轮次头 dim 小字（无符号前缀）。
      UI.println(`${UI.Style.TEXT_DIM}${event.properties.info.agent} · ${event.properties.info.modelID}${UI.Style.TEXT_NORMAL}`)
      UI.empty()
      toggles.set("start", true)
    }

    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.sessionID !== sessionID) continue

      if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
        if (emit("tool_use", { part })) continue
        closeLine()
        if (part.state.status === "completed") {
          await tool(part)
          continue
        }
        await toolError(part)
        UI.error(part.state.error)
      }

      if (
        part.type === "tool" &&
        part.tool === "task" &&
        part.state.status === "running" &&
        format !== "json"
      ) {
        if (toggles.get(part.id) === true) continue
        closeLine()
        await tool(part)
        toggles.set(part.id, true)
      }

      // 子代理状态收集（CLI /subagents 数据源）：task 工具任意状态都记录。
      if (part.type === "tool" && part.tool === "task" && onSubagent) {
        const status = part.state.status
        const input = "input" in part.state ? (part.state as { input?: { subagent_type?: string; description?: string } }).input : undefined
        const title = "title" in part.state ? (part.state as { title?: string }).title : undefined
        onSubagent({
          type: input?.subagent_type ?? "task",
          description: input?.description,
          status,
          title,
        })
      }

      if (part.type === "step-start") {
        if (emit("step_start", { part })) continue
      }

      if (part.type === "step-finish") {
        if (emit("step_finish", { part })) continue
      }

      if (part.type === "text") {
        if (emit("text", { part })) continue
        const full = part.text ?? ""
        if (!process.stdout.isTTY) {
          // 非 TTY：保持整段输出
          if (part.time?.end) {
            const text = full.trim()
            if (text) process.stdout.write(text + EOL)
          }
          continue
        }
        if (part.time?.end) {
          // 完成：补齐未流式输出的尾部（如有），收尾换行 + 空行
          const done = streamed.get(part.id) ?? 0
          streamed.delete(part.id)
          const tail = full.slice(done)
          if (!done && !tail.trim()) continue
          if (tail) process.stdout.write(tail)
          process.stdout.write(EOL)
          lineOpen = false
          UI.empty()
          continue
        }
        // 生成中：仅输出新增增量，实现逐 token 实时渲染
        const done = streamed.get(part.id) ?? 0
        if (full.length > done) {
          process.stdout.write(full.slice(done))
          streamed.set(part.id, full.length)
          lineOpen = true
        }
      }

      if (part.type === "reasoning" && part.time?.end && thinking) {
        if (emit("reasoning", { part })) continue
        const text = part.text.trim()
        if (!text) continue
        const line = `Thinking: ${text}`
        if (process.stdout.isTTY) {
          UI.empty()
          UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
          UI.empty()
          continue
        }
        process.stdout.write(line + EOL)
      }
    }

    if (event.type === "session.error") {
      const props = event.properties
      if (props.sessionID !== sessionID || !props.error) continue
      let err = String(props.error.name)
      if ("data" in props.error && props.error.data && "message" in props.error.data) {
        err = String(props.error.data.message)
      }
      error = error ? error + EOL + err : err
      if (emit("error", { error: props.error })) continue
      closeLine()
      UI.error(err)
      // 会话级错误（如模型限流 / 认证失败）意味着本轮已终结：立即结束事件
      // 消费，让调用方快速拿到错误并恢复提示符，而非继续空等 idle。
      break
    }

    if (
      event.type === "session.status" &&
      event.properties.sessionID === sessionID &&
      event.properties.status.type === "idle"
    ) {
      break
    }

    if (event.type === "permission.asked") {
      const permission = event.properties
      // 对齐上游 opencode v1.18.20：子代理会话触发的权限请求同样需要应答，
      // 否则会永久挂起（此前仅应答父会话，非本 sessionID 一律 continue 跳过）。
      const isSubagent = permission.sessionID !== sessionID
      const ask: PermissionAsk = { ...permission, subagent: isSubagent }

      if (auto) {
        await client.permission.reply({
          requestID: permission.id,
          reply: "once",
        })
      } else if (interactive) {
        const reply = await interactive.askPermission(ask)
        await client.permission.reply({
          requestID: permission.id,
          reply,
        })
      } else {
        UI.println(
          UI.Style.TEXT_WARNING_BOLD + "!",
          UI.Style.TEXT_NORMAL +
            `permission requested: ${permission.permission} (${permission.patterns.join(", ")})${isSubagent ? " [subagent]" : ""}; auto-rejecting`,
        )
        await client.permission.reply({
          requestID: permission.id,
          reply: "reject",
        })
      }
    }

    if (event.type === "question.asked") {
      const request = event.properties as QuestionAsk
      if (request.sessionID !== sessionID) continue

      if (interactive) {
        const answers = await interactive.askQuestion(request)
        if (answers) {
          await question?.reply(request.id, answers)
        } else {
          await question?.reject(request.id)
        }
      } else if (question) {
        const labels = request.questions.map((item) => item.header).join(", ")
        UI.println(
          UI.Style.TEXT_WARNING_BOLD + "!",
          UI.Style.TEXT_NORMAL + `question requested: ${labels}; auto-rejecting`,
        )
        await question.reject(request.id)
      } else {
        UI.println(
          UI.Style.TEXT_WARNING_BOLD + "!",
          UI.Style.TEXT_NORMAL + "question requested; no question handler, leaving unanswered",
        )
      }
    }
  }
  return error
}
