import * as prompts from "@clack/prompts"
import { Effect, Option } from "effect"

export const intro = (msg: string) => Effect.sync(() => prompts.intro(msg))
export const outro = (msg: string) => Effect.sync(() => prompts.outro(msg))

export const log = {
  info: (msg: string) => Effect.sync(() => prompts.log.info(msg)),
  error: (msg: string) => Effect.sync(() => prompts.log.error(msg)),
  warn: (msg: string) => Effect.sync(() => prompts.log.warn(msg)),
  success: (msg: string) => Effect.sync(() => prompts.log.success(msg)),
}

// @clack/prompts 1.8 起 text/password 的返回类型放宽为 `string | symbol`（symbol 表示取消），
// select/autocomplete 则是 `Value | symbol`。这里统一在收窄点把 symbol 归入 none，
// 调用方拿到的就是纯 Value，不必各自再判一次。
// 用返回类型谓词的自定义函数而非内联 typeof：Value 本身可能就是 symbol
// （泛型未实例化时），typeof 判断对它是 no-op，收窄不生效。
function isCancelSymbol(result: unknown): result is symbol {
  return typeof result === "symbol"
}

const optional = <Value>(result: Value | symbol): Option.Option<Value> => {
  if (isCancelSymbol(result)) return Option.none()
  return Option.some(result)
}

// 显式传类型参数：`optional(result)` 无法从 `prompts.select` 的返回值反推这里的 Value
// （`Parameters<typeof prompts.select<Value>>` 里的 Value 是本函数自己的类型参数），
// 不显式给就会退化成含 symbol 的联合类型，调用方拿到的值上就多出 symbol 分支。
export const select = <Value>(opts: Parameters<typeof prompts.select<Value>>[0]) =>
  Effect.promise(() => prompts.select(opts)).pipe(Effect.map((result) => optional<Value>(result)))

export const autocomplete = <Value>(opts: Parameters<typeof prompts.autocomplete<Value>>[0]) =>
  Effect.promise(() => prompts.autocomplete(opts)).pipe(Effect.map((result) => optional<Value>(result)))

export const text = (opts: Parameters<typeof prompts.text>[0]) =>
  Effect.promise(() => prompts.text(opts)).pipe(Effect.map((result) => optional<string>(result)))

export const password = (opts: Parameters<typeof prompts.password>[0]) =>
  Effect.promise(() => prompts.password(opts)).pipe(Effect.map((result) => optional<string>(result)))

export const spinner = () => {
  const s = prompts.spinner()
  return {
    start: (msg: string) => Effect.sync(() => s.start(msg)),
    stop: (msg: string) => Effect.sync(() => s.stop(msg)),
  }
}
