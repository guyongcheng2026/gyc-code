import path from "path"
import fs from "fs/promises"

import { Schema } from "effect"
import semver from "semver"

import { Global } from "@gyccode/core/global"

export class PluginEntry extends Schema.Class<PluginEntry>("PluginEntry")({
  name: Schema.String,
  version: Schema.String,
  description: Schema.String,
  author: Schema.String,
  repository: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.Array(Schema.String)),
}) {}

export interface MarketplaceConfig {
  registry: string  // URL of plugin registry
  cacheDir: string  // Local cache for plugin metadata
}

export const DEFAULT_MARKETPLACE_CONFIG: MarketplaceConfig = {
  registry: "https://plugins.gyc-code.dev/index.json",
  cacheDir: ".gyc/plugins/cache",
}

const REQUEST_TIMEOUT_MS = 10_000

export class PluginMarketplace {
  private plugins = new Map<string, PluginEntry>()
  private installed = new Map<string, string>() // name -> version

  constructor(private config: MarketplaceConfig = DEFAULT_MARKETPLACE_CONFIG) {}

  private decodeIndex = Schema.decodeUnknownSync(Schema.Array(PluginEntry))

  // Base registry URL, e.g. "https://plugins.gyc-code.dev" from ".../index.json"
  private registryBase(): string {
    return this.config.registry.replace(/\/index\.json$/, "")
  }

  // Resolve the local plugin cache dir under the user's gyc data dir.
  private cacheDir(): string {
    return path.isAbsolute(this.config.cacheDir)
      ? this.config.cacheDir
      : path.join(Global.Path.data, this.config.cacheDir)
  }

  async fetchIndex(): Promise<PluginEntry[]> {
    try {
      const res = await fetch(this.config.registry, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) return []
      const data = await res.json()
      const list = this.decodeIndex(data)
      // Merge into the in-memory index, don't wipe existing entries.
      for (const meta of list) {
        this.plugins.set(meta.name, meta)
      }
      return Array.from(list)
    } catch {
      // Network / parse errors are non-fatal: return an empty index.
      return []
    }
  }

  search(query: string): PluginEntry[] {
    const lower = query.toLowerCase()
    return Array.from(this.plugins.values()).filter(
      p =>
        p.name.toLowerCase().includes(lower) ||
        p.description.toLowerCase().includes(lower) ||
        p.keywords?.some(k => k.toLowerCase().includes(lower)),
    )
  }

  async install(name: string, version?: string): Promise<{ success: boolean; path: string }> {
    try {
      const target = version ?? this.installed.get(name) ?? (await this.latestVersion(name))
      if (!target) return { success: false, path: "" }

      const url = `${this.registryBase()}/pkg/${encodeURIComponent(name)}/${encodeURIComponent(target)}.tgz`
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!res.ok) return { success: false, path: "" }

      const bytes = new Uint8Array(await res.arrayBuffer())
      const dir = this.cacheDir()
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, `${name}-${target}.tgz`), bytes)

      this.installed.set(name, target)
      return { success: true, path: dir }
    } catch {
      return { success: false, path: "" }
    }
  }

  async update(name: string): Promise<{ success: boolean; from: string; to: string }> {
    const from = this.installed.get(name)
    if (!from) return { success: false, from: "", to: "" }

    await this.fetchIndex()
    const latest = this.plugins.get(name)?.version
    if (!latest || !semver.valid(from) || !semver.valid(latest) || !semver.gt(latest, from)) {
      return { success: false, from, to: "" }
    }

    const result = await this.install(name, latest)
    return { success: result.success, from, to: result.success ? latest : "" }
  }

  listInstalled(): string[] {
    return Array.from(this.installed.keys())
  }

  private async latestVersion(name: string): Promise<string | undefined> {
    if (!this.plugins.has(name)) await this.fetchIndex()
    return this.plugins.get(name)?.version
  }
}
