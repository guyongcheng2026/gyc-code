import { Effect, Stream } from "effect"
import iconv from "iconv-lite"

// 文本文件编码探测与解码（Windows 中文环境 GBK 兼容）
//
// 背景：Windows 中文系统存在大量 GBK/GB18030 存量文件（.bat、旧配置、csv/txt）。
// 若固定按 UTF-8 解码，GBK 字节会被解成 U+FFFD 替换符，模型读到乱码、写回时
// 原始内容永久损坏。本工具先探测编码，再按实际编码解码：
//   - UTF-8 BOM（EF BB BF）→ utf-8（TextDecoder 自动剥离 BOM）
//   - 无 BOM → 尝试 utf-8 严格解码；失败 → gb18030（GBK 超集，运行时原生支持）
// 探测基于文件头采样；流式解码全程使用同一编码，保证跨 chunk 边界一致。

export type TextFileEncoding = "utf-8" | "gb18030"

const UTF8_BOM: readonly number[] = [0xef, 0xbb, 0xbf]

/** 按文件头采样探测编码：UTF-8 BOM 优先；无 BOM 时 utf-8 严格解码失败则回退 gb18030。 */
export function detectTextEncoding(sample: Uint8Array): TextFileEncoding {
  if (
    sample.length >= 3 &&
    sample[0] === UTF8_BOM[0] &&
    sample[1] === UTF8_BOM[1] &&
    sample[2] === UTF8_BOM[2]
  ) {
    return "utf-8"
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample)
    return "utf-8"
  } catch {
    return "gb18030"
  }
}

/** 剥离字符串开头的 UTF-8 BOM（\uFEFF）：Node/effect 的 readFileString 保留 BOM，
 * JSON/JSONC 解析前应统一剥离（jsonc-parser 遇 BOM 报 InvalidSymbol）。 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 按探测编码创建解码器（utf-8 自动剥离 BOM；gb18030 覆盖 GBK 全量字节，无非法序列）。 */
export function createFileDecoder(encoding: TextFileEncoding): TextDecoder {
  return new TextDecoder(encoding)
}

/** 完整 buffer 自适应解码：UTF-8 严格解码失败则按 GB18030 解码（Windows 子进程/ripgrep 输出）。 */
export function decodeBufferText(bytes: Uint8Array): string {
  return createFileDecoder(detectTextEncoding(bytes)).decode(bytes)
}

/**
 * 子进程输出的流式自适应解码：首个 chunk 探测编码（UTF-8 严格失败回退 GB18030）。
 * 注意：TextDecoder 的流式跨 chunk 缓存仅对 UTF-8 有保证，GB18030 的未完成双字节
 * 序列会被丢弃（实测 D6 后接 D0 CE 会解成「形」而非「中」）。因此：
 *   - UTF-8 → 流式解码（实时输出，跨 chunk 正确）
 *   - GB18030 → 累积全部字节，流结束时一次性解码（Windows GBK 程序输出通常较小）
 * Windows 下兼容 GBK 程序输出（cmd 内建命令、旧工具）；非 Windows 输出仍为 UTF-8。
 */
export function decodeSubprocessStream<R, E>(stream: Stream.Stream<Uint8Array, E, R>): Stream.Stream<string, E, R> {
  return Stream.unwrap(
    Effect.sync(() => {
      const state: { encoding?: TextFileEncoding; utf8?: TextDecoder; pending: Uint8Array[] } = { pending: [] }
      let total = 0
      const decode = (bytes: Uint8Array): string => {
        if (state.encoding === undefined) {
          state.encoding = detectTextEncoding(bytes)
          if (state.encoding === "utf-8") state.utf8 = new TextDecoder("utf-8")
          else {
            state.pending.push(bytes)
            total += bytes.length
            return ""
          }
        }
        if (state.utf8) return state.utf8.decode(bytes, { stream: true })
        state.pending.push(bytes)
        total += bytes.length
        return ""
      }
      const flush = (): string => {
        if (state.encoding === "gb18030") {
          const merged = new Uint8Array(total)
          let offset = 0
          for (const bytes of state.pending) {
            merged.set(bytes, offset)
            offset += bytes.length
          }
          state.pending = []
          return new TextDecoder("gb18030").decode(merged)
        }
        return state.utf8?.decode() ?? ""
      }
      return stream.pipe(
        Stream.map((bytes) => decode(bytes)),
        Stream.concat(
          Stream.suspend(() => {
            const tail = flush()
            return tail === "" ? Stream.empty : Stream.make(tail)
          }),
        ),
      )
    }),
  )
}

/** 写回前的统一编码入口：剥离内容自带 BOM，按目标编码与 BOM 状态返回字符串（utf-8）或字节（gb18030）。
 * writeWithDirs / writeIfUnchanged 均接受 string | Uint8Array，各写链路可直接使用。 */
export function encodeForWrite(text: string, encoding: TextFileEncoding, bom: boolean): string | Uint8Array {
  const stripped = text.replace(/^\uFEFF+/, "")
  if (encoding === "utf-8") return bom ? `\uFEFF${stripped}` : stripped
  return iconv.encode(stripped, "gb18030")
}
