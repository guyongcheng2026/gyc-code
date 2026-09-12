import { intro, log, outro, spinner } from "@clack/prompts"
import { Effect } from "effect"

import { ConfigPaths } from "@/config/paths"
import { Global } from "@gyccode/core/global"
import { installPlugin, patchPluginConfig, readPluginManifest } from "../../plugin/install"
import { resolvePluginTarget } from "../../plugin/shared"
import { errorMessage } from "../../util/error"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"

type Spin = {
  start: (msg: string) => void
  stop: (msg: string, code?: number) => void
}

export type PlugDeps = {
  spinner: () => Spin
  log: {
    error: (msg: string) => void
    info: (msg: string) => void
    success: (msg: string) => void
  }
  resolve: (spec: string) => Promise<string>
  readText: (file: string) => Promise<string>
  write: (file: string, text: string) => Promise<void>
  exists: (file: string) => Promise<boolean>
  files: (dir: string, name: "gyccode" | "tui") => string[]
  global: string
}

export type PlugInput = {
  mod: string
  global?: boolean
  force?: boolean
}

export type PlugCtx = {
  vcs?: string
  worktree: string
  directory: string
}

const defaultPlugDeps: PlugDeps = {
  spinner: () => spinner(),
  log: {
    error: (msg) => log.error(msg),
    info: (msg) => log.info(msg),
    success: (msg) => log.success(msg),
  },
  resolve: (spec) => resolvePluginTarget(spec),
  readText: (file) => Filesystem.readText(file),
  write: async (file, text) => {
    await Filesystem.write(file, text)
  },
  exists: (file) => Filesystem.exists(file),
  files: (dir, name) => ConfigPaths.fileInDirectory(dir, name),
  global: Global.Path.config,
}

function cause(err: unknown) {
  if (!err || typeof err !== "object") return
  if (!("cause" in err)) return
  return (err as { cause?: unknown }).cause
}

export function createPlugTask(input: PlugInput, dep: PlugDeps = defaultPlugDeps) {
  const mod = input.mod
  const force = Boolean(input.force)
  const global = Boolean(input.global)

  return async (ctx: PlugCtx) => {
    const install = dep.spinner()
    install.start("正在安装插件包...")
    const target = await installPlugin(mod, dep)
    if (!target.ok) {
      install.stop("安装失败")
      dep.log.error(`Could not install "${mod}"`)
      const hit = cause(target.error) ?? target.error
      if (hit instanceof Process.RunFailedError) {
        const lines = hit.stderr
          .toString()
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        const errs = lines.filter((line) => line.startsWith("error:")).map((line) => line.replace(/^error:\s*/, ""))
        const detail = errs[0] ?? lines.at(-1)
        if (detail) dep.log.error(detail)
        if (lines.some((line) => line.includes("No version matching"))) {
          dep.log.info("This package depends on a version that is not available in your npm registry.")
          dep.log.info("Check npm registry/auth settings and try again.")
        }
      }
      if (!(hit instanceof Process.RunFailedError)) {
        dep.log.error(errorMessage(hit))
      }
      return false
    }
    install.stop("插件包已就绪")

    const inspect = dep.spinner()
    inspect.start("正在读取插件清单...")
    const manifest = await readPluginManifest(target.target)
    if (!manifest.ok) {
      if (manifest.code === "manifest_read_failed") {
        inspect.stop("清单读取失败")
        dep.log.error(`已安装 "${mod}"，但无法读取 ${manifest.file}`)
        dep.log.error(errorMessage(cause(manifest.error) ?? manifest.error))
        return false
      }

      if (manifest.code === "manifest_no_targets") {
        inspect.stop("未找到插件目标")
        dep.log.error(`"${mod}" does not expose plugin entrypoints in package.json`)
        dep.log.info(
          '应为以下之一：exports["./tui"]、exports["./server"]、服务端的 package.json main，或 tui 主题的 package.json["oc-themes"]。',
        )
        return false
      }

      inspect.stop("清单读取失败")
      return false
    }

    inspect.stop(
      `检测到目标：${manifest.targets.map((item) => item.kind).join(" + ")}`,
    )

    const patch = dep.spinner()
    patch.start("正在更新插件配置...")
    const out = await patchPluginConfig(
      {
        spec: mod,
        targets: manifest.targets,
        force,
        global,
        vcs: ctx.vcs,
        worktree: ctx.worktree,
        directory: ctx.directory,
        config: dep.global,
      },
      dep,
    )
    if (!out.ok) {
      if (out.code === "invalid_json") {
        patch.stop(`更新 ${out.kind} 配置失败`)
        dep.log.error(`JSON 无效：${out.file}（${out.parse}，第 ${out.line} 行第 ${out.col} 列）`)
        dep.log.info("请修复配置文件后重新运行该命令。")
        return false
      }

      patch.stop("更新插件配置失败")
      dep.log.error(errorMessage(out.error))
      return false
    }
    patch.stop("插件配置已更新")
    for (const item of out.items) {
      if (item.mode === "noop") {
        dep.log.info(`已在以下文件中配置：${item.file}`)
        continue
      }
      if (item.mode === "replace") {
        dep.log.info(`已替换：${item.file}`)
        continue
      }
      dep.log.info(`已添加到：${item.file}`)
    }

    dep.log.success(`已安装 ${mod}`)
    dep.log.info(global ? `作用域：全局（${out.dir}）` : `作用域：本地（${out.dir}）`)
    return true
  }
}

export const PluginCommand = effectCmd({
  command: "plugin [module] [query]",
  aliases: ["plug"],
  describe: "管理插件：install <module> / search <query> / list",
  builder: (yargs) =>
    yargs
      .positional("module", {
        type: "string",
        describe: "npm 模块名（或 search / list 子命令）",
      })
      .positional("query", {
        type: "string",
        describe: "search 子命令的搜索关键词",
      })
      .option("global", {
        alias: ["g"],
        type: "boolean",
        default: false,
        describe: "安装到全局配置",
      })
      .option("force", {
        alias: ["f"],
        type: "boolean",
        default: false,
        describe: "替换现有的插件版本",
      }),
  handler: Effect.fn("Cli.plug")(function* (args) {
    const mod = String(args.module ?? "").trim()

    // 子命令：gyc plugin search <query> / gyc plugin list
    if (mod === "search" || mod === "list") {
      const { PluginMarketplace } = yield* Effect.promise(() => import("../../plugin/marketplace"))
      const market = new PluginMarketplace()
      if (mod === "search") {
        const query = String(args.query ?? "").trim()
        const index = yield* Effect.promise(() => market.fetchIndex())
        if (!index.length) {
          UI.error("插件市场暂不可用（guyongcheng2026.github.io/gyc-code）")
          return
        }
        const results = query ? market.search(query) : index
        if (!results.length) {
          UI.error(`未找到与 "${query}" 匹配的插件`)
          return
        }
        UI.empty()
        for (const p of results) {
          UI.println(
            `${p.name}@${p.version} — ${p.description}${p.keywords?.length ? ` [${p.keywords.join(", ")}]` : ""}`,
          )
        }
        return
      }
      const pathMod = yield* Effect.promise(() => import("path"))
      const fsMod = yield* Effect.promise(() => import("fs/promises"))
      const { Global } = yield* Effect.promise(() => import("@gyccode/core/global"))
      const dir = pathMod.join(Global.Path.data, ".gyc", "plugins", "cache")
      // readdir 失败（目录不存在等）时降级为空列表。
      // 注意：Effect fiber 失败不走 JS try/catch，必须在 promise 内捕获，否则 ENOENT 会漏到顶层。
      const files = yield* Effect.promise(() => fsMod.readdir(dir).catch(() => [] as string[]))
      const tgzs = files.filter((f) => f.endsWith(".tgz")).sort()
      if (!tgzs.length) {
        UI.println("暂无通过市场安装的插件")
        return
      }
      UI.empty()
      for (const f of tgzs) UI.println(f)
      return
    }

    if (!mod) {
      UI.error("用法：gyc plugin <module> 安装 / gyc plugin search <query> 搜索 / gyc plugin list 列表")
      process.exitCode = 1
      return
    }

    UI.empty()
    intro(`安装插件 ${mod}`)

    const run = createPlugTask({
      mod,
      global: Boolean(args.global),
      force: Boolean(args.force),
    })

    const ctx = yield* InstanceRef
    if (!ctx) return
    const ok = yield* Effect.promise(() =>
      run({
        vcs: ctx.project.vcs,
        worktree: ctx.worktree,
        directory: ctx.directory,
      }),
    )

    outro("完成")
    if (!ok) process.exitCode = 1
  }),
})
