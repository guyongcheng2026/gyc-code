export * as ConfigAgent from "./agent"

import path from "path"
import { Exit, Schema } from "effect"
import { Glob } from "@gyccode/core/util/glob"
import { ConfigAgentV1 } from "@gyccode/core/v1/config/agent"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
import { ConfigParse } from "./parse"

export async function load(dir: string) {
  const result: Record<string, ConfigAgentV1.Info> = {}
  for (const item of await Glob.scan("{agent,agents}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(() => undefined)
    if (!md) continue

    const name = configEntryNameFromPath(path.relative(dir, item), ["agent/", "agents/"])

    const config = {
      name,
      ...md.data,
      prompt: md.content.trim(),
    }
    result[config.name] = ConfigParse.schema(ConfigAgentV1.Info, config, item)
  }

  // 声明式插件 agents：<dir>/{plugin,plugins}/*/agents/**/*.md。
  // 目录缺失时 Glob.scan 会抛错，降级为空扫描（插件目录可选）。
  for (const sub of ["plugin", "plugins"]) {
    const root = path.join(dir, sub)
    const matches = await Glob.scan("*/agents/**/*.md", {
      cwd: root,
      absolute: true,
      dot: true,
      symlink: true,
    }).catch(() => [] as string[])
    for (const item of matches) {
      const md = await ConfigMarkdown.parse(item).catch(() => undefined)
      if (!md) continue
      // name 取 frontmatter 声明（若有），否则文件名；插件 agent 名不跨插件命名空间。
      const name = configEntryNameFromPath(path.relative(root, item), ["agents/"])
      const config = {
        name,
        ...md.data,
        prompt: md.content.trim(),
      }
      result[config.name] = ConfigParse.schema(ConfigAgentV1.Info, config, item)
    }
  }
  return result
}

export async function loadMode(dir: string) {
  const result: Record<string, ConfigAgentV1.Info> = {}
  for (const item of await Glob.scan("{mode,modes}/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(() => undefined)
    if (!md) continue

    const config = {
      name: configEntryNameFromPath(path.relative(dir, item), ["mode/", "modes/"]),
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Schema.decodeUnknownExit(ConfigAgentV1.Info)(config, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(parsed)) {
      result[config.name] = {
        ...parsed.value,
        mode: "primary" as const,
      }
    }
  }
  return result
}
