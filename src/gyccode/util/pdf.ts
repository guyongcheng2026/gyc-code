import { inflateSync } from "node:zlib"

/**
 * P1-8（对标指标 8 · PDF 解析）：零新增依赖的 PDF 文字层抽取器。
 *
 * 背景：read.ts 此前只能把 PDF 整份 base64 当附件丢给模型（read.ts:357-385），
 * 既费 token，又要求模型自身具备 PDF 视觉能力。这里在本地把「文字层」抽成
 * 纯文本，弱模型也能读，且只花文字量的 token。
 *
 * 能力边界（务必如实告知模型，禁止当权威事实使用）：
 *  - 只抽**文字层**。扫描件 / 图片型 PDF 没有文字层，会明确返回 hasText=false。
 *  - 不还原版面、表格结构与内嵌图片；不做 OCR。
 *  - 支持 FlateDecode / ASCIIHex / ASCII85 / RunLength 与 PNG/TIFF 预测器；
 *    LZW 与加密（DRM）文档不支持，原因会写进 warnings。
 */

/** 名称（/Foo） */
type Name = { readonly name: string }
/** 间接引用（N G R） */
type Ref = { readonly ref: number; readonly gen: number }
type Dict = Map<string, PdfValue>
type PdfValue = null | boolean | number | Name | string | Ref | PdfValue[] | Dict | Stream
type Stream = { readonly dict: Dict; readonly data: Uint8Array }

export type PdfPageText = { readonly page: number; readonly text: string }

export type PdfExtractResult = {
  /** PDF 头声明的版本，如 "1.7" */
  readonly version: string
  /** 文档总页数（按页树统计） */
  readonly pageCount: number
  readonly pages: PdfPageText[]
  /** 是否有任何一页抽到了非空文字 */
  readonly hasText: boolean
  /** 局限与降级原因，会原样回灌给模型 */
  readonly warnings: string[]
}

export type PdfExtractOptions = {
  /** 最多解析多少页，默认 50 */
  readonly maxPages?: number
  /** 全文最多保留多少字符，默认 200000 */
  readonly maxChars?: number
}

const DEFAULT_MAX_PAGES = 50
const DEFAULT_MAX_CHARS = 200_000
/** 表单 XObject 递归深度上限，避免异常 PDF 造成栈溢出 */
const MAX_FORM_DEPTH = 8

const WS = new Set(["\0", "\t", "\n", "\f", "\r", " "])
const DELIM = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"])

const isName = (v: PdfValue | undefined): v is Name => typeof v === "object" && v !== null && "name" in v
const isRef = (v: PdfValue | undefined): v is Ref => typeof v === "object" && v !== null && "ref" in v
const isDict = (v: PdfValue | undefined): v is Dict => v instanceof Map
const isStream = (v: PdfValue | undefined): v is Stream =>
  typeof v === "object" && v !== null && "dict" in v && "data" in v

const dictName = (d: Dict | undefined, key: string): Name | undefined => {
  const v = d?.get(key)
  return isName(v) ? v : undefined
}

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "")
  const out = new Uint8Array(Math.floor(clean.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** UTF-16BE 十六进制串（ToUnicode 的目标值）转字符串 */
const utf16beToString = (hex: string): string => {
  const bytes = hexToBytes(hex)
  if (bytes.length === 1) return String.fromCharCode(bytes[0] ?? 0)
  let out = ""
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0))
  }
  return out
}

// ── 词法/语法：把 latin1 视图解析成 PDF 对象 ────────────────────────────────

class Lexer {
  pos = 0
  /** 解析 /Length 这类间接引用时用来回查文档 */
  resolve: (v: PdfValue | undefined) => PdfValue = (v) => v ?? null

  constructor(readonly src: string) {}

  skipWs() {
    for (;;) {
      const ch = this.src[this.pos]
      if (ch === undefined) return
      if (WS.has(ch)) {
        this.pos++
        continue
      }
      if (ch === "%") {
        while (this.pos < this.src.length && this.src[this.pos] !== "\n" && this.src[this.pos] !== "\r") this.pos++
        continue
      }
      return
    }
  }

  /** 读一个裸词（运算符关键字 / 数字） */
  token(): string {
    this.skipWs()
    const start = this.pos
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]!
      if (WS.has(ch) || DELIM.has(ch)) break
      this.pos++
    }
    return this.src.slice(start, this.pos)
  }

  peekKeyword(word: string): boolean {
    this.skipWs()
    return this.src.startsWith(word, this.pos)
  }

  value(depth = 0): PdfValue {
    if (depth > 64) return null
    this.skipWs()
    const ch = this.src[this.pos]
    if (ch === undefined) return null
    if (ch === "<") {
      if (this.src.startsWith("<<", this.pos)) return this.dictOrStream(depth)
      this.pos++
      const end = this.src.indexOf(">", this.pos)
      const hex = end === -1 ? this.src.slice(this.pos) : this.src.slice(this.pos, end)
      this.pos = end === -1 ? this.src.length : end + 1
      return Buffer.from(hexToBytes(hex)).toString("latin1")
    }
    if (ch === "[") {
      this.pos++
      const out: PdfValue[] = []
      for (;;) {
        this.skipWs()
        const c = this.src[this.pos]
        if (c === undefined || c === "]") {
          this.pos++
          return out
        }
        const before = this.pos
        out.push(this.value(depth + 1))
        if (this.pos === before) this.pos++ // 兜底防死循环
      }
    }
    if (ch === "/") {
      this.pos++
      const start = this.pos
      while (this.pos < this.src.length) {
        const c = this.src[this.pos]!
        if (WS.has(c) || DELIM.has(c)) break
        this.pos++
      }
      return { name: this.src.slice(start, this.pos) }
    }
    if (ch === "(") {
      this.pos++
      let out = ""
      let nest = 1
      while (this.pos < this.src.length) {
        const c = this.src[this.pos]!
        this.pos++
        if (c === "\\") {
          const e = this.src[this.pos]
          if (e === undefined) break
          this.pos++
          if (e >= "0" && e <= "7") {
            let oct = e
            for (let k = 0; k < 2; k++) {
              const n = this.src[this.pos]
              if (n === undefined || n < "0" || n > "7") break
              oct += n
              this.pos++
            }
            out += String.fromCharCode(Number.parseInt(oct, 8) & 0xff)
            continue
          }
          out +=
            e === "n" ? "\n" : e === "r" ? "\r" : e === "t" ? "\t" : e === "b" ? "\b" : e === "f" ? "\f" : e
          continue
        }
        if (c === "(") {
          nest++
          out += c
          continue
        }
        if (c === ")") {
          nest--
          if (nest === 0) break
          out += c
          continue
        }
        out += c
      }
      return out
    }
    const word = this.token()
    if (word === "true") return true
    if (word === "false") return false
    if (word === "null") return null
    const num = Number(word)
    if (word !== "" && Number.isFinite(num)) {
      // 可能是 "N G R" 间接引用
      const save = this.pos
      this.skipWs()
      const second = this.token()
      if (/^[+-]?\d+$/.test(second)) {
        this.skipWs()
        if (this.src.startsWith("R", this.pos)) {
          const after = this.src[this.pos + 1]
          if (after === undefined || WS.has(after) || DELIM.has(after)) {
            this.pos++
            return { ref: num, gen: Number(second) }
          }
        }
      }
      this.pos = save
      return num
    }
    return null
  }

  dictOrStream(depth: number): PdfValue {
    this.pos += 2 // <<
    const dict: Dict = new Map()
    for (;;) {
      this.skipWs()
      if (this.src.startsWith(">>", this.pos)) {
        this.pos += 2
        break
      }
      if (this.pos >= this.src.length) break
      const before = this.pos
      const key = this.value(depth + 1)
      if (this.pos === before) {
        this.pos++
        continue
      }
      const val = this.value(depth + 1)
      if (isName(key)) dict.set(key.name, val)
    }
    if (!this.peekKeyword("stream")) return dict
    this.pos += "stream".length
    if (this.src[this.pos] === "\r") this.pos++
    if (this.src[this.pos] === "\n") this.pos++
    const start = this.pos
    const declared = this.resolve(dict.get("Length"))
    let end = typeof declared === "number" && declared >= 0 ? start + declared : -1
    if (end < 0 || end > this.src.length) {
      // /Length 是间接引用（首轮扫描时尚未收录）时只能回退到 endstream 定位
      const found = this.src.indexOf("endstream", start)
      end = found === -1 ? this.src.length : found
      while (end > start && (this.src[end - 1] === "\n" || this.src[end - 1] === "\r")) end--
    }
    const data = new Uint8Array(Buffer.from(this.src.slice(start, end), "latin1"))
    const tail = this.src.indexOf("endstream", end)
    this.pos = tail === -1 ? end : tail + "endstream".length
    return { dict, data }
  }
}

// ── 流过滤器 ────────────────────────────────────────────────────────────────

function applyPredictor(data: Uint8Array, parms: PdfValue, resolve: (v: PdfValue | undefined) => PdfValue): Uint8Array {
  const d = isDict(parms) ? parms : undefined
  if (!d) return data
  const predictor = Number(resolve(d.get("Predictor")))
  if (!Number.isFinite(predictor) || predictor < 2) return data
  const colors = Number(resolve(d.get("Colors"))) || 1
  const bpc = Number(resolve(d.get("BitsPerComponent"))) || 8
  const columns = Number(resolve(d.get("Columns"))) || 1
  if (bpc !== 8 || columns <= 0) return data // 非 8 位组件的预测器罕见，直接放行
  const bpp = colors
  const rowLength = columns * bpp

  if (predictor === 2) {
    // TIFF predictor：与左侧同分量像素相加
    const out = new Uint8Array(data)
    for (let base = 0; base + rowLength <= out.length; base += rowLength) {
      for (let i = bpp; i < rowLength; i++) {
        out[base + i] = (out[base + i]! + out[base + i - bpp]!) & 0xff
      }
    }
    return out
  }

  // PNG 预测器：每行首字节是行过滤类型
  const stride = rowLength + 1
  const rows = Math.floor(data.length / stride)
  const out = new Uint8Array(rows * rowLength)
  let prev = new Uint8Array(rowLength)
  for (let r = 0; r < rows; r++) {
    const type = data[r * stride] ?? 0
    const src = data.subarray(r * stride + 1, r * stride + 1 + rowLength)
    const cur = new Uint8Array(rowLength)
    for (let i = 0; i < rowLength; i++) {
      const raw = src[i] ?? 0
      const left = i >= bpp ? cur[i - bpp]! : 0
      const up = prev[i]!
      const upLeft = i >= bpp ? prev[i - bpp]! : 0
      let value = raw
      if (type === 1) value = raw + left
      else if (type === 2) value = raw + up
      else if (type === 3) value = raw + ((left + up) >> 1)
      else if (type === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
      }
      cur[i] = value & 0xff
    }
    out.set(cur, r * rowLength)
    prev = cur
  }
  return out
}

function asciiHexDecode(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let digits = ""
  for (const byte of data) {
    const ch = String.fromCharCode(byte)
    if (ch === ">") break
    if (!/[0-9a-fA-F]/.test(ch)) continue
    digits += ch
    if (digits.length === 2) {
      out.push(Number.parseInt(digits, 16))
      digits = ""
    }
  }
  if (digits.length === 1) out.push(Number.parseInt(digits + "0", 16))
  return new Uint8Array(out)
}

function ascii85Decode(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let tuple: number[] = []
  let i = 0
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2 // <~ 开头
  for (; i < data.length; i++) {
    const byte = data[i]!
    const ch = String.fromCharCode(byte)
    if (ch === "~") break
    if (WS.has(ch)) continue
    if (ch === "z" && tuple.length === 0) {
      out.push(0, 0, 0, 0)
      continue
    }
    if (byte < 33 || byte > 117) continue
    tuple.push(byte - 33)
    if (tuple.length === 5) {
      let value = 0
      for (const d of tuple) value = value * 85 + d
      out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
      tuple = []
    }
  }
  if (tuple.length > 1) {
    const count = tuple.length
    for (let k = count; k < 5; k++) tuple.push(84)
    let value = 0
    for (const d of tuple) value = value * 85 + d
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
    for (let k = 0; k < count - 1; k++) out.push(bytes[k]!)
  }
  return new Uint8Array(out)
}

function runLengthDecode(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let i = 0
  while (i < data.length) {
    const len = data[i]!
    i++
    if (len === 128) break
    if (len < 128) {
      for (let k = 0; k <= len && i < data.length; k++) out.push(data[i++]!)
      continue
    }
    const byte = data[i++] ?? 0
    for (let k = 0; k < 257 - len; k++) out.push(byte)
  }
  return new Uint8Array(out)
}

/** 按 /Filter + /DecodeParms 顺序解码流；不支持的过滤器抛错，由上层降级 */
function decodeStream(stream: Stream, resolve: (v: PdfValue | undefined) => PdfValue): Uint8Array {
  const filterValue = resolve(stream.dict.get("Filter"))
  const parmsValue = resolve(stream.dict.get("DecodeParms") ?? stream.dict.get("DP"))
  const filters: Name[] = isName(filterValue)
    ? [filterValue]
    : Array.isArray(filterValue)
      ? filterValue.filter(isName)
      : []
  const parms: PdfValue[] = Array.isArray(parmsValue) ? parmsValue : [parmsValue]
  let data = stream.data
  for (let i = 0; i < filters.length; i++) {
    const name = filters[i]!.name
    if (name === "FlateDecode" || name === "Fl") {
      data = applyPredictor(inflateSync(data), resolve(parms[i]), resolve)
    } else if (name === "ASCIIHexDecode" || name === "AHx") {
      data = asciiHexDecode(data)
    } else if (name === "ASCII85Decode" || name === "A85") {
      data = ascii85Decode(data)
    } else if (name === "RunLengthDecode" || name === "RL") {
      data = runLengthDecode(data)
    } else {
      throw new Error(`不支持的流过滤器 /${name}`)
    }
  }
  return data
}

function tryDecodeStream(stream: Stream, resolve: (v: PdfValue | undefined) => PdfValue): Uint8Array | undefined {
  try {
    return decodeStream(stream, resolve)
  } catch {
    return undefined
  }
}

// ── 文档 ────────────────────────────────────────────────────────────────────

type PageInfo = { readonly dict: Dict; readonly resources: Dict | undefined }

class PdfDoc {
  readonly objects = new Map<number, PdfValue>()
  readonly src: string
  readonly version: string
  readonly encrypted: boolean

  constructor(bytes: Uint8Array) {
    this.src = Buffer.from(bytes).toString("latin1")
    const header = /%PDF-(\d+\.\d+)/.exec(this.src)
    if (!header) throw new Error("不是 PDF 文件：缺少 %PDF- 文件头")
    this.version = header[1]!
    // /Encrypt 只存在于 trailer 或交叉引用流里（两者都不是普通间接对象），
    // 直接扫原文判断，避免给加密文档返回一堆无法解读的乱码文字。
    this.encrypted = /\/Encrypt[\s/]/.test(this.src)
    this.parseObjects()
    this.expandObjectStreams()
  }

  resolve = (v: PdfValue | undefined): PdfValue => (isRef(v) ? this.get(v.ref) : (v ?? null))

  get(num: number): PdfValue {
    return this.objects.get(num) ?? null
  }

  private parseObjects() {
    const occupied: Array<[number, number]> = []
    const re = /(\d+)\s+(\d+)\s+obj\b/g
    let match: RegExpExecArray | null
    while ((match = re.exec(this.src)) !== null) {
      const start = match.index
      // 落在已解析流的二进制区间内的 "N G obj" 只是巧合，跳过
      if (occupied.some(([s, e]) => start >= s && start < e)) continue
      const lexer = new Lexer(this.src)
      lexer.pos = start + match[0].length
      lexer.resolve = this.resolve
      let value: PdfValue
      try {
        value = lexer.value()
      } catch {
        continue
      }
      if (isStream(value)) occupied.push([start, lexer.pos])
      const num = Number(match[1])
      if (Number.isFinite(num) && !this.objects.has(num)) this.objects.set(num, value)
    }
  }

  /** PDF 1.5+ 把大量对象塞进压缩对象流，裸扫字节找不到，必须展开 */
  private expandObjectStreams() {
    for (const value of Array.from(this.objects.values())) {
      if (!isStream(value)) continue
      if (dictName(value.dict, "Type")?.name !== "ObjStm") continue
      const data = tryDecodeStream(value, this.resolve)
      if (!data) continue
      const text = Buffer.from(data).toString("latin1")
      const n = Number(this.resolve(value.dict.get("N")) ?? 0)
      const first = Number(this.resolve(value.dict.get("First")) ?? 0)
      const headerLexer = new Lexer(text)
      const pairs: Array<[number, number]> = []
      for (let i = 0; i < n; i++) {
        const num = Number(headerLexer.token())
        const off = Number(headerLexer.token())
        if (!Number.isFinite(num) || !Number.isFinite(off)) break
        pairs.push([num, off])
      }
      for (const [num, off] of pairs) {
        if (this.objects.has(num)) continue
        const lexer = new Lexer(text)
        lexer.pos = first + off
        lexer.resolve = this.resolve
        try {
          this.objects.set(num, lexer.value())
        } catch {
          // 单个对象解析失败不影响其余对象
        }
      }
    }
  }

  private findRoot(): Dict | undefined {
    const m = /\/Root\s+(\d+)\s+\d+\s+R/.exec(this.src)
    if (m) {
      const root = this.get(Number(m[1]))
      if (isDict(root)) return root
    }
    for (const value of this.objects.values()) {
      const d = isStream(value) ? value.dict : value
      if (isDict(d) && dictName(d, "Type")?.name === "Catalog") return d
    }
    return undefined
  }

  pages(): PageInfo[] {
    const out: PageInfo[] = []
    const root = this.findRoot()
    const tree = root ? this.resolve(root.get("Pages")) : undefined
    if (isDict(tree)) this.walk(tree, new Set(), out, undefined, 0)
    if (out.length === 0) {
      // 退化路径：页树损坏时按对象顺序收集所有 /Type /Page
      for (const value of this.objects.values()) {
        const d = isStream(value) ? value.dict : value
        if (isDict(d) && dictName(d, "Type")?.name === "Page") {
          const own = this.resolve(d.get("Resources"))
          out.push({ dict: d, resources: isDict(own) ? own : undefined })
        }
      }
    }
    return out
  }

  /** /Resources 可由祖先 Pages 节点继承，因此沿树下行时把父级带下来 */
  private walk(node: Dict, seen: Set<number>, out: PageInfo[], inherited: Dict | undefined, depth: number) {
    if (depth > 64) return
    if (dictName(node, "Type")?.name === "Page") {
      const own = this.resolve(node.get("Resources"))
      out.push({ dict: node, resources: isDict(own) ? own : inherited })
      return
    }
    const kids = this.resolve(node.get("Kids"))
    if (!Array.isArray(kids)) return
    const next = this.resolve(node.get("Resources"))
    const carried = isDict(next) ? next : inherited
    for (const kid of kids) {
      if (!isRef(kid) || seen.has(kid.ref)) continue // 循环保护
      seen.add(kid.ref)
      const child = this.resolve(kid)
      if (isDict(child)) this.walk(child, seen, out, carried, depth + 1)
    }
  }

  /** 拼接页面的全部内容流（/Contents 可能是流，也可能是流的数组） */
  contentText(page: PageInfo): { text: string; failed: boolean } {
    const value = this.resolve(page.dict.get("Contents"))
    const streams: Stream[] = []
    if (isStream(value)) streams.push(value)
    else if (Array.isArray(value)) {
      for (const item of value) {
        const s = this.resolve(item)
        if (isStream(s)) streams.push(s)
      }
    }
    if (streams.length === 0) return { text: "", failed: false }
    const parts: string[] = []
    let failed = false
    for (const stream of streams) {
      const data = tryDecodeStream(stream, this.resolve)
      if (!data) {
        failed = true
        continue
      }
      parts.push(Buffer.from(data).toString("latin1"))
    }
    return { text: parts.join("\n"), failed }
  }

  xobjects(resources: Dict | undefined): Dict {
    const value = this.resolve(resources?.get("XObject"))
    return isDict(value) ? value : new Map()
  }
}

// ── ToUnicode CMap ─────────────────────────────────────────────────────────

type CMap = { readonly map: Map<number, string>; readonly declared: 1 | 2 }

function parseCMap(text: string): CMap {
  const map = new Map<number, string>()
  // codespacerange 只是声明，实际码宽以 bfchar/bfrange 里出现的源码长度为准：
  // 真实 PDF 里两者经常不一致，以实测宽度为准更不容易解出乱码。
  let observed = 0

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of (block[1] ?? "").matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      const srcHex = entry[1] ?? ""
      observed = Math.max(observed, Math.ceil(srcHex.length / 2))
      map.set(Number.parseInt(srcHex, 16), utf16beToString(entry[2] ?? ""))
    }
  }

  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1] ?? ""
    // <lo> <hi> <dst>：目标值按「末位字节递增」展开
    for (const entry of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      const lo = Number.parseInt(entry[1] ?? "", 16)
      const hi = Number.parseInt(entry[2] ?? "", 16)
      observed = Math.max(observed, Math.ceil((entry[1] ?? "").length / 2))
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) continue
      const base = Buffer.from(hexToBytes(String(entry[3] ?? "")))
      for (let code = lo; code <= hi && code - lo < 65536; code++) {
        const bytes = Buffer.from(base)
        const last = bytes.length - 1
        if (last >= 0) bytes[last] = (bytes[last]! + (code - lo)) & 0xff
        map.set(code, bytes.toString("latin1"))
      }
    }
    // <lo> <hi> [ <d1> <d2> ... ]
    for (const entry of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g)) {
      const lo = Number.parseInt(entry[1] ?? "", 16)
      const hi = Number.parseInt(entry[2] ?? "", 16)
      observed = Math.max(observed, Math.ceil((entry[1] ?? "").length / 2))
      if (!Number.isFinite(lo)) continue
      let offset = 0
      for (const item of (entry[3] ?? "").matchAll(/<([0-9a-fA-F]*)>/g)) {
        const code = lo + offset
        if (code > hi) break
        map.set(code, utf16beToString(item[1] ?? ""))
        offset++
      }
    }
  }

  let declared: 1 | 2 = 1
  const spaceRange = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text)
  if (spaceRange) {
    const entry = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/.exec(spaceRange[1] ?? "")
    if (entry && (entry[1]?.length ?? 0) > 2) declared = 2
  }
  if (observed > 2) declared = 2
  else if (observed > 0) declared = 1

  return { map, declared }
}

const EMPTY_CMAP: CMap = { map: new Map<number, string>(), declared: 1 }

/**
 * 按给定字节宽度解码字符串，并统计「CMap 里查不到的码位」数量。
 * 统计用于择优：ToUnicode 常只覆盖子集，宽度猜错时靠它兜底。
 */
function decodeWith(bytes: Uint8Array, cmap: CMap, codeBytes: 1 | 2): { text: string; miss: number } {
  let text = ""
  let miss = 0
  let i = 0
  while (i < bytes.length) {
    let code: number
    if (codeBytes === 2) {
      if (i + 1 >= bytes.length) {
        miss++
        break
      }
      code = ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)
      i += 2
    } else {
      code = bytes[i] ?? 0
      i += 1
    }
    const mapped = cmap.map.get(code)
    if (mapped !== undefined) {
      text += mapped
      continue
    }
    // 完全没有 ToUnicode（标准 14 字体等）时按 latin1 直出。这是正确解码而非
    // 「查不到」，不能计入 miss——否则双字节猜测会因 miss 更少而胜出，
    // 产出隔一个字符取一个的乱码。
    if (cmap.map.size === 0) {
      text += String.fromCharCode(code & 0xff)
      continue
    }
    miss++
  }
  return { text, miss }
}

function decodeText(bytes: Uint8Array, cmap: CMap): string {
  const preferred = decodeWith(bytes, cmap, cmap.declared)
  if (preferred.miss === 0) return preferred.text
  const other = decodeWith(bytes, cmap, cmap.declared === 1 ? 2 : 1)
  return other.miss < preferred.miss ? other.text : preferred.text
}

// ── 内容流文字抽取 ──────────────────────────────────────────────────────────

type FontMap = Map<string, CMap>

function buildFontMap(doc: PdfDoc, resources: Dict | undefined): FontMap {
  const fonts = new Map<string, CMap>()
  const dict = doc.resolve(resources?.get("Font"))
  if (!isDict(dict)) return fonts
  for (const [name, ref] of dict) {
    const font = doc.resolve(ref)
    if (!isDict(font) && !isStream(font)) continue
    const fd = isStream(font) ? font.dict : font
    const toUnicode = doc.resolve(fd.get("ToUnicode"))
    if (!isStream(toUnicode)) continue
    const data = tryDecodeStream(toUnicode, doc.resolve)
    if (!data) continue
    fonts.set(name, parseCMap(Buffer.from(data).toString("latin1")))
  }
  return fonts
}

class TextSink {
  private parts: string[] = []

  push(text: string) {
    if (text.length === 0) return
    this.parts.push(text)
  }

  newline() {
    const last = this.parts[this.parts.length - 1]
    if (last === "\n" || this.parts.length === 0) return
    this.parts.push("\n")
  }

  toString(): string {
    return this.parts.join("")
  }
}

/** TJ 数组里的大负字距按「插入一个空格」处理，是还原词间空白的通行启发式 */
const SPACE_KERN_THRESHOLD = -120

function runOperators(
  doc: PdfDoc,
  content: string,
  fonts: FontMap,
  sink: TextSink,
  depth: number,
  resources: Dict | undefined,
) {
  if (depth > MAX_FORM_DEPTH) return
  const lexer = new Lexer(content)
  lexer.resolve = doc.resolve
  const operands: PdfValue[] = []
  let currentFont: CMap = EMPTY_CMAP
  let leading = 0
  let curX = 0
  let curY = 0
  let lastY: number | undefined

  const track = () => {
    if (lastY === undefined) {
      lastY = curY
      return
    }
    if (Math.abs(curY - lastY) > 0.5) sink.newline()
    lastY = curY
  }
  const showString = (v: PdfValue | undefined) => {
    if (typeof v !== "string" || v.length === 0) return
    sink.push(decodeText(new Uint8Array(Buffer.from(v, "latin1")), currentFont))
  }

  for (;;) {
    lexer.skipWs()
    if (lexer.pos >= content.length) break
    const ch = content[lexer.pos]!
    if (ch === "(" || ch === "<" || ch === "[" || ch === "/") {
      const before = lexer.pos
      const value = lexer.value()
      if (lexer.pos === before) break
      operands.push(value)
      if (operands.length > 512) operands.shift()
      continue
    }
    const start = lexer.pos
    const token = lexer.token()
    if (token === "") {
      lexer.pos = start + 1
      continue
    }
    if (token === "BI") {
      // 内联图像：跳到 EI，否则其中的字节会被误当操作符
      const rest = content.slice(lexer.pos)
      const ei = /[\s]EI[\s>]/.exec(rest)
      lexer.pos += ei?.index ?? rest.length
      operands.length = 0
      continue
    }
    // 裸数字是操作数（如 Td 的坐标、TJ 的字距），必须入栈；曾经被丢弃，
    // 导致换行定位与 TJ 字距全部失效
    if (/^[-+.0-9]/.test(token)) {
      const n = Number(token)
      if (Number.isFinite(n)) operands.push(n)
      continue
    }
    switch (token) {
      case "BT":
        operands.length = 0
        curX = 0
        curY = 0
        lastY = undefined
        sink.newline()
        break
      case "ET":
        operands.length = 0
        sink.newline()
        break
      case "Tf": {
        const name = operands.find(isName)
        currentFont = (name ? fonts.get(name.name) : undefined) ?? EMPTY_CMAP
        operands.length = 0
        break
      }
      case "TL":
        leading = Number(operands[operands.length - 1] ?? 0) || 0
        operands.length = 0
        break
      case "Td":
        curX += Number(operands[operands.length - 2] ?? 0) || 0
        curY += Number(operands[operands.length - 1] ?? 0) || 0
        track()
        operands.length = 0
        break
      case "TD":
        leading = -(Number(operands[operands.length - 1] ?? 0) || 0)
        curX += Number(operands[operands.length - 2] ?? 0) || 0
        curY += leading
        track()
        operands.length = 0
        break
      case "Tm":
        curX = Number(operands[operands.length - 2] ?? 0) || 0
        curY = Number(operands[operands.length - 1] ?? 0) || 0
        track()
        operands.length = 0
        break
      case "T*":
        curY -= leading
        track()
        operands.length = 0
        break
      case "Tj":
        showString(operands[operands.length - 1])
        operands.length = 0
        break
      case "TJ": {
        const arr = operands[operands.length - 1]
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (typeof item === "string") {
              if (item.length > 0) sink.push(decodeText(new Uint8Array(Buffer.from(item, "latin1")), currentFont))
              continue
            }
            if (typeof item === "number" && item <= SPACE_KERN_THRESHOLD) sink.push(" ")
          }
        }
        operands.length = 0
        break
      }
      case "'":
        curY -= leading
        track()
        showString(operands[operands.length - 1])
        operands.length = 0
        break
      case '"':
        curY -= leading
        track()
        showString(operands[operands.length - 1])
        operands.length = 0
        break
      case "Do": {
        const name = operands.find(isName)
        operands.length = 0
        if (!name) break
        const xobj = doc.resolve(doc.xobjects(resources).get(name.name))
        if (!isStream(xobj) || dictName(xobj.dict, "Subtype")?.name !== "Form") break
        const data = tryDecodeStream(xobj, doc.resolve)
        if (!data) break
        const inner = doc.resolve(xobj.dict.get("Resources"))
        const innerFonts = buildFontMap(doc, isDict(inner) ? inner : undefined)
        runOperators(doc, Buffer.from(data).toString("latin1"), innerFonts, sink, depth + 1, isDict(inner) ? inner : resources)
        break
      }
      default:
        operands.length = 0
    }
  }
}

// ── 对外入口 ────────────────────────────────────────────────────────────────

/** 归一化抽取结果：压掉行尾空白、合并多余空行、去掉首尾空行 */
function normalize(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * 抽取 PDF 文字层。
 *
 * 只返回**抽取结果**，不是权威事实：字体子集乱码、错误的 ToUnicode、
 * 版面还原缺失都会让结果与原文件有出入，调用方必须把局限一并告知模型。
 */
export function extractPdfText(bytes: Uint8Array, options: PdfExtractOptions = {}): PdfExtractResult {
  const doc = new PdfDoc(bytes)
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES)
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS)
  const warnings: string[] = []

  if (doc.encrypted) {
    warnings.push("该 PDF 已加密（口令/DRM 保护），本工具无法解密，未能提取任何文字。")
  }

  const all = doc.pages()
  const pageCount = all.length
  const selected = all.slice(0, maxPages)
  if (pageCount > selected.length) {
    warnings.push(`文档共 ${pageCount} 页，只解析了前 ${selected.length} 页；其余页面需要时请用 pages 参数分批读取。`)
  }

  const pages: PdfPageText[] = []
  let used = 0
  let decodeFailures = 0

  for (const [index, page] of selected.entries()) {
    if (used >= maxChars) {
      warnings.push(`全文超过 ${maxChars} 字符上限，已在第 ${index + 1} 页截断。`)
      break
    }
    const { text, failed } = doc.contentText(page)
    if (failed) decodeFailures++
    const fonts = buildFontMap(doc, page.resources)
    const sink = new TextSink()
    runOperators(doc, text, fonts, sink, 0, page.resources)
    const normalized = normalize(sink.toString())
    if (normalized.length === 0) continue
    used += normalized.length
    pages.push({ page: index + 1, text: normalized })
  }

  if (pages.length === 0) {
    warnings.push(
      "这个 PDF 没有可提取的文字层（常见于扫描件、图片型 PDF，或使用了不支持的流过滤器）。本工具不做 OCR，无法识别图片里的文字；请改用 read 工具交给支持视觉的模型。",
    )
  }
  if (decodeFailures > 0) {
    warnings.push(`有 ${decodeFailures} 页的内容流解码失败（可能是不支持的过滤器，如 LZW）。`)
  }

  return { version: doc.version, pageCount, pages, hasText: pages.length > 0, warnings }
}

/** 单页文字（工具按页批量读取时用） */
export function extractPdfPageText(bytes: Uint8Array, pageNumber: number): string | undefined {
  const doc = new PdfDoc(bytes)
  const page = doc.pages()[pageNumber - 1]
  if (!page) return undefined
  const fonts = buildFontMap(doc, page.resources)
  const sink = new TextSink()
  const { text } = doc.contentText(page)
  runOperators(doc, text, fonts, sink, 0, page.resources)
  return normalize(sink.toString())
}