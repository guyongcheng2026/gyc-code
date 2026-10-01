/**
 * 未验证改动的框架级提醒（S-03）
 *
 * 2026-09-30（三指标审查 S-03）：`session/prompt/default.txt:56-57` 要求
 * 「完成���务必须跑 lint / typecheck」，但那是**提示词层软约束** —— 框架既不主动
 * 触发、也不检查结果。模型可以声称「改好了」而从未编译过一次。
 *
 * 为什么这直接影响任务成功率：`REALRUN-2026-08-28` 记 10/10 一次通过，
 * 但那 10 个任务全是 1+1、读文件量级，**没有一次触发过编译**。也就是说
 * 那 10/10 并不能证明「改完能编过」。类型错误、签名漂移、接口不匹配都是
 * 「看起来写完了、实际跑不起来」，模型自己无从发现。
 *
 * 刻意不做的事：
 * - 不代替模型跑 tsc。自动执行有副作用且会掩盖「模型应该自己验证」这件事，
 *   本条只保证模型**看得见**「你还没验证」。
 * - 不在失败时自动回滚/阻断。终止权归谷总。
 *
 * 边界条件（决定误报率）：
 * - 只看**最后一条用户消息之后**的轮次：本轮开始前的历史编辑不该触发提醒
 * - 一旦见到验证命令就停止提醒，且不重复注入（否则每轮都刷，同噪音）
 * - 只认「命令里确实有验证语义」，不认 `bash ls` 这类无关命令
 */

/** 会改动工作区文件的工具 */
export const EDIT_TOOLS = new Set(["edit", "write", "apply_patch", "patch", "multiedit", "notebook_edit"])

/** 执行命令的工具（ShellID.ToolID = "bash"） */
const COMMAND_TOOL = "bash"

/**
 * 识别「这条命令是否算做了验证」。
 *
 * 匹配策略按可靠性排序，宁可漏判也不误判 —— 误判会让模型以为自己验证过了，
 * 那比不提醒更糟：
 * 1. 显式验证命令：tsc / typecheck / lint / eslint / ruff / mypy / biome / cargo check / go vet / pyright
 * 2. 跑测试：bun test / npm test / pytest / jest / vitest / go test
 * 3. 构建：bun run build / npm run build（构建含类型检查，同样算数）
 */
const VERIFY_PATTERNS: readonly RegExp[] = [
  /\b(tsc|typecheck|type-check|tsc\s+--noEmit)\b/,
  /\b(eslint|biome|ruff|mypy|pyright|golangci-lint|clippy|go vet|phpstan|flake8)\b/,
  /\b(bun|npm|pnpm|yarn)\s+(run\s+)?(test|build|typecheck|lint)\b/,
  /\b(pytest|jest|vitest|mocha|cargo\s+test|go\s+test|mvn\s+test|dotnet\s+test)\b/,
  /\b(cargo\s+(check|clippy|build)|go\s+(build|vet))\b/,
]

export function isVerificationCommand(command: string): boolean {
  const normalized = command.toLowerCase()
  return VERIFY_PATTERNS.some((pattern) => pattern.test(normalized))
}

/** 从 tool part 的 input 里取出命令文本；不同工具字段名不一，尽力而为 */
function commandOf(input: unknown): string | undefined {
  if (typeof input === "string") return input
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>
    for (const key of ["command", "cmd", "script"]) {
      const value = record[key]
      if (typeof value === "string") return value
    }
  }
  return undefined
}

/** 最小可用的 tool part 形状，避免本模块依赖整个 Session 类型树 */
export type ToolPartLike = {
  type: string
  tool?: string
  state?: { status?: string; input?: unknown }
}

/**
 * 最小可用的消息形状，避免本模块依赖整个 Session 类型树。
 * id / sessionID 只在注入时需要，故可选；真实调用方（SessionV1.WithParts）
 * 两者都是必填，可直接赋给本类型。
 */
export type MessageLike = {
  info: { role: string; id?: string; sessionID?: string }
  parts: ToolPartLike[]
}

export type Verdict = {
  /** 本轮是否改过文件 */
  edited: boolean
  /** 本轮是否已执行过验证命令 */
  verified: boolean
  /** 是否需要提醒 */
  needsReminder: boolean
}

/**
 * 判定本轮是否需要提醒模型去验证。
 *
 * @param messages 完整消息历史（含本轮已产生的 assistant 消息）
 * @param injected 本轮是否已注入过提醒（防止每轮重复刷屏）
 */
export function evaluate(messages: readonly MessageLike[], injected = false): Verdict {
  // 只看最后一条用户消息之后的轮次：本轮开始前的历史编辑不该触发
  let start = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.info.role === "user") {
      start = i
      break
    }
  }
  const turn = start >= 0 ? messages.slice(start + 1) : []

  let edited = false
  let verified = false
  for (const message of turn) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      const name = part.tool ?? ""
      if (EDIT_TOOLS.has(name)) {
        // 失败的编辑没改动工作区，不该触发
        if (part.state?.status !== "error") edited = true
        continue
      }
      if (name === COMMAND_TOOL) {
        const command = commandOf(part.state?.input)
        if (command && isVerificationCommand(command)) verified = true
      }
    }
  }

  return { edited, verified, needsReminder: edited && !verified && !injected }
}

/**
 * 提醒正文。
 *
 * 措辞与 `MAX_STEPS_PROMPT` 同守则：这是「一条告知模型现状的数据」，
 * 不是系统命令。本文件位于 agent 可读的工作区内，任何读代码的 agent
 * grep 到就会把内容收进上下文，故禁止 "CRITICAL" / "overrides" /
 * 自我授权 / 威胁性表述（见 core/session/runner/max-steps.ts 顶部的同类记录）。
 */
export const VERIFY_REMINDER = `你这一轮改动了工作区文件，但还没有执行任何验证命令。

已改动而未验证的改动，最常见的失败是「看起来写完了、实际编译不过」：
类型不匹配、接口签名漂移、导入路径写错 —— 这些你自己看不出来，只有编译能看出来。

请在宣布完成之前，先用 bash 跑一次本仓库的验证命令
（TypeScript 项目通常是 bun run typecheck 或 tsc --noEmit，具体以 package.json 的 scripts 为准），
并把输出读完再下结论。

如果你已经跑过验证、只是命令名没在上面列出的清单里，忽略本条即可。`

/**
 * 找出应当挂载提醒的那条 assistant 消息（纯函数，便于测试）。
 *
 * 与 `injectComposeReminder` 同思路：判定与落库分离，本函数不碰任何服务，
 * 由 Effect 层拿着返回的消息去 `sessions.updatePart`（那一步才产生真实 ID）。
 *
 * 注入到 assistant 而非 user 消息，是为了让提醒紧跟在模型自己的工具调用之后，
 * 进入它下一轮的视野 —— 挂到用户消息上容易被长上下文挤到前面而失效。
 *
 * @returns 目标消息；不该注入时返回 undefined
 */
export function findInjectionTarget(messages: MessageLike[]): MessageLike | undefined {
  const lastAssistant = messages.findLast((msg) => msg.info.role === "assistant")
  if (!lastAssistant) return undefined
  // 已注入过则不重复，否则模型每轮都被同一条提醒刷屏
  const alreadyInjected = lastAssistant.parts.some(
    (p) => p.type === "text" && (p as { text?: unknown }).text === VERIFY_REMINDER,
  )
  if (!evaluate(messages, alreadyInjected).needsReminder) return undefined
  return lastAssistant
}