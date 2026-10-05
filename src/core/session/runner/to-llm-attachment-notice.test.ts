// toLLMMessages 附件丢弃说明测试（P2-5）
//
// P2-4 已经做到「附件读不到就降级成一段说明文字」，但那段文字只说了「读不到」，
// 没说清是哪个附件、真实原因是什么、还能换什么方式拿到。模型拿到这种说明时
// 无从区分「文件是空的」「路径写错了」「格式不支持」，往往就直接把内容编出来。
//
// 这里锁定四件事：每条丢弃路径都要有说明、说明要带真实原因、
// 多附件只产出一条聚合说明、送达成功时不产生任何噪音。
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "fs"
import { mkdir, readFile, writeFile, access } from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { AttachmentStore } from "../../attachment-store"
import { ToLLMMessage } from "./to-llm-message"

const ROOT = mkdtempSync(path.join(os.tmpdir(), "gyc-to-llm-notice-"))
const realFs: AttachmentStore.Port = {
  exists: (p) => Effect.tryPromise(() => access(p)).pipe(Effect.map(() => true), Effect.orElseSucceed(() => false)),
  makeDirectory: (p, o) => Effect.tryPromise(() => mkdir(p, o)),
  writeFile: (p, bytes) => Effect.tryPromise(() => writeFile(p, bytes)),
  readFile: (p) => Effect.tryPromise({ try: () => readFile(p), catch: (cause: unknown) => cause }),
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
const textsOf = (messages: Awaited<ReturnType<typeof run>>) =>
  messages[0]?.content.filter((part) => part.type === "text").map((part) => part.text) ?? []
const noticesOf = (messages: Awaited<ReturnType<typeof run>>) =>
  textsOf(messages).filter((text) => text.includes("attachment-unavailable"))

const storedImage = () =>
  Effect.runPromise(
    store.externalize({ uri: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`, mime: "image/png" }),
  )

describe("P2-5 — 附件丢弃说明", () => {
  test("uri 未解析（裸本地路径 / file://）时产出说明，不再把路径当媒体数据丢给 provider", async () => {
    const messages = await run([
      userMessage([
        { uri: "C:\\Users\\me\\shot.png", mime: "image/png", name: "shot.png" },
        { uri: "file:///tmp/other.png", mime: "image/png", name: "other.png" },
      ]),
    ])
    const notices = noticesOf(messages)
    expect(notices).toHaveLength(1)
    // 说明要说清三件事：附件是什么、为什么没送达、改用什么方式去取
    expect(notices[0]).toContain("shot.png")
    expect(notices[0]).toContain("other.png")
    expect(notices[0]).toContain("read")
    // 正文仍然保留，模型不会因为附件没了而丢失用户输入
    expect(textsOf(messages)).toContain("看这张图")
    // 关键回归点：绝不能再出现 media part 把本地路径当图片数据
    expect(messages[0]?.content.some((part) => part.type === "media")).toBe(false)
  })

  test("加载失败时产出说明，并带上真实失败原因而不是笼统的「读不到」", async () => {
    const missing = path.join(ROOT, "attachment", "vanished.png")
    const messages = await run([userMessage([{ uri: missing, mime: "image/png", ref: missing, name: "shot.png" }])])
    const notices = noticesOf(messages)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("shot.png")
    // 真实原因：AttachmentStore.StorageError.message 已把底层 cause 拼进去
    expect(notices[0]).toContain("ENOENT")
  })

  test("多附件全部失败时聚合成一条说明，而不是堆成一堆噪音", async () => {
    const a = path.join(ROOT, "attachment", "a.png")
    const b = path.join(ROOT, "attachment", "b.png")
    const messages = await run([
      userMessage([
        { uri: a, mime: "image/png", ref: a, name: "a.png" },
        { uri: b, mime: "image/png", ref: b, name: "b.png" },
        { uri: "D:\\tmp\\c.csv", mime: "text/csv", name: "c.csv" },
      ]),
    ])
    const notices = noticesOf(messages)
    // 三种不同原因，也只产出一条聚合说明
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("a.png")
    expect(notices[0]).toContain("b.png")
    expect(notices[0]).toContain("c.csv")
    expect(notices[0]).toContain("ENOENT")
  })

  test("送达成功时不产出任何说明文本", async () => {
    const reference = await storedImage()
    const messages = await run([
      userMessage([
        { uri: reference.uri, mime: "image/png", ref: reference.ref, name: "ok.png" },
        { uri: "https://example.com/a.png", mime: "image/png", name: "remote.png" },
        { uri: "data:application/pdf;base64,JVBERi0xLjQK", mime: "application/pdf", name: "spec.pdf" },
      ]),
    ])
    expect(noticesOf(messages)).toHaveLength(0)
    const media = messages[0]?.content.filter((part) => part.type === "media").map((part) => part.data)
    expect(media).toHaveLength(3)
    expect(media?.[0]).toEqual(PNG)
    expect(media?.[1]).toBe("https://example.com/a.png")
    expect(media?.[2]).toBe("data:application/pdf;base64,JVBERi0xLjQK")
  })

  test("provider 不接受的媒体类型提前降级，避免 validateMedia 打挂整轮请求", async () => {
    const messages = await run([
      userMessage([
        { uri: "data:text/csv;base64,YQ==", mime: "text/csv", name: "c.csv" },
        { uri: "data:application/zip;base64,YQ==", mime: "application/zip", name: "c.zip" },
      ]),
    ])
    const notices = noticesOf(messages)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("text/csv")
    expect(notices[0]).toContain("application/zip")
    expect(messages[0]?.content.some((part) => part.type === "media")).toBe(false)
  })
})

describe("P2-5 — 判定逻辑纯函数", () => {
  const file = (input: Record<string, unknown>) => input as never

  test("classifyAttachment 对四条路径给出可单测的判定结果", () => {
    const loaded = new Map([["ref-ok", PNG]])
    const failures = new Map([["ref-bad", "Failed to load attachment: ENOENT"]])

    const ok = ToLLMMessage.classifyAttachment(file({ uri: "u", mime: "image/png", ref: "ref-ok" }), loaded, failures)
    expect(ok).toEqual({ delivered: true, data: PNG })

    const missing = ToLLMMessage.classifyAttachment(
      file({ uri: "u", mime: "image/png", ref: "ref-bad", name: "a.png" }),
      loaded,
      failures,
    )
    expect(missing.delivered).toBe(false)
    expect(missing.delivered === false && missing.notice.reason).toBe("load-failed")
    expect(missing.delivered === false && missing.notice.cause).toContain("ENOENT")

    const unresolved = ToLLMMessage.classifyAttachment(file({ uri: "/tmp/a.png", mime: "image/png" }), loaded, failures)
    expect(unresolved.delivered === false && unresolved.notice.reason).toBe("unresolved-uri")

    const badMime = ToLLMMessage.classifyAttachment(
      file({ uri: "https://x/a.csv", mime: "text/csv", name: "a.csv" }),
      loaded,
      failures,
    )
    expect(badMime.delivered === false && badMime.notice.reason).toBe("unsupported-mime")
  })

  test("renderAttachmentNotice 单条保持紧凑，多条聚合成一条", () => {
    const one = ToLLMMessage.renderAttachmentNotice([
      {
        name: "a.png",
        mime: "image/png",
        uri: "/tmp/a.png",
        reason: "unresolved-uri",
        cause: "x",
        hint: "y",
      },
    ])
    expect(one.type).toBe("text")
    expect(one.type === "text" && one.text).toContain('name="a.png"')
    expect(one.type === "text" && one.text).not.toContain("count=")

    const many = ToLLMMessage.renderAttachmentNotice([
      { name: "a.png", mime: "image/png", uri: "/tmp/a.png", reason: "unresolved-uri", cause: "x", hint: "y" },
      { name: "b.csv", mime: "text/csv", uri: "/tmp/b.csv", reason: "unsupported-mime", cause: "z", hint: "w" },
    ])
    expect(many.type === "text" && many.text).toContain('count="2"')
    expect(many.type === "text" && many.text).toContain("a.png")
    expect(many.type === "text" && many.text).toContain("b.csv")
  })

  test("describeFailure 直接透出存储层错误消息", () => {
    expect(ToLLMMessage.describeFailure(new Error("boom"))).toContain("boom")
    expect(ToLLMMessage.describeFailure("boom")).toBe("boom")
    expect(ToLLMMessage.describeFailure(undefined)).toBe("未知原因")
  })

  test("支持清单包含 application/pdf，不包含 text/csv", () => {
    expect(ToLLMMessage.SUPPORTED_MEDIA_MIMES.has("application/pdf")).toBe(true)
    expect(ToLLMMessage.SUPPORTED_MEDIA_MIMES.has("image/png")).toBe(true)
    expect(ToLLMMessage.SUPPORTED_MEDIA_MIMES.has("text/csv")).toBe(false)
  })
})