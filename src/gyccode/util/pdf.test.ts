import { describe, expect, it } from "bun:test"
import { deflateSync } from "node:zlib"
import { extractPdfText } from "./pdf"

/**
 * P1-8（对标指标 8 · PDF 解析）：此前 read.ts 只能把 PDF 原样 base64 当附件丢给模型，
 * 既费 token 又要求模型有 PDF 能力。这里验证「零新增依赖」的自研抽取器。
 *
 * 夹具全部在测试里现造——不依赖仓库外的二进制文件。
 */

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1")

/** 组装一份带 xref 表的最小 PDF。objects 为「对象号 -> 对象体」文本。 */
function buildPdf(objects: Array<[number, string]>): Uint8Array {
  const head = "%PDF-1.7\n"
  let body = ""
  const offsets = new Map<number, number>()
  for (const [num, content] of objects) {
    offsets.set(num, head.length + body.length)
    body += `${num} 0 obj\n${content}\nendobj\n`
  }
  const startxref = head.length + body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const [num] of objects) {
    xref += `${String(offsets.get(num)!).padStart(10, "0")} 00000 n \n`
  }
  const tail = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(head + body + xref + tail, "latin1"))
}

/** 压缩流对象（生产 PDF 里内容流基本都是 FlateDecode） */
function flateObject(dict: string, content: string) {
  const bytes = deflateSync(Buffer.from(content, "latin1"))
  return `<< ${dict} /Length ${bytes.length} /Filter /FlateDecode >>\nstream\n${latin1(bytes)}\nendstream`
}

// 覆盖两个用例用到的全部字符。真实字体的 ToUnicode 会列出字体全部码位；
// 这里若漏字，抽取器会（正确地）丢弃查不到的码位，测试就会误以为解析出错。
const CMAP_CHARS = ["H", "e", "l", "o", " ", "W", "r", "d", "S", "c", "n", "P", "a", "g"]
const CMAP = `begincmap
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${CMAP_CHARS.length} beginbfchar
${CMAP_CHARS.map((c) => {
  const code = c.charCodeAt(0).toString(16).padStart(4, "0")
  return `<${code}> <${code}>`
}).join("\n")}
endbfchar
endcmap`

/** 字体对象：PDF 里 /ToUnicode 是指向 CMap 流的间接引用，字体本身不是 CMap */
const fontObject = (toUnicode: number) =>
  `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode ${toUnicode} 0 R >>`

/** 一页标准 PDF：ToUnicode CMap + FlateDecode 内容流 */
function twoPagePdf() {
  const content1 = `BT /F1 24 Tf 72 700 Td (Hello World) Tj ET`
  const content2 = `BT /F1 24 Tf 72 700 Td (Second Page) Tj ET`
  return buildPdf([
    [1, `<< /Type /Catalog /Pages 2 0 R >>`],
    [2, `<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>`],
    [3, `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>`],
    [4, `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>`],
    [5, fontObject(8)],
    [6, flateObject("", content1)],
    [7, flateObject("", content2)],
    [8, flateObject("", CMAP)],
  ])
}

describe("extractPdfText", () => {
  it("抽取多页文字并给出总页数", () => {
    const result = extractPdfText(twoPagePdf())
    expect(result.version).toBe("1.7")
    expect(result.pageCount).toBe(2)
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]!.text).toContain("Hello World")
    expect(result.pages[1]!.text).toContain("Second Page")
    expect(result.hasText).toBe(true)
  })

  it("按 ToUnicode CMap 解码双字节字符", () => {
    // 内容流里的编码值 0x0048/0x0065 必须经 CMap 还原为 H/e，而不是原始码位
    const content = `BT /F1 24 Tf 72 700 Td <00480065006C006C006F> Tj ET`
    const bytes = buildPdf([
      [1, `<< /Type /Catalog /Pages 2 0 R >>`],
      [2, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`],
      [3, `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>`],
      [5, fontObject(7)],
      [6, flateObject("", content)],
      [7, flateObject("", CMAP)],
    ])
    expect(extractPdfText(bytes).pages[0]!.text).toContain("Hello")
  })

  it("支持未压缩的内容流（无 /Filter）", () => {
    const content = `BT /F1 12 Tf 10 10 Td (Plain Stream) Tj ET`
    const bytes = buildPdf([
      [1, `<< /Type /Catalog /Pages 2 0 R >>`],
      [2, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`],
      [3, `<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>`],
      [6, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    ])
    expect(extractPdfText(bytes).pages[0]!.text).toContain("Plain Stream")
  })

  it("支持 TJ 数组中的字距与换行定位", () => {
    const content = `BT /F1 12 Tf 10 700 Td [(A) -500 (B)] TJ 0 -14 Td [(second)] TJ ET`
    const bytes = buildPdf([
      [1, `<< /Type /Catalog /Pages 2 0 R >>`],
      [2, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`],
      [3, `<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>`],
      [6, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    ])
    const text = extractPdfText(bytes).pages[0]!.text
    expect(text).toContain("A B")
    expect(text.split("\n").length).toBeGreaterThanOrEqual(2)
  })

  it("对象流（ObjStm，PDF 1.5+ 常见）中的页面同样可解析", () => {
    // Page 对象整个塞进 ObjStm，裸扫字节找不到它
    const content = "BT /F1 12 Tf 10 10 Td (ObjStm Text) Tj ET"
    // /N 1：ObjStm 里只有对象 3。对象 3 的偏移 0，/First 4（对齐表头长度）
    const objstmBody = `3 0 ${"<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"}`
    const objstm = buildPdf([
      [1, `<< /Type /Catalog /Pages 2 0 R >>`],
      [2, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`],
      [5, flateObject(`/Type /ObjStm /N 1 /First 4`, objstmBody)],
    ])
    const header = latin1(objstm).slice(0, latin1(objstm).indexOf("xref"))
    const doc = latin1(objstm).slice(latin1(objstm).indexOf("xref"))
    const full = new Uint8Array(
      Buffer.from(`${header}4 0 obj\n${flateObject("", content)}\nendobj\n${doc}`, "latin1"),
    )
    expect(extractPdfText(full).pages[0]!.text).toContain("ObjStm Text")
  })

  it("无文字层的扫描件返回 hasText=false 并给出中文警示", () => {
    const bytes = buildPdf([
      [1, `<< /Type /Catalog /Pages 2 0 R >>`],
      [2, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`],
      [3, `<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>`],
      [6, flateObject("", "1 0 0 RG 10 10 100 100 re S")],
    ])
    const result = extractPdfText(bytes)
    expect(result.hasText).toBe(false)
    expect(result.warnings.join("\n")).toContain("没有可提取的文字")
  })

  it("maxPages 截断并在 warnings 里说明", () => {
    const result = extractPdfText(twoPagePdf(), { maxPages: 1 })
    expect(result.pages).toHaveLength(1)
    expect(result.warnings.join("\n")).toContain("只解析了前 1 页")
  })

  it("非 PDF 输入抛错", () => {
    expect(() => extractPdfText(new Uint8Array(Buffer.from("not a pdf", "latin1")))).toThrow()
  })

  it("加密 PDF 给出可读原因而不是崩溃", () => {
    const bytes = buildPdf([
      [1, `<< /Type /Catalog /Pages 2 0 R >>`],
      [2, `<< /Type /Pages /Kids [3 0 R] /Count 1 /Encrypt 9 0 R >>`],
      [3, `<< /Type /Page /Parent 2 0 R >>`],
      [9, `<< /Filter /Standard /V 2 /R 3 /Length 128 >>`],
    ])
    const result = extractPdfText(bytes)
    expect(result.warnings.join("\n")).toContain("加密")
  })
})