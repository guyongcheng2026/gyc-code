import { transformSync } from "@babel/core"
// @ts-expect-error - Types not important.
import ts from "@babel/preset-typescript"
// @ts-expect-error - Types not important.
import moduleResolver from "babel-plugin-module-resolver"
// @ts-expect-error - Types not important.
import solid from "babel-preset-solid"
import { plugin as registerBunPlugin, type BunPlugin } from "bun"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export type ResolveImportPath = (specifier: string) => string | null

const solidTransformStateKey = Symbol.for("opentui.solid.transform")

type SolidTransformRuntime = {
  moduleName?: string
  resolvePath?: ResolveImportPath
}

type SolidTransformState = {
  installed: boolean
  runtime?: SolidTransformRuntime
}

type GlobalSolidTransformState = typeof globalThis & {
  [solidTransformStateKey]?: SolidTransformState
}

export interface CreateSolidTransformPluginOptions {
  moduleName?: string
  resolvePath?: ResolveImportPath
}

const getSolidTransformState = (): SolidTransformState => {
  const state = globalThis as GlobalSolidTransformState
  state[solidTransformStateKey] ??= { installed: false }
  return state[solidTransformStateKey]
}

const getSolidTransformRuntime = (): SolidTransformRuntime => {
  return getSolidTransformState().runtime ?? {}
}

const sourcePath = (path: string): string => {
  const searchIndex = path.indexOf("?")
  const hashIndex = path.indexOf("#")
  const end = [searchIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0]
  return end === undefined ? path : path.slice(0, end)
}

const hasSolidTransformRuntime = (input: CreateSolidTransformPluginOptions): boolean => {
  return input.moduleName !== undefined || input.resolvePath !== undefined
}

export function ensureSolidTransformPlugin(input: CreateSolidTransformPluginOptions = {}): boolean {
  const state = getSolidTransformState()

  if (hasSolidTransformRuntime(input)) {
    state.runtime = {
      moduleName: input.moduleName,
      resolvePath: input.resolvePath,
    }
  }

  if (state.installed) {
    return false
  }

  registerBunPlugin(createSolidTransformPlugin())
  state.installed = true
  return true
}

export function resetSolidTransformPluginState(): void {
  const state = getSolidTransformState()
  state.installed = false
  delete state.runtime
}

export function createSolidTransformPlugin(input: CreateSolidTransformPluginOptions = {}): BunPlugin {
  const solidJsSolidPath = fileURLToPath(import.meta.resolve("solid-js/dist/solid.js"))
  const solidJsStorePath = fileURLToPath(import.meta.resolve("solid-js/store/dist/store.js"))
  const solidJsWebPath = fileURLToPath(import.meta.resolve("solid-js/web/dist/web.js"))

  return {
    name: "bun-plugin-solid",
    setup: (build) => {
      // @opentui/solid 直接依赖 solid-js/dist/solid.js，而业务代码 import "solid-js"
      // 走 exports 会解析到不同文件（如 dist/server.js），导致运行时出现两份 solid-js
      // （各自的 Owner/context 全局状态互相独立）。这里统一重定向到同一份 dist/solid.js。
      build.onResolve({ filter: /^solid-js$/ }, () => ({
        path: solidJsSolidPath,
      }))
      build.onResolve({ filter: /^solid-js\/store$/ }, () => ({
        path: solidJsStorePath,
      }))
      build.onResolve({ filter: /^solid-js\/web$/ }, () => ({
        path: solidJsWebPath,
      }))

      build.onLoad({ filter: /[/\\]node_modules[/\\]solid-js[/\\]dist[/\\]server\.js(?:[?#].*)?$/ }, (args) => {
        const path = sourcePath(args.path).replace("server.js", "solid.js")
        return { contents: readFileSync(path, "utf-8"), loader: "js" }
      })

      build.onLoad(
        { filter: /[/\\]node_modules[/\\]solid-js[/\\]store[/\\]dist[/\\]server\.js(?:[?#].*)?$/ },
        (args) => {
          const path = sourcePath(args.path).replace("server.js", "store.js")
          return { contents: readFileSync(path, "utf-8"), loader: "js" }
        },
      )

      build.onLoad({ filter: /\.(js|ts)x(?:[?#].*)?$/ }, (args) => {
        const path = sourcePath(args.path)
        const code = readFileSync(path, "utf-8")
        const runtime = getSolidTransformRuntime()
        // S1 JSX 分流：fallback 渲染器的 Solid 组件（src/tui/fallback 下）绑定
        // 自研 reconciler 的 jsx-runtime（#fallback-solid 别名，见 package.json
        // imports + tsconfig paths）；其余文件维持 @opentui/solid 不变。
        const inFallback = /[/\\]src[/\\]tui[/\\]fallback[/\\]/.test(path)
        const moduleName = input.moduleName ?? runtime.moduleName ?? (inFallback ? "#fallback-solid" : "@opentui/solid")
        const resolvePath = input.resolvePath ?? runtime.resolvePath
        const plugins = resolvePath
          ? [
              [
                moduleResolver,
                {
                  resolvePath(specifier: string) {
                    return resolvePath(specifier) ?? specifier
                  },
                },
              ],
            ]
          : []
        const transforms = transformSync(code, {
          filename: path,
          configFile: false,
          babelrc: false,
          plugins,
          presets: [
            [
              solid,
              {
                moduleName,
                generate: "universal",
              },
            ],
            [ts],
          ],
        })
        return {
          contents: transforms?.code ?? "",
          loader: "js",
        }
      })
    },
  }
}

const solidTransformPlugin = createSolidTransformPlugin()

export default solidTransformPlugin