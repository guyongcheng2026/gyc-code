import { count as localCount, tokenize as localTokenize } from "./tokenizer"

/**
 * DeepSeek 模型绑定 tokenizer。
 * 优先动态导入已安装的 DeepSeek tokenizer 包（如 `@deepseek/tokenizer`）；
 * 未安装时回落到本地近似 tokenizer（`src/core/util/tokenizer.ts`），不抛错、不阻塞。
 */
export class DeepseekTokenizer {
  private readonly impl: { encode: (text: string) => number[]; decode: (ids: number[]) => string }

  constructor() {
    this.impl = this.loadImpl()
  }

  private loadImpl(): { encode: (text: string) => number[]; decode: (ids: number[]) => string } {
    // 动态导入已安装的 DeepSeek tokenizer 包；不声明顶层依赖，避免未安装时构建失败。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = (() => {
      try {
        return require("@deepseek/tokenizer")
      } catch {
        return undefined
      }
    })()
    if (mod && typeof mod.encode === "function" && typeof mod.decode === "function") {
      return { encode: mod.encode.bind(mod), decode: mod.decode.bind(mod) }
    }
    // 回落：本地近似 tokenizer。decode 按 Unicode 码点还原，encode 按 token 数组长度近似。
    return {
      encode: (text: string): number[] => localTokenize(text).map((_, i) => i),
      decode: (ids: number[]): string => ids.map((i) => String.fromCodePoint(i)).join(""),
    }
  }

  /** 文本 → DeepSeek token ID 数组。 */
  encode(text: string): number[] {
    return this.impl.encode(text)
  }

  /** token ID 数组 → 文本。 */
  decode(ids: readonly number[]): string {
    return this.impl.decode(Array.from(ids))
  }

  /** 文本 → token 数。 */
  count(text: string): number {
    return this.encode(text).length
  }
}

/**
 * 单例 DeepSeek tokenizer（进程内复用，避免重复 require）。
 */
let sharedTokenizer: DeepseekTokenizer | undefined

export function getDeepseekTokenizer(): DeepseekTokenizer {
  if (!sharedTokenizer) sharedTokenizer = new DeepseekTokenizer()
  return sharedTokenizer
}

/**
 * 使用 DeepSeek tokenizer 估算文本 token 数；未安装时回落到本地近似 `count`。
 */
export function estimateDeepSeek(text: string): number {
  if (!text) return 0
  return getDeepseekTokenizer().count(text)
}
