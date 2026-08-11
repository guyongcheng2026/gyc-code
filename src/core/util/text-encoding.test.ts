import { expect, test } from "bun:test"
import { createFileDecoder, detectTextEncoding, encodeForWrite } from "./text-encoding"

const utf8 = new TextEncoder().encode("hello 中文")
const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])
// GBK 编码的「中文\nhi」：D6 D0 CE C4
const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0x68, 0x69])

test("detectTextEncoding: UTF-8 无 BOM 识别为 utf-8", () => {
  expect(detectTextEncoding(utf8)).toBe("utf-8")
})

test("detectTextEncoding: UTF-8 BOM 识别为 utf-8", () => {
  expect(detectTextEncoding(bom)).toBe("utf-8")
})

test("detectTextEncoding: 纯 ASCII 识别为 utf-8", () => {
  expect(detectTextEncoding(new TextEncoder().encode("plain ascii 123"))).toBe("utf-8")
})

test("detectTextEncoding: GBK 字节回退 gb18030", () => {
  expect(detectTextEncoding(gbk)).toBe("gb18030")
})

test("createFileDecoder: gb18030 解码 GBK 中文", () => {
  const text = createFileDecoder("gb18030").decode(gbk)
  expect(text.startsWith("中文")).toBe(true)
  expect(text).toBe("中文\nhi")
})

test("createFileDecoder: utf-8 自动剥离 BOM", () => {
  const text = createFileDecoder("utf-8").decode(bom)
  expect(text.startsWith("hello")).toBe(true)
  expect(text).toBe("hello 中文")
})

test("encodeForWrite: gb18030 写回字节与 GBK 原始字节一致", () => {
  expect(Array.from(encodeForWrite("中文", "gb18030", false))).toEqual([0xd6, 0xd0, 0xce, 0xc4])
})

test("encodeForWrite: gb18030 剥离内容自带 BOM 后再编码", () => {
  expect(Array.from(encodeForWrite("\uFEFF中文", "gb18030", false))).toEqual([0xd6, 0xd0, 0xce, 0xc4])
})

test("encodeForWrite: utf-8 无 BOM 返回字符串", () => {
  expect(encodeForWrite("中文", "utf-8", false)).toBe("中文")
})

test("encodeForWrite: utf-8 有 BOM 且不重复", () => {
  expect(encodeForWrite("中文", "utf-8", true)).toBe("\uFEFF中文")
  expect(encodeForWrite("\uFEFF中文", "utf-8", true)).toBe("\uFEFF中文")
})

test("GBK 字节 roundtrip：探测->解码->编码->字节一致", () => {
  const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0x68, 0x69])
  const encoding = detectTextEncoding(bytes)
  const text = new TextDecoder(encoding, { ignoreBOM: true }).decode(bytes)
  expect(Array.from(encodeForWrite(text, encoding, false))).toEqual(Array.from(bytes))
})
