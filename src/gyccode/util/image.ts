/**
 * P1-7（对标指标 9 · OCR/图片描述）：零新增依赖的图片元数据与真实文本抽取。
 *
 * 定位要诚实说清楚——这里**不做 OCR**。模型若要「看」图片内容，仍然需要视觉能力。
 * 本模块提供的是图片的「客观事实」：格式、尺寸、色彩模式、DPI、EXIF 拍摄参数、
 * PNG 文本块，以及 SVG 里真实存在的 `<title>/<desc>/<text>` 文本。
 *
 * 它的价值在于：模型判断「这张图是什么尺寸的截图 / 有没有 EXIF 拍摄时间 /
 * SVG 里的文字是什么」时，不必把整张图 base64 读进上下文。
 */

export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "unknown"

export interface ImageInfo {
  format: ImageFormat
  mime: string
  width?: number
  height?: number
  /** 位深（PNG/JPEG 采样精度），单位 bit */
  bitDepth?: number
  /** 色彩类型或模式：PNG 用 IHDR colorType，JPEG 用 components 推得的模式名 */
  colorMode?: string
  /** 物理分辨率 DPI（PNG pHYs / JPEG JFIF 密度），矢量图无此项 */
  dpiX?: number
  dpiY?: number
  /** 动画帧数与循环次数（GIF/WebP 动图） */
  frames?: number
  /** 是否带 alpha 通道 */
  hasAlpha?: boolean
  /** PNG tEXt/iTXt/zTXt 里的键值；SVG 里的 title/desc/text 也放这里 */
  text?: Record<string, string>
  /** JPEG APP1 EXIF 中常见、可读的字段 */
  exif?: Record<string, string>
  /** 图片是否内嵌文本（SVG 文本、PNG 文本块、EXIF 描述） */
  embeddedText?: string
}

const u16be = (b: Uint8Array, o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0)
const u16le = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8)
const u32be = (b: Uint8Array, o: number) =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0

/** PNG IHDR 的 colorType -> 人话模式名 */
const PNG_COLOR_MODES: Record<number, string> = {
  0: "grayscale",
  2: "rgb",
  3: "palette",
  4: "grayscale+alpha",
  6: "rgba",
}

const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  unknown: "application/octet-stream",
}

// ── PNG ──────────────────────────────────────────────────────────────────────

function parsePng(b: Uint8Array): ImageInfo {
  // 签名 8 字节 + IHDR：length(4) type(4) width(4) height(4) ...
  const info: ImageInfo = { format: "png", mime: MIME_BY_FORMAT.png, bitDepth: b[24], hasAlpha: (b[25] ?? 0) === 4 || (b[25] ?? 0) === 6 }
  info.width = u32be(b, 16)
  info.height = u32be(b, 20)
  info.colorMode = PNG_COLOR_MODES[b[25] ?? 0]

  const text: Record<string, string> = {}
  // 从 IHDR 之后逐块走，直到遇到 IEND
  let pos = 8
  while (pos + 8 <= b.length) {
    const len = u32be(b, pos)
    const type = String.fromCharCode(...b.subarray(pos + 4, pos + 8))
    const dataStart = pos + 8
    const dataEnd = dataStart + len
    if (dataEnd > b.length) break

    if (type === "pHYs" && len >= 9) {
      const ppuX = u32be(b, dataStart)
      const ppuY = u32be(b, dataStart + 4)
      const unit = b[dataStart + 8]
      if (unit === 1) {
        // 像素/米 -> DPI（1 米 = 39.3701 英寸）
        info.dpiX = Math.round(ppuX * 0.0254)
        info.dpiY = Math.round(ppuY * 0.0254)
      }
    } else if (type === "tEXt") {
      // tEXt 是 keyword NUL text，不是 key=value
      const raw = Buffer.from(b.subarray(dataStart, dataEnd)).toString("latin1")
      const nul = raw.indexOf("\u0000")
      if (nul > 0) text[raw.slice(0, nul)] = sanitizeText(raw.slice(nul + 1))
    } else if (type === "iTXt") {
      // iTXt 是 keyword NUL flag method language NUL translated NUL text，文本在第 3 个 NUL 之后
      const raw = Buffer.from(b.subarray(dataStart, dataEnd)).toString("latin1")
      const parts = raw.split("\u0000")
      if (parts.length >= 4 && parts[0]) text[parts[0]] = sanitizeText(parts.slice(3).join("\u0000"))
    } else if (type === "zTXt") {
      // 压缩文本块，零依赖下不还原内容，只记下键名避免误以为没有
      const raw = Buffer.from(b.subarray(dataStart, dataEnd)).toString("latin1")
      const nul = raw.indexOf("\u0000")
      if (nul > 0) text[raw.slice(0, nul)] = "（zlib 压缩的文本块，未解压）"
    } else if (type === "acTL") {
      info.frames = u32be(b, dataStart)
    }
    if (type === "IEND") break
    pos = dataEnd + 4 // 跳过 CRC
  }
  if (Object.keys(text).length > 0) info.text = text
  return info
}

// ── JPEG ─────────────────────────────────────────────────────────────────────

/** JPEG 组件数 -> 色彩模式名 */
function jpegMode(components: number): string {
  if (components === 1) return "grayscale"
  if (components === 3) return "ycbcr"
  if (components === 4) return "cmyk"
  return `${components}components`
}

function parseExif(b: Uint8Array, start: number): Record<string, string> | undefined {
  // APP1 段以 "Exif\0\0" 开头，随后是 TIFF 头
  if (String.fromCharCode(...b.subarray(start, start + 6)) !== "Exif\u0000\u0000") return undefined
  const tiff = start + 6
  const order = String.fromCharCode(...b.subarray(tiff, tiff + 2))
  if (order !== "II" && order !== "MM") return undefined
  const le = order === "II"
  const rd16 = (o: number) => (le ? (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) : u16be(b, o))
  const rd32 = (o: number) => (le ? ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0 : u32be(b, o))

  const out: Record<string, string> = {}
  try {
    const ifd0 = tiff + rd32(tiff + 4)
    const count = rd16(ifd0)
    for (let i = 0; i < count; i++) {
      const entry = ifd0 + 2 + i * 12
      const tag = rd16(entry)
      // 0x010E/0x010F 图像描述，0x0110 型号，0x0112 朝向，0x0131 软件，0x0132 拍摄时间
      const names: Record<number, string> = {
        0x010e: "ImageDescription",
        0x010f: "Make",
        0x0110: "Model",
        0x0112: "Orientation",
        0x011a: "XResolution",
        0x011b: "YResolution",
        0x0131: "Software",
        0x0132: "DateTime",
        0x829a: "ExposureTime",
        0x829d: "FNumber",
        0x8827: "ISO",
        0x920a: "FocalLength",
      }
      const name = names[tag]
      if (!name) continue
      const type = rd16(entry + 2)
      const count4 = rd32(entry + 4)
      // EXIF 的值域只有 4 字节：字符串超过 4 字节时值域存的是「相对 TIFF 头的偏移」，
      // 真正的字符串在别处。只取能安全读出的内容，缩略图等大块数据一律跳过。
      if (type === 2) {
        const start = count4 <= 4 ? entry + 8 : tiff + rd32(entry + 8)
        if (count4 > 0 && start >= 0 && start + count4 <= b.length) {
          out[name] = sanitizeText(
            Buffer.from(b.subarray(start, start + count4)).toString("latin1").replace(/\0+$/, ""),
          )
        }
      } else if (type === 3 && count4 === 1) {
        out[name] = String(rd16(entry + 8))
      } else if (type === 4 && count4 === 1) {
        out[name] = String(rd32(entry + 8))
      }
    }
  } catch {
    // EXIF 结构损坏时返回已读到的部分，不让整张图的元数据解析失败
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseJpeg(b: Uint8Array): ImageInfo {
  const info: ImageInfo = { format: "jpeg", mime: MIME_BY_FORMAT.jpeg }
  let pos = 2
  while (pos + 3 < b.length) {
    if (b[pos] !== 0xff) {
      pos++
      continue
    }
    const marker = b[pos + 1] ?? 0
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2
      continue
    }
    const len = u16be(b, pos + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // SOFn：含尺寸与分量数
      info.bitDepth = b[pos + 4]
      info.height = u16be(b, pos + 5)
      info.width = u16be(b, pos + 7)
      const components = b[pos + 9] ?? 0
      info.colorMode = jpegMode(components)
      info.hasAlpha = components === 2
      break
    }
    if (marker === 0xe0 && String.fromCharCode(...b.subarray(pos + 4, pos + 8)) === "JFIF") {
      const units = b[pos + 11]
      if (units === 1) {
        info.dpiX = u16be(b, pos + 12)
        info.dpiY = u16be(b, pos + 14)
      } else if (units === 2) {
        info.dpiX = Math.round(u16be(b, pos + 12) * 2.54)
        info.dpiY = Math.round(u16be(b, pos + 14) * 2.54)
      }
    }
    if (marker === 0xe1) {
      const exif = parseExif(b, pos + 4)
      if (exif) info.exif = exif
    }
    if (marker === 0xda) break // 图像数据开始，后面是熵编码数据
    pos += 2 + len
  }
  return info
}

// ── GIF / WebP / BMP ─────────────────────────────────────────────────────────

function parseGif(b: Uint8Array): ImageInfo {
  const info: ImageInfo = { format: "gif", mime: MIME_BY_FORMAT.gif }
  info.width = u16le(b, 6)
  info.height = u16le(b, 8)
  const packed = b[10] ?? 0
  info.hasAlpha = (packed & 0x80) !== 0 // 全局颜色表有透明色索引
  info.colorMode = (packed & 0x08) !== 0 ? "palette" : "grayscale"
  // 图像描述块（0x2C）里可能有局部颜色表与透明色，据此判断逐帧 alpha
  for (let pos = 13; pos + 10 <= b.length; pos++) {
    if (b[pos] !== 0x2c) continue
    const localPacked = b[pos + 9] ?? 0
    if ((localPacked & 0x01) !== 0) info.hasAlpha = true
    break
  }
  info.frames = countGifFrames(b)
  return info
}

/** 统计 GIF 的图像描述块数量作为帧数；GIF 没有帧索引，只能这样数 */
function countGifFrames(b: Uint8Array): number {
  let frames = 0
  let pos = 13
  if ((b[10] ?? 0) & 0x80) pos += 3 * (2 ** ((b[10] ?? 0) & 0x07) + 1)
  while (pos < b.length) {
    const marker = b[pos] ?? 0
    if (marker === 0x3b) break
    if (marker === 0x21) {
      pos += 2
      while (pos < b.length && b[pos] !== 0) pos += 1 + (b[pos] ?? 0)
      pos++
      continue
    }
    if (marker === 0x2c) {
      frames++
      if (pos + 10 > b.length) break
      const localPacked = b[pos + 9] ?? 0
      pos += 10
      if (localPacked & 0x80) pos += 3 * (2 ** ((localPacked & 0x07) + 1))
      pos++ // LZW 最小码长
      while (pos < b.length && b[pos] !== 0) pos += 1 + (b[pos] ?? 0)
      pos++
      continue
    }
    pos++
  }
  return frames
}

function parseWebp(b: Uint8Array): ImageInfo {
  const info: ImageInfo = { format: "webp", mime: MIME_BY_FORMAT.webp }
  const chunk = String.fromCharCode(...b.subarray(12, 16))
  if (chunk === "VP8X" && b.length >= 30) {
    info.width = ((b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16)) + 1
    info.height = ((b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16)) + 1
    const flags = b[20] ?? 0
    info.hasAlpha = (flags & 0x10) !== 0
    if ((flags & 0x02) !== 0) info.frames = u16be(b, 21) + 1
  } else if (chunk === "VP8 ") {
    // 有损：帧头在 chunk 数据区
    info.width = u16be(b, 26) & 0x3fff
    info.height = u16be(b, 28) & 0x3fff
  } else if (chunk === "VP8L") {
    const bits = u32be(b, 21)
    info.width = (bits & 0x3fff) + 1
    info.height = ((bits >> 14) & 0x3fff) + 1
    info.hasAlpha = ((bits >> 28) & 0x01) !== 0
  }
  return info
}

function parseBmp(b: Uint8Array): ImageInfo {
  const info: ImageInfo = { format: "bmp", mime: MIME_BY_FORMAT.bmp }
  info.width = b[18]! | (b[19]! << 8) | (b[20]! << 16) | (b[21]! << 24)
  info.height = Math.abs(b[22]! | (b[23]! << 8) | (b[24]! << 16) | (b[25]! << 24))
  const bpp = u16be(b, 28)
  info.bitDepth = bpp
  info.hasAlpha = bpp === 32
  return info
}

// ── SVG ──────────────────────────────────────────────────────────────────────

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

// String.fromCodePoint 对 & 越界码点会抛 RangeError（合法范围 0..0x10FFFF，
// 且代理区 0xD800..0xDFFF 无对应字符）。SVG 是外部输入，&#x110000; 这种
// 构造出来的实体一旦漏过去就会一路冒泡到 describe-image.ts:70 的 Effect.orDie，
// 变成进程级中断。越界一律原样保留实体文本。
const codePoint = (value: number, all: string) =>
  Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
    ? String.fromCodePoint(value)
    : all

function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return codePoint(Number.parseInt(body.slice(2), 16), all)
    if (body.startsWith("#")) return codePoint(Number.parseInt(body.slice(1), 10), all)
    return XML_ENTITIES[body] ?? all
  })
}

/** 去标签、折叠空白，得到可读文本 */
function textOf(xml: string): string {
  return sanitizeText(
    decodeXml(
      xml
        .replace(/<[^>]*>/g, " ")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"),
    ),
  )
}

/** 折叠成单行并截断，避免把超长文本块灌进上下文 */
function sanitizeText(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim()
  return flat.length > 2000 ? `${flat.slice(0, 2000)}…（已截断）` : flat
}

/**
 * 按**总**预算拼接多个 <text> 的内容。
 *
 * 2000 字上限此前只作用在单个节点上（sanitizeText 逐个调用），一个含几百个
 * <text> 的 SVG 会把上限绕过几百倍，整份文本照灌进上下文。
 * 这里按累计长度裁剪，并在超限时说明丢了多少段，避免「静默丢内容」。
 */
function joinTextBudget(lines: readonly string[], budget = 2000): string {
  const SEP = " | "
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = line.length + (kept.length > 0 ? SEP.length : 0)
    if (used + cost > budget) break
    kept.push(line)
    used += cost
  }
  if (kept.length === lines.length) return kept.join(SEP)
  if (kept.length === 0) return "…（已截断）"
  return `${kept.join(SEP)}…（其余 ${lines.length - kept.length} 段已截断）`
}

function parseSvg(b: Uint8Array): ImageInfo {
  const xml = Buffer.from(b).toString("utf8")
  const info: ImageInfo = { format: "svg", mime: MIME_BY_FORMAT.svg, colorMode: "vector" }

  const widthAttr = /\bwidth\s*=\s*["']([\d.]+)\s*(px|pt|mm|cm|in|%)?["']/i.exec(xml)
  const heightAttr = /\bheight\s*=\s*["']([\d.]+)\s*(px|pt|mm|cm|in|%)?["']/i.exec(xml)
  const w = widthAttr ? Math.round(Number(widthAttr[1])) : undefined
  const h = heightAttr ? Math.round(Number(heightAttr[1])) : undefined
  info.width = w
  info.height = h
  if (!w || !h) {
    const vb = /viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(xml)
    if (vb) {
      info.width ??= Math.round(Number(vb[1]))
      info.height ??= Math.round(Number(vb[2]))
    }
  }

  const text: Record<string, string> = {}
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(xml)
  if (title) text.title = textOf(title[1]!)
  const desc = /<desc[^>]*>([\s\S]*?)<\/desc>/i.exec(xml)
  if (desc) text.desc = textOf(desc[1]!)

  // 逐个 <text> 元素取文字内容——SVG 里真实存在的文本，不是 OCR 猜的
  const nodes = [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
  if (nodes.length > 0) {
    const lines = nodes.map((m) => textOf(m[1]!)).filter((s) => s.length > 0)
    if (lines.length > 0) text.text = joinTextBudget(lines)
  }
  if (Object.keys(text).length > 0) info.text = text

  const embedded = [text.title, text.desc, text.text].filter((s): s is string => Boolean(s))
  if (embedded.length > 0) info.embeddedText = embedded.join("\n")
  return info
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

function sniff(bytes: Uint8Array): ImageFormat {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png"
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)).startsWith("GIF8")) return "gif"
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP")
    return "webp"
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp"

  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString("utf8").trim()
  if (head.startsWith("<?xml") || head.startsWith("<!DOCTYPE svg") || head.startsWith("<svg")) return "svg"
  if (/<svg[\s>]/i.test(head)) return "svg"
  return "unknown"
}

/** 读取图片的客观元数据；格式无法识别时抛错而不是给一堆猜测 */
export function readImageInfo(bytes: Uint8Array): ImageInfo {
  const format = sniff(bytes)
  switch (format) {
    case "png":
      return parsePng(bytes)
    case "jpeg":
      return parseJpeg(bytes)
    case "gif":
      return parseGif(bytes)
    case "webp":
      return parseWebp(bytes)
    case "bmp":
      return parseBmp(bytes)
    case "svg":
      return parseSvg(bytes)
    default:
      throw new Error("无法识别的图片格式（支持 PNG / JPEG / GIF / WebP / BMP / SVG）")
  }
}

/** 把元数据渲染成给模型看的中文说明 */
export function describeImage(info: ImageInfo, filepath?: string): string {
  const lines: string[] = []
  if (filepath) lines.push(`<path>${filepath}</path>`)
  lines.push(`<type>image</type>`)

  const facts: string[] = []
  if (info.width && info.height) facts.push(`${info.width}×${info.height} 像素`)
  if (info.colorMode) facts.push(`色彩模式 ${info.colorMode}`)
  if (info.bitDepth) facts.push(`${info.bitDepth} bit`)
  if (info.dpiX) facts.push(`${info.dpiX}×${info.dpiY} DPI`)
  if (info.hasAlpha) facts.push("含透明通道")
  if (info.frames && info.frames > 1) facts.push(`动画 ${info.frames} 帧`)
  lines.push(`<meta>${info.format.toUpperCase()} · ${facts.join(" · ") || "尺寸未知"}</meta>`)

  if (info.exif && Object.keys(info.exif).length > 0) {
    lines.push("<exif>")
    for (const [k, v] of Object.entries(info.exif)) lines.push(`${k}: ${v}`)
    lines.push("</exif>")
  }
  if (info.embeddedText) {
    lines.push("<embedded_text>", info.embeddedText, "</embedded_text>")
  } else if (info.text) {
    lines.push("<text_blocks>")
    for (const [k, v] of Object.entries(info.text)) lines.push(`${k}: ${v}`)
    lines.push("</text_blocks>")
  }

  lines.push(
    "<limitation>",
    "以上是图片的客观元数据与文件内嵌文本，本工具不做 OCR。",
    "要理解图片「画了什么」，仍需你自身具备视觉能力并直接查看图片；本工具无法替代看图。",
    "元数据由文件头解析得出，损坏的图片可能解析不完整。",
    "</limitation>",
  )
  return lines.join("\n")
}