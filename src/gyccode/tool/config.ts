import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./config.txt"
import { Config } from "@/config/config"
import type { ConfigV1 } from "@gyccode/core/v1/config/config"

export const Parameters = Schema.Struct({
  setting: Schema.String.annotate({
    description: 'The setting key (e.g., "model", "shell", "language", "snapshot")',
  }),
  value: Schema.optional(
    Schema.Union([Schema.String, Schema.Boolean, Schema.Number]),
  ).annotate({ description: "The new value. Omit to get current value." }),
})

type SettingKind = "string" | "boolean" | "number"

const SETTINGS = {
  model: { kind: "string", description: "默认模型，格式 provider/model" },
  small_model: { kind: "string", description: "小模型（标题生成等任务）" },
  shell: { kind: "string", description: "默认 shell" },
  language: { kind: "string", description: "回复语言，如 zh-CN" },
  logLevel: { kind: "string", description: "日志级别 DEBUG/INFO/WARN/ERROR" },
  default_agent: { kind: "string", description: "默认 agent" },
  username: { kind: "string", description: "显示用户名" },
  snapshot: { kind: "boolean", description: "是否启用文件快照" },
  autoupdate: { kind: "boolean", description: "是否自动更新" },
  subagent_depth: { kind: "number", description: "子代理最大嵌套深度" },
} as const satisfies Record<string, { kind: SettingKind; description: string }>

function isSupported(setting: string): setting is keyof typeof SETTINGS {
  return setting in SETTINGS
}

function readValue(config: ConfigV1.Info, setting: keyof typeof SETTINGS): unknown {
  const record = config as unknown as Record<string, unknown>
  return record[setting]
}

function writeValue(
  current: ConfigV1.Info,
  setting: keyof typeof SETTINGS,
  value: string | boolean | number,
): ConfigV1.Info {
  const next = { ...current } as unknown as Record<string, unknown>
  next[setting] = value
  return next as ConfigV1.Info
}

type ConfigToolMetadata = { setting: string; success: boolean; value?: unknown }

export const ConfigTool = Tool.define<typeof Parameters, ConfigToolMetadata, Config.Service>(
  "config",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const setting = params.setting
          if (!isSupported(setting)) {
            return {
              title: "Unknown setting",
              output: `Unknown setting: "${setting}". Supported settings: ${Object.keys(SETTINGS).join(", ")}`,
              metadata: { setting, success: false },
            }
          }

          const info = yield* config.get()

          // 读操作
          if (params.value === undefined) {
            const value = readValue(info, setting)
            return {
              title: `config.${setting}`,
              output: `${setting} = ${value === undefined ? "(未设置)" : JSON.stringify(value)}`,
              metadata: { setting, success: true, value },
            }
          }

          // 写操作（写全局配置）
          const raw = params.value
          if (SETTINGS[setting].kind === "boolean" && typeof raw !== "boolean") {
            return {
              title: "Invalid value",
              output: `Setting "${setting}" expects a boolean value.`,
              metadata: { setting, success: false },
            }
          }
          if (SETTINGS[setting].kind === "number" && typeof raw !== "number") {
            return {
              title: "Invalid value",
              output: `Setting "${setting}" expects a number value.`,
              metadata: { setting, success: false },
            }
          }
          if (SETTINGS[setting].kind === "string" && typeof raw !== "string") {
            return {
              title: "Invalid value",
              output: `Setting "${setting}" expects a string value.`,
              metadata: { setting, success: false },
            }
          }

          yield* config.updateGlobal(writeValue(info, setting, raw))
          return {
            title: `config.${setting} = ${JSON.stringify(raw)}`,
            output: `Set ${setting} to ${JSON.stringify(raw)}`,
            metadata: { setting, success: true, value: raw },
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)
