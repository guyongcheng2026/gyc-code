// AttachmentStore 单元测试（P2-4 附件外部存储 + 引用）
//
// 动机：附件此前以 base64 data URL 直接内联进会话消息
// （LLM.ToolFileContent.uri，schema/llm.ts:20），一张图就能把会话库撑爆。
// 本模块把字节内容寻址地落盘，消息里只留 ref。
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "fs"
import { mkdir, readFile, writeFile, access } from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { AttachmentStore } from "./attachment-store"

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const OTHER = new Uint8Array([9, 9, 9])
const dataUrl = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`

// 测试用临时目录 + 真实 fs 薄适配器：不写进用户真实 data 目录，也不必拉起完整 FSUtil 图
const ROOT = mkdtempSync(path.join(os.tmpdir(), "gyc-attachment-test-"))
const realFs: AttachmentStore.Port = {
  exists: (p) => Effect.tryPromise(() => access(p)).pipe(Effect.map(() => true), Effect.orElseSucceed(() => false)),
  makeDirectory: (p, options) => Effect.tryPromise(() => mkdir(p, options)),
  writeFile: (p, bytes) => Effect.tryPromise(() => writeFile(p, bytes)),
  readFile: (p) => Effect.tryPromise(() => readFile(p)),
}

const withStore = <A>(f: (store: AttachmentStore.Interface) => Effect.Effect<A, AttachmentStore.Error>) =>
  Effect.runPromise(f(AttachmentStore.of(realFs, ROOT)))

const withStoreExit = <A>(f: (store: AttachmentStore.Interface) => Effect.Effect<A, AttachmentStore.Error>) =>
  Effect.runPromiseExit(f(AttachmentStore.of(realFs, ROOT)))

describe("AttachmentStore.parseDataUrl — 纯函数", () => {
  test("解析 base64 data URL，返回 mime 与原始字节", () => {
    expect(AttachmentStore.parseDataUrl(dataUrl("image/png", PNG))).toEqual({ mime: "image/png", bytes: PNG })
  })

  test("非 data URL 返回 undefined（http/https/file 都要放行透传）", () => {
    expect(AttachmentStore.parseDataUrl("https://example.com/a.png")).toBeUndefined()
    expect(AttachmentStore.parseDataUrl("file:///c:/tmp/a.png")).toBeUndefined()
    expect(AttachmentStore.parseDataUrl("/abs/path/a.png")).toBeUndefined()
  })

  test("data: 但不是 base64 载荷 → undefined，不能当成有效字节", () => {
    expect(AttachmentStore.parseDataUrl("data:text/plain,hello")).toBeUndefined()
    expect(AttachmentStore.parseDataUrl("data:image/png;base64,")).toBeUndefined()
  })

  test("垃圾串返回 undefined 而不是抛错", () => {
    expect(AttachmentStore.parseDataUrl("")).toBeUndefined()
    expect(AttachmentStore.parseDataUrl("data:")).toBeUndefined()
    expect(AttachmentStore.parseDataUrl("javascript:alert(1)")).toBeUndefined()
  })

  test("base64 载荷非法时返回 undefined，不冒 Buffer 解码异常", () => {
    expect(AttachmentStore.parseDataUrl("data:image/png;base64,!!!not-base64!!!")).toBeUndefined()
  })
})

describe("AttachmentStore.extensionOf — 纯函数", () => {
  test("常见图片/PDF mime 映射到对应扩展名", () => {
    expect(AttachmentStore.extensionOf("image/png")).toBe(".png")
    expect(AttachmentStore.extensionOf("image/jpeg")).toBe(".jpg")
    expect(AttachmentStore.extensionOf("application/pdf")).toBe(".pdf")
    expect(AttachmentStore.extensionOf("image/webp")).toBe(".webp")
  })

  test("未知或空 mime 回退 .bin", () => {
    expect(AttachmentStore.extensionOf("application/x-made-up")).toBe(".bin")
    expect(AttachmentStore.extensionOf("")).toBe(".bin")
  })

  test("忽略大小写与参数后缀", () => {
    expect(AttachmentStore.extensionOf("image/PNG")).toBe(".png")
    expect(AttachmentStore.extensionOf("image/png; charset=binary")).toBe(".png")
  })
})

describe("AttachmentStore.blobName — 内容寻址", () => {
  test("相同内容 + 相同 mime → 同一文件名（幂等，重复落盘不增殖）", () => {
    expect(AttachmentStore.blobName(PNG, "image/png")).toBe(AttachmentStore.blobName(PNG, "image/png"))
  })

  test("内容不同 → 不同文件名", () => {
    expect(AttachmentStore.blobName(PNG, "image/png")).not.toBe(AttachmentStore.blobName(OTHER, "image/png"))
  })

  test("文件名不含路径分隔符，无法穿越目录", () => {
    const name = AttachmentStore.blobName(PNG, "image/png")
    expect(name).not.toContain("/")
    expect(name).not.toContain("\\")
    expect(name).not.toContain("..")
  })

  test("文件名保留扩展名，便于人工排查", () => {
    expect(AttachmentStore.blobName(PNG, "image/png")).toMatch(/\.png$/)
  })
})

describe("AttachmentStore 服务 — 落盘与回读", () => {
  test("persist 后 load 能原样读回字节", () =>
    withStore((store) => Effect.gen(function* () { expect(yield* store.load(yield* store.persist(PNG, "image/png"))).toEqual(PNG) })))

  test("persist 幂等：同一份内容两次落盘得到同一路径，不因已存在而失败", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const first = yield* store.persist(PNG, "image/png")
        const second = yield* store.persist(PNG, "image/png")
        expect(first).toBe(second)
      }),
    ))

  test("persist 返回的 ref 落在 attachment 目录之下", () =>
    withStore((store) => Effect.gen(function* () { expect(yield* store.persist(PNG, "image/png")).toContain(`attachment${path.sep}`) })))

  test("load 不存在的 ref 走 StorageError，而不是让文件异常冒泡成 defect", () =>
    withStoreExit((store) => store.load(path.join(ROOT, "attachment", "missing.bin"))).then((exit) =>
      expect(exit._tag).toBe("Failure"),
    ))

  test("externalize 把 data URL 换成 ref，uri 不再是 base64", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const result = yield* store.externalize({ uri: dataUrl("image/png", PNG), mime: "image/png", name: "a.png" })
        expect(result.ref).toBeTruthy()
        expect(result.uri).toBe(result.ref!)
        expect(result.uri).not.toContain("base64")
        expect(result.name).toBe("a.png")
      }),
    ))

  test("externalize 对 http(s) 引用原样透传，不落盘也不加 ref", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const result = yield* store.externalize({ uri: "https://example.com/a.png", mime: "image/png" })
        expect(result.uri).toBe("https://example.com/a.png")
        expect(result.ref).toBeUndefined()
      }),
    ))

  test("externalize 对已带 ref 的条目不重复处理（会话重放幂等）", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const once = yield* store.externalize({ uri: dataUrl("image/png", PNG), mime: "image/png" })
        const twice = yield* store.externalize(once)
        expect(twice.ref).toBe(once.ref)
      }),
    ))

  test("externalize 后仍能取回原始字节（引用不丢数据）", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const result = yield* store.externalize({ uri: dataUrl("image/png", PNG), mime: "image/png" })
        expect(yield* store.load(result.ref!)).toEqual(PNG)
      }),
    ))

  test("externalize 明显缩短 uri：base64 串远长于内容寻址路径", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const uri = dataUrl("image/png", new Uint8Array(4096))
        const result = yield* store.externalize({ uri, mime: "image/png" })
        expect(result.uri.length).toBeLessThan(uri.length / 10)
      }),
    ))
})