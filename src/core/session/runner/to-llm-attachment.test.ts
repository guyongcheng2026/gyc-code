// toLLMMessages 附件物化测试（P2-4）
//
// 这是 P2-4 最关键的安全属性：ref 附件必须在送进 provider 前变回字节。
// 一旦这里退化成「路径当字符串丢给 provider」，模型会安静地收不到图片，
// 没有任何报错——所以必须直接断言 content[].data 的字节内容。
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "fs"
import { mkdir, readFile, writeFile, access } from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { AttachmentStore } from "../../attachment-store"
import { ToLLMMessage } from "./to-llm-message"

const ROOT = mkdtempSync(path.join(os.tmpdir(), "gyc-to-llm-test-"))
const realFs: AttachmentStore.Port = {
  exists: (p) => Effect.tryPromise(() => access(p)).pipe(Effect.map(() => true), Effect.orElseSucceed(() => false)),
  makeDirectory: (p, o) => Effect.tryPromise(() => mkdir(p, o)),
  writeFile: (p, bytes) => Effect.tryPromise(() => writeFile(p, bytes)),
  readFile: (p) => Effect.tryPromise(() => readFile(p)),
}
const store = AttachmentStore.of(realFs, ROOT)

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
const MODEL = { id: "test-model", provider: "test-provider" } as never

const userMessage = (files: ReadonlyArray<Record<string, unknown>>) =>
  ({
    type: "user",
    id: "msg_1",
    text: "看这张图",
    files,
    time: { created: 0 },
  }) as never

const run = (messages: ReadonlyArray<never>) => Effect.runPromise(ToLLMMessage.toLLMMessages(messages, MODEL, store))

describe("toLLMMessages — ref 附件物化", () => {
  test("带 ref 的附件按磁盘字节回填，而不是把路径字符串丢给 provider", async () => {
    const reference = await Effect.runPromise(
      store.externalize({ uri: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`, mime: "image/png" }),
    )
    const messages = await run([userMessage([{ uri: reference.uri, mime: "image/png", ref: reference.ref }])])
    const media = messages[0]?.content.find((part) => part.type === "media")
    expect(media).toBeDefined()
    expect(media?.type === "media" ? media.data : undefined).toEqual(PNG)
  })

  test("物化后不再出现 base64，避免多一次编解码", async () => {
    const reference = await Effect.runPromise(
      store.externalize({ uri: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`, mime: "image/png" }),
    )
    const messages = await run([userMessage([{ uri: reference.uri, mime: "image/png", ref: reference.ref }])])
    const media = messages[0]?.content.find((part) => part.type === "media")
    expect(typeof (media?.type === "media" ? media.data : undefined)).not.toBe("string")
  })

  test("附件已被清掉时报 MissingAttachmentError，不静默丢图", async () => {
    const missing = path.join(ROOT, "attachment", "does-not-exist.png")
    const exit = await Effect.runPromiseExit(
      ToLLMMessage.toLLMMessages(
        [userMessage([{ uri: missing, mime: "image/png", ref: missing }])] as never,
        MODEL,
        store,
      ),
    )
    expect(exit._tag).toBe("Failure")
  })

  test("无 ref 的 http(s) 附件原样透传 uri，不去磁盘找", async () => {
    const messages = await run([userMessage([{ uri: "https://example.com/a.png", mime: "image/png" }])])
    const media = messages[0]?.content.find((part) => part.type === "media")
    expect(media?.type === "media" ? media.data : undefined).toBe("https://example.com/a.png")
  })

  test("多个附件各自还原成对应字节，不串号", async () => {
    const other = new Uint8Array([7, 7, 7, 7])
    const a = await Effect.runPromise(
      store.externalize({ uri: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`, mime: "image/png" }),
    )
    const b = await Effect.runPromise(
      store.externalize({ uri: `data:image/png;base64,${Buffer.from(other).toString("base64")}`, mime: "image/png" }),
    )
    const messages = await run([
      userMessage([
        { uri: a.uri, mime: "image/png", ref: a.ref },
        { uri: b.uri, mime: "image/png", ref: b.ref },
      ]),
    ])
    const datas = messages[0]?.content.filter((part) => part.type === "media").map((p) => p.data)
    expect(datas).toEqual([PNG, other])
  })

  test("文本内容不受影响，附件物化不吞掉正文", async () => {
    const messages = await run([userMessage([])])
    expect(messages[0]?.content[0]).toEqual({ type: "text", text: "看这张图" })
  })
})