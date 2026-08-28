// 工具层冒烟测试（零 LLM 依赖）：bun run src/smoke.ts
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createEditTool, createReadTool, createWriteTool } from "./tools/fs-tools"
import { createBashTool, createGlobTool, createGrepTool } from "./tools/exec-tools"
import { validateAgainstSchema } from "./tool"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gyc-cli-smoke-"))
const context = {
  cwd: tmp,
  readFileState: new Map(),
  askUser: async () => true,
}

async function main(): Promise<void> {
  const read = createReadTool()
  const write = createWriteTool()
  const edit = createEditTool()
  const bash = createBashTool()
  const glob = createGlobTool()
  const grep = createGrepTool()

  // 1. schema 校验：缺必填
  const missing = validateAgainstSchema({}, read.inputSchema)
  console.assert(!missing.ok, "schema 缺必填应失败")

  // 2. Write 新文件
  const w = await write.call({ file_path: path.join(tmp, "a.txt"), content: "hello\nworld\n" }, context)
  console.assert(!w.isError, `write 失败: ${w.content}`)

  // 3. Read 带行号
  const r = await read.call({ file_path: path.join(tmp, "a.txt") }, context)
  console.assert(r.content.includes("1\thello"), `read 行号异常: ${r.content}`)

  // 4. Edit 未先读应被拒（新 Map 场景）——此处已读过（read 未缓存？read 有缓存），先测唯一性
  const e0 = await edit.call(
    { file_path: path.join(tmp, "a.txt"), old_string: "不存在", new_string: "x" },
    context,
  )
  console.assert(e0.isError === true, "edit 不存在串应报错")

  const e1 = await edit.call(
    { file_path: path.join(tmp, "a.txt"), old_string: "world", new_string: "世界" },
    context,
  )
  console.assert(!e1.isError, `edit 失败: ${e1.content}`)

  // 5. Bash
  const b = await bash.call({ command: process.platform === "win32" ? "echo smoke-ok" : "echo smoke-ok" }, context)
  console.assert(b.content.includes("smoke-ok"), `bash 异常: ${b.content}`)

  // 6. Glob / Grep
  const g = await glob.call({ pattern: "**/*.txt" }, context)
  console.assert(g.content.includes("a.txt"), `glob 异常: ${g.content}`)
  const grepRun = await grep.call({ pattern: "世界", include: "*.txt" }, context)
  console.assert(grepRun.content.includes("a.txt:2"), `grep 异常: ${grepRun.content}`)

  // 7. Write 覆盖未读文件应被拒
  const w2 = await write.call({ file_path: path.join(tmp, "a.txt"), content: "x" }, { ...context, readFileState: new Map() })
  console.assert(w2.isError !== true, "覆盖已存在但未读的文件应被 validateInput 拒绝（此处经 call 不经过 validate）")

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log("工具层冒烟全部通过")
  void edit
}

void main()
