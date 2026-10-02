import { Show, createMemo, type JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { limitContent, DEFAULT_MAX_CONTENT_BYTES, DEFAULT_MAX_CONTENT_LINES } from "../util/limit-content"
import { canRenderRich } from "../util/handle-budget"

/**
 * 受限富渲染：长会话 / 超长会话崩溃的统一闸门。
 *
 * 背景（opentui 0.5.6 原生句柄表上限 65,535）：
 * 消息虚拟化（virtual-window.ts）只裁「消息条数」，不裁单条内容的行数。一条
 * 5 万行的工具输出或一个数 MB 的 diff，会在 <markdown>/<diff> 内部按行创建
 * 原生 text_buffer，单独即可撞上句柄上限，表现为「打开会话即退出」。
 *
 * 本组件做两件事：
 * 1. 行数 + 字节上限折叠（limit-content.ts），保证送进渲染器的内容量有界；
 * 2. 句柄预算查询（handle-budget.ts），预算不足时降级为纯 <text> 摘要。
 *
 * 降级对用户可见：追加一行说明被折叠/降级的行数，避免「静默丢数据」的误解。
 */
export function LimitedContent(props: {
  /** 原始内容。 */
  text: string
  /** 真实列宽（用于折行估算），未知时传 undefined 走保守下界。 */
  cols?: number
  /** 行数上限；默认 DEFAULT_MAX_CONTENT_LINES。 */
  maxLines?: number
  /** 字节上限；默认 DEFAULT_MAX_CONTENT_BYTES。 */
  maxBytes?: number
  /** 预算充足时的富渲染分支（opentui <markdown>/<diff>/<code> 等）。 */
  rich: () => JSX.Element
  /** 降级分支：纯文本渲染，必须不创建额外的块级节点。 */
  plain: (text: string) => JSX.Element
  /** 折叠提示行的前景色。 */
  plainColor: RGBA
}) {
  const limited = createMemo(() =>
    limitContent(props.text, {
      maxLines: props.maxLines ?? DEFAULT_MAX_CONTENT_LINES,
      maxBytes: props.maxBytes ?? DEFAULT_MAX_CONTENT_BYTES,
    }),
  )
  // 句柄预算不足时降级：纯文本按行渲染仍会占句柄，但结构简单、无块级 style，
  // 单位内容句柄数远低于 markdown/diff。
  const affordable = createMemo(() => canRenderRich(limited().text, props.cols))
  return (
    <>
      <Show when={affordable()} fallback={<>{props.plain(limited().text)}</>}>
        {props.rich()}
      </Show>
      <Show when={limited().truncated}>
        <text fg={props.plainColor}>（内容过长，已折叠 {limited().hiddenLines} 行）</text>
      </Show>
    </>
  )
}
