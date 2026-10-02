import { describe, expect, it } from "bun:test"
import { buildMediaNotice, modelAcceptsMedia } from "./media-notice"

/**
 * P2-5（对标指标 10 · 工具结果媒体的可见降级）：
 * 静默丢弃媒体会让模型误以为「已经看过图」并编造内容。Claude Code 同样存在
 * 这个缺陷，补上即体验优势，所以这里对文案的可诊断性有明确断言。
 */

const anthropic = { npm: "@ai-sdk/anthropic", id: "claude-sonnet-4-5" }
const openai = { npm: "@ai-sdk/openai", id: "gpt-4o-mini" }
const google = { npm: "@ai-sdk/google", id: "gemini-2.5-flash" }
const unknown = { npm: "@ai-sdk/some-future-sdk", id: "mystery-model" }

describe("modelAcceptsMedia", () => {
  it("图片：现代模型接受，纯文本小模型拒绝", () => {
    expect(modelAcceptsMedia(anthropic, "image/png")).toBe(true)
    expect(modelAcceptsMedia(google, "image/jpeg")).toBe(true)
    // gpt-4o-mini 命中 TEXT_ONLY 白名单
    expect(modelAcceptsMedia(openai, "image/png")).toBe(false)
  })

  it("PDF：按 provider 与模型白名单判断，未知 provider 保守判否", () => {
    expect(modelAcceptsMedia(anthropic, "application/pdf")).toBe(true)
    expect(modelAcceptsMedia({ npm: "@ai-sdk/openai", id: "gpt-4o" }, "application/pdf")).toBe(true)
    expect(modelAcceptsMedia({ npm: "@ai-sdk/openai", id: "gpt-3.5-turbo" }, "application/pdf")).toBe(false)
    expect(modelAcceptsMedia(unknown, "application/pdf")).toBe(false)
  })

  it("非媒体类型不受影响", () => {
    expect(modelAcceptsMedia(unknown, "text/plain")).toBe(true)
  })
})

describe("buildMediaNotice", () => {
  const media = [{ mime: "image/png", filename: "shot.png" }, { mime: "application/pdf", filename: "spec.pdf" }]

  it("被丢弃时：点名附件、给出具体原因、并明确禁止模型假设已读取", () => {
    const notice = buildMediaNotice(media, true, "当前模型（gpt-4o-mini）不支持 image/png 输入")
    expect(notice).toContain("shot.png")
    expect(notice).toContain("spec.pdf")
    expect(notice).toContain("已从工具结果中移除")
    expect(notice).toContain("image/png") // 原因要具体到 MIME，不能只说「不支持」
    expect(notice).toContain("不要假设已经读取过")
    expect(notice).toContain("describe_image") // 必须给出替代方案
  })

  it("仅挪到独立消息时：说明去向并提示可能收不到", () => {
    const notice = buildMediaNotice(media, false, "")
    expect(notice).toContain("作为独立消息附上")
    expect(notice).not.toContain("已从工具结果中移除")
    expect(notice).toContain("media_notice")
  })

  it("无文件名时回退用 MIME 标识附件", () => {
    const notice = buildMediaNotice([{ mime: "image/webp" }], true, "不支持 image/webp")
    expect(notice).toContain("image/webp")
  })

  it("文案首尾是换行包裹，不破坏工具原输出的排版", () => {
    const notice = buildMediaNotice(media, false, "")
    expect(notice.startsWith("\n\n<media_notice>")).toBe(true)
    expect(notice.trimEnd().endsWith("</media_notice>")).toBe(true)
  })
})