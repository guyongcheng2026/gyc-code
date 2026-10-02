import { Effect, Schema } from "effect"
import { FSUtil } from "@gyccode/core/fs-util"
import { describeImage, readImageInfo } from "@/util/image"
import * as Tool from "./tool"
import DESCRIPTION from "./describe-image.txt"

export const Parameters = Schema.Struct({
  filepath: Schema.String.annotate({ description: "图片文件的绝对路径" }),
})

type Metadata = {
  preview: string
  truncated: boolean
  loaded: string[]
  imageFormat?: string
  width?: number
  height?: number
  hasEmbeddedText: boolean
}

/** 单文件读取上限，避免为拿元数据把超大图整个读进内存 */
const MAX_BYTES = 64 * 1024 * 1024

export const DescribeImageTool = Tool.define<typeof Parameters, Metadata, FSUtil.Service>(
  "describe_image",
  Effect.gen(function* () {
    // 服务在初始化阶段解析后闭包捕获，execute 的 R 通道才能是 never
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const filepath = params.filepath
          const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.void))
          if (!stat || stat.type === "Directory") {
            return yield* Effect.fail(new Error(`Not a file: ${filepath}`))
          }
          if (Number(stat.size) > MAX_BYTES) {
            return yield* Effect.fail(
              new Error(
                `Image too large to inspect: ${filepath} (${Math.round(Number(stat.size) / 1024 / 1024)}MB). ` +
                  `This tool reads the whole file to parse its header; use another approach for files this big.`,
              ),
            )
          }

          const bytes = yield* fs.readFile(filepath)
          // 解析失败要让模型看到原因并换路子，不当成致命错误中断整轮
          const info = yield* Effect.try({
            try: () => readImageInfo(new Uint8Array(bytes)),
            catch: (err) =>
              new Error(
                `无法解析图片元数据（${filepath}）：${err instanceof Error ? err.message : String(err)}。` +
                  `支持 PNG / JPEG / GIF / WebP / BMP / SVG；若确实需要看图内容请改用 read。`,
              ),
          })

          return {
            title: `Inspected image: ${filepath}`,
            output: describeImage(info, filepath),
            metadata: {
              preview: `${info.format.toUpperCase()} ${info.width ?? "?"}×${info.height ?? "?"}`,
              truncated: false,
              loaded: [filepath],
              imageFormat: info.format,
              width: info.width,
              height: info.height,
              hasEmbeddedText: Boolean(info.embeddedText),
            },
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)