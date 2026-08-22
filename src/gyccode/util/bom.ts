import { Effect } from "effect"
import { FSUtil } from "@gyccode/core/fs-util"
import {
  detectTextEncoding,
  encodeForWrite,
  type TextFileEncoding,
} from "@gyccode/core/util/text-encoding"

const BOM_CODE = 0xfeff
const BOM = String.fromCharCode(BOM_CODE)

export function split(text: string) {
  if (text.charCodeAt(0) !== BOM_CODE) return { bom: false, text }
  return { bom: true, text: text.slice(1) }
}

export function join(text: string, bom: boolean) {
  const stripped = split(text).text
  if (!bom) return stripped
  return BOM + stripped
}

export interface BomMeta {
  bom: boolean
  text: string
  encoding: TextFileEncoding
}

export const readFile = Effect.fn("Bom.readFile")(function* (fs: FSUtil.Interface, filePath: string) {
  const bytes = yield* fs.readFile(filePath)
  const encoding = detectTextEncoding(bytes)
  const text = new TextDecoder(encoding, { ignoreBOM: true }).decode(bytes)
  return { ...split(text), encoding }
})

/** 按源编码写回：utf-8 保留 BOM 逻辑；gb18030 编码为字节（无 BOM）。 */
export const writeFileEncoded = Effect.fn("Bom.writeFileEncoded")(function* (
  fs: FSUtil.Interface,
  filePath: string,
  text: string,
  opts: { bom: boolean; encoding: TextFileEncoding },
) {
  yield* fs.writeWithDirs(filePath, encodeForWrite(text, opts.encoding, opts.bom))
})

export const syncFile = Effect.fn("Bom.syncFile")(function* (fs: FSUtil.Interface, filePath: string, bom: boolean) {
  const current = yield* readFile(fs, filePath)
  if (current.bom === bom) return current.text
  yield* writeFileEncoded(fs, filePath, join(current.text, bom), { bom, encoding: current.encoding })
  return current.text
})
