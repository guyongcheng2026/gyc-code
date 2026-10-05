import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { limitContent, DEFAULT_MAX_CONTENT_BYTES, DEFAULT_MAX_CONTENT_LINES } from "../util/limit-content"
import { createHandleEstimateCache, globalHandleBudget } from "../util/handle-budget"

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
  /**
   * 预算充足时的富渲染分支（opentui <markdown>/<diff>/<code> 等）。
   *
   * 必须接收 limited 之后的文本作为参数：此前签名无参，调用点闭包里直接引用
   * 原始内容，导致折叠上限只对 plain 降级分支生效，富渲染这条真正吃句柄的
   * 路径完全绕过闸门——「打开超长会话即退出」的防护形同虚设。
   */
  rich: (text: string) => JSX.Element
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
  // 句柄预算必须真正占用，不能只查询。
  //
  // 此前只调 fits()（纯查询），全仓 reserve() 的生产调用点为零，used() 恒 0：
  //  - app.tsx:710/714 的句柄压力告警成了死代码；
  //  - fits 拿「单条内容 vs 全量 50535」比较，多条内容各自都判定为装得下，
  //    累计起来照样能撞上 65,535 的原生句柄上限。
  //
  // 这里在挂载期间按份 reserve，文本变化或组件卸载时归还；
  // reserve 本身在越界时返回 false 且不改变占用，正好就是原先 fits 的判定语义，
  // 因此占用一旦真实维护起来，比较自然变成累计口径。
  // 缓存实例建在 memo 之外：建在 memo 内部会每次重算都新建缓存，等于没缓存。
  // 每个 LimitedContent 实例一份，卸载即随组件消失，不跨会话共享。
  const estimateCached = createHandleEstimateCache()
  const handles = createMemo(() => estimateCached(limited().text, props.cols))
  const [affordable, setAffordable] = createSignal(false)
  let reserved = 0
  const acquire = () => {
    if (reserved > 0) {
      globalHandleBudget.release(reserved)
      reserved = 0
    }
    const amount = handles()
    reserved = globalHandleBudget.reserve(amount) ? amount : 0
    setAffordable(reserved > 0)
  }
  // 首次渲染前先占用，Show 首次求值时 affordable 才是准的
  acquire()
  createEffect(acquire)
  onCleanup(() => {
    if (reserved > 0) globalHandleBudget.release(reserved)
    reserved = 0
  })
  return (
    <>
      <Show
        when={affordable()}
        fallback={
          <>
            {splitPlainRows(limited().text, props.maxLines ?? DEFAULT_MAX_CONTENT_LINES).map((row) => (
              <text fg={props.plainColor}>{row}</text>
            ))}
          </>
        }
      >
        {props.rich(limited().text)}
      </Show>
      <Show when={limited().truncated}>
        <text fg={props.plainColor}>（内容过长，已折叠 {limited().hiddenLines} 行）</text>
      </Show>
    </>
  )
}

/**
 * plain 降级分支的按行切分。
 *
 * 降级到 plain 后若仍把整段内容塞进单个 <text>，极端超长内容在 plain 档同样会
 * 撑爆单个节点。这里按换行边界把内容切成多段，每段由调用方渲染成一个 <text>。
 *
 * 切分**不改变**总行数上限：调用方传入的上限（折叠上限）依然是硬约束，
 * 避免把「单节点过大」的问题搬成「节点过多」。
 *
 * 换行符（`\n` / `\r\n` / `\r`）原样保留在段尾，因此 `rows.join("")` 可无损还原原文。
 */
export function splitPlainRows(
	text: string,
	maxRows: number = DEFAULT_MAX_CONTENT_LINES,
): readonly string[] {
	const limit = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : DEFAULT_MAX_CONTENT_LINES
	if (text === "") return [""]
	const rows: string[] = []
	let start = 0
	while (start <= text.length) {
		if (rows.length >= limit) break
		let end = -1
		for (let index = start; index < text.length; index++) {
			const char = text.charCodeAt(index)
			if (char === 10) {
				// \n = 10
				end = index + 1
				break
			}
			if (char === 13) {
				// \r = 13。若紧跟 \n 则 CRLF 是一个行边界，必须整段吃掉，
				// 否则 \n 会被当成独立的一行，把 CRLF 文件拆出多余空段。
				end = text.charCodeAt(index + 1) === 10 ? index + 2 : index + 1
				break
			}
		}
		if (end === -1) {
			rows.push(text.slice(start))
			break
		}
		rows.push(text.slice(start, end))
		start = end
	}
	return rows
}