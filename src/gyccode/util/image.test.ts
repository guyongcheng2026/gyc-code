import { describe, expect, it } from "bun:test"
import { deflateSync } from "node:zlib"
import { describeImage, readImageInfo } from "./image"

/**
 * P1-7（对标指标 9 · OCR/图片描述）：本工具不做 OCR，只给出图片的客观事实。
 * 夹具全部现造，不依赖仓库外二进制。
 */

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1")
const bytes = (...parts: Array<string | Uint8Array | number[]>) => {
  const bufs = parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(Uint8Array.from(p as number[]))))
  return new Uint8Array(Buffer.concat(bufs))
}

/** CRC32（PNG 每个 chunk 末尾都有） */
function crc32(b: Uint8Array): number {
  let c = ~0
  for (let i = 0; i < b.length; i++) {
    c ^= b[i]!
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(new Uint8Array(body)))
  return new Uint8Array(Buffer.concat([len, body, crc]))
}

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function png(width: number, height: number, opts: { colorType?: number; extra?: Uint8Array } = {}) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = opts.colorType ?? 6
  return bytes(PNG_SIG, chunk("IHDR", new Uint8Array(ihdr)), opts.extra ?? new Uint8Array(), chunk("IEND", new Uint8Array()))
}

function jpeg(markerSegments: Array<string | Uint8Array>, dims: { w: number; h: number } | null) {
  const bufs: Array<string | Uint8Array> = [bytes([0xff, 0xd8])]
  for (const seg of markerSegments) bufs.push(seg)
  if (dims) {
    const sof = Buffer.alloc(19)
    sof[0] = 0xff
    sof[1] = 0xc0
    sof.writeUInt16BE(17, 2)
    sof[4] = 8
    sof.writeUInt16BE(dims.h, 5)
    sof.writeUInt16BE(dims.w, 7)
    sof[9] = 3
    bufs.push(new Uint8Array(sof))
  }
  bufs.push(bytes([0xff, 0xd9]))
  return new Uint8Array(Buffer.concat(bufs.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p)))))
}

describe("readImageInfo", () => {
  it("解析 PNG 的尺寸、位深、色彩模式与 alpha", () => {
    const info = readImageInfo(png(800, 600))
    expect(info.format).toBe("png")
    expect(info.mime).toBe("image/png")
    expect(info.width).toBe(800)
    expect(info.height).toBe(600)
    expect(info.bitDepth).toBe(8)
    expect(info.colorMode).toBe("rgba")
    expect(info.hasAlpha).toBe(true)
  })

  it("解析 PNG 的 pHYs 物理分辨率并换算成 DPI", () => {
    const phys = Buffer.alloc(9)
    phys.writeUInt32BE(2835, 0) // 2835 px/m = 72 DPI
    phys.writeUInt32BE(5669, 4) // 5669 px/m = 144 DPI
    phys[8] = 1 // unit = meter
    const info = readImageInfo(png(100, 100, { extra: chunk("pHYs", new Uint8Array(phys)) }))
    expect(info.dpiX).toBe(72)
    expect(info.dpiY).toBe(144)
  })

  it("解析 PNG 的 tEXt 文本块", () => {
    const info = readImageInfo(png(4, 4, { extra: chunk("tEXt", new Uint8Array(Buffer.from("Software\0gyccode test", "latin1"))) }))
    expect(info.text?.Software).toBe("gyccode test")
  })

  it("解析 JPEG 的尺寸、色彩模式与 JFIF DPI", () => {
    const jfif = Buffer.alloc(20)
    jfif[0] = 0xff
    jfif[1] = 0xe0
    jfif.writeUInt16BE(18, 2)
    jfif.write("JFIF\0", 4, "latin1")
    jfif[9] = 1 // version major
    jfif[11] = 1 // units = dots/inch
    jfif.writeUInt16BE(300, 12)
    jfif.writeUInt16BE(300, 14)
    const info = readImageInfo(jpeg([new Uint8Array(jfif)], { w: 1920, h: 1080 }))
    expect(info.format).toBe("jpeg")
    expect(info.width).toBe(1920)
    expect(info.height).toBe(1080)
    expect(info.colorMode).toBe("ycbcr")
    expect(info.dpiX).toBe(300)
  })

  it("解析 JPEG 的 EXIF 拍摄参数", () => {
    // APP1 + "Exif\0\0" + 小端 TIFF：Make/Model/DateTime 都用 ASCII(2) 类型
    const tiff: number[] = []
    const push16 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff)
    const push32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
    push16(0x4949)
    push16(42)
    push32(8) // 首个 IFD 偏移（TIFF 头之后 8 字节）
    // EXIF 的值域只有 4 字节，字符串超过 4 字节时值域存的是「相对 TIFF 头的偏移」。
    // 因此按真实 EXIF 的做法，把字符串放到 IFD 之后，值域写偏移。
    const entries: Array<[number, string]> = [
      [0x010f, "Canon"],
      [0x0110, "EOS R5"],
      [0x0132, "2026:01:02 03:04:05"],
    ]
    const ifdSize = 2 + entries.length * 12 + 4
    const strings: Array<{ off: number; bytes: number[] }> = []
    let strBase = 8 + ifdSize // 偏移相对 TIFF 头，而 IFD 在 tiff+8
    for (const [, value] of entries) {
      const raw = [...Buffer.from(`${value}\u0000`, "latin1")]
      strings.push({ off: strBase, bytes: raw })
      strBase += raw.length
    }
    push16(entries.length)
    entries.forEach(([tag], i) => {
      push16(tag)
      push16(2) // ASCII
      push32(strings[i]!.bytes.length)
      push32(strings[i]!.off)
    })
    push32(0) // 无下一个 IFD
    for (const s of strings) tiff.push(...s.bytes)
    const exifPayload = Buffer.concat([
      Buffer.from("Exif\u0000\u0000", "latin1"),
      Buffer.from(new Uint8Array(tiff)),
    ])
    const app1 = Buffer.alloc(4)
    app1[0] = 0xff
    app1[1] = 0xe1
    app1.writeUInt16BE(exifPayload.length + 2, 2)
    const info = readImageInfo(jpeg([new Uint8Array(Buffer.concat([app1, exifPayload]))], { w: 100, h: 100 }))
    expect(info.exif?.Make).toBe("Canon")
    expect(info.exif?.Model).toBe("EOS R5")
    expect(info.exif?.DateTime).toBe("2026:01:02 03:04:05")
  })

  it("解析 GIF 的尺寸与帧数", () => {
    // 无全局颜色表，两个图像描述块 = 两帧
    const parts: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
    // 逻辑屏幕描述符共 7 字节：width(2) height(2) packed(1) bg(1) aspect(1)
    const hdr = Buffer.alloc(7)
    hdr.writeUInt16LE(64, 0)
    hdr.writeUInt16LE(32, 2)
    hdr[4] = 0x00 // packed：无全局颜色表
    parts.push(...hdr)
    // 图形控制扩展 + 图像描述 + 数据
    for (let f = 0; f < 2; f++) {
      parts.push(0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00)
      const id = Buffer.alloc(9) // 图像描述符本体 9 字节：Left(2) Top(2) Width(2) Height(2) Packed(1)
      id[8] = 0x00
      parts.push(0x2c, ...id, 0x02, 0x02, 0x44, 0x01, 0x00)
    }
    parts.push(0x3b) // trailer 只在最后出现一次
    const info = readImageInfo(new Uint8Array(Buffer.from(parts)))
    expect(info.format).toBe("gif")
    expect(info.width).toBe(64)
    expect(info.height).toBe(32)
    expect(info.frames).toBe(2)
  })

  it("解析 WebP 的 VP8X 尺寸与 alpha", () => {
    const header = Buffer.alloc(30)
    header.write("RIFF", 0, "latin1")
    header.write("WEBP", 8, "latin1")
    header.write("VP8X", 12, "latin1")
    header[20] = 0x10 // alpha 标志
    header[24] = 99 // width-1 = 99 -> 100
    header[27] = 199 // height-1 = 199 -> 200
    const info = readImageInfo(new Uint8Array(header))
    expect(info.format).toBe("webp")
    expect(info.width).toBe(100)
    expect(info.height).toBe(200)
    expect(info.hasAlpha).toBe(true)
  })

  it("抽取 SVG 里真实存在的 title/desc/text 文本", () => {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60">
  <title>登录页截图</title>
  <desc>一个表单&amp;一个按钮</desc>
  <text x="10" y="20">用户名</text>
  <text x="10" y="40">密码</text>
</svg>`
    const info = readImageInfo(new Uint8Array(Buffer.from(svg, "utf8")))
    expect(info.format).toBe("svg")
    expect(info.width).toBe(120)
    expect(info.height).toBe(60)
    expect(info.text?.title).toBe("登录页截图")
    expect(info.text?.desc).toBe("一个表单&一个按钮")
    expect(info.text?.text).toBe("用户名 | 密码")
    expect(info.embeddedText).toContain("用户名")
  })

  it("无 width/height 时回落到 viewBox", () => {
    const info = readImageInfo(new Uint8Array(Buffer.from(`<svg viewBox="0 0 300 150"></svg>`, "utf8")))
    expect(info.width).toBe(300)
    expect(info.height).toBe(150)
  })

  it("无法识别的格式抛错而不是猜测", () => {
    expect(() => readImageInfo(bytes("not an image at all"))).toThrow()
  })
})

describe("describeImage", () => {
  it("输出含客观元数据", () => {
    const out = describeImage(readImageInfo(png(800, 600)), "shot.png")
    expect(out).toContain("shot.png")
    expect(out).toContain("800×600")
    expect(out).toContain("PNG")
  })

  it("必须显式声明不做 OCR，避免模型误以为已经看过图", () => {
    const out = describeImage(readImageInfo(png(1, 1)))
    expect(out).toContain("不做 OCR")
    expect(out).toContain("视觉能力")
  })

  it("SVG 的内嵌文本进入输出", () => {
    const info = readImageInfo(
      new Uint8Array(Buffer.from(`<svg width="10" height="10"><text>hello</text></svg>`, "utf8")),
    )
    expect(describeImage(info)).toContain("hello")
  })
})