import path from "path"
import os from "os"
import { mkdir, writeFile } from "fs/promises"

// 通过 OSC 52 转义序列写入终端剪贴板（尽力而为，依赖终端支持）。
export function writeClipboardOsc52(text: string): boolean {
  try {
    const encoded = Buffer.from(text, "utf8").toString("base64")
    process.stdout.write(`\x1b]52;c;${encoded}\x07`)
    return true
  } catch {
    return false
  }
}

// 把 /copy 的内容写入临时文件作为剪贴板兜底。
export async function writeCopyTempFile(content: string): Promise<string | undefined> {
  try {
    const dir = path.join(os.tmpdir(), "gyc")
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, "copy-response.md")
    await writeFile(filePath, content, "utf8")
    return filePath
  } catch {
    return undefined
  }
}
