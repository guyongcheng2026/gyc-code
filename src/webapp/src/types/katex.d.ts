// katex 0.17 未内置 TS 类型：仅声明 webapp 用到的最小面
declare module "katex" {
  export interface KatexOptions {
    displayMode?: boolean
    throwOnError?: boolean
    output?: "html" | "mathml" | "htmlAndMathml"
    strict?: boolean | "ignore" | "warn" | "error"
  }
  export function renderToString(tex: string, options?: KatexOptions): string
}

declare module "katex/dist/katex.min.css"
