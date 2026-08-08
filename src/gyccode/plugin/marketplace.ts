import { Schema } from "effect"

export class PluginMeta extends Schema.Class<PluginMeta>("PluginMeta")({
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

export class PluginMarketplace {
  private plugins = new Map<string, PluginMeta>()

  constructor(private config: MarketplaceConfig = DEFAULT_MARKETPLACE_CONFIG) {}

  async fetchIndex(): Promise<PluginMeta[]> {
    // Stub: in production, fetch from config.registry
    return []
  }

  search(query: string): PluginMeta[] {
    const lower = query.toLowerCase()
    return Array.from(this.plugins.values()).filter(
      p =>
        p.name.toLowerCase().includes(lower) ||
        p.description.toLowerCase().includes(lower) ||
        p.keywords?.some(k => k.toLowerCase().includes(lower)),
    )
  }

  async install(name: string, version?: string): Promise<{ success: boolean; path: string }> {
    // Stub: in production, download and extract plugin
    return { success: false, path: "" }
  }

  async update(name: string): Promise<{ success: boolean; from: string; to: string }> {
    // Stub: check for newer version and upgrade
    return { success: false, from: "", to: "" }
  }

  listInstalled(): string[] {
    return Array.from(this.plugins.keys())
  }
}
