import { HookConfig, HookEvent } from "./types"

export class HookRegistry {
  private hooks = new Map<HookEvent, HookConfig[]>()

  register(config: HookConfig): void {
    const existing = this.hooks.get(config.event) ?? []
    existing.push(config)
    this.hooks.set(config.event, existing)
  }

  getHooks(event: HookEvent, toolName?: string): HookConfig[] {
    const hooks = this.hooks.get(event) ?? []
    if (!toolName) return hooks
    return hooks.filter(h => !h.matcher || new RegExp(h.matcher).test(toolName))
  }

  clear(): void {
    this.hooks.clear()
  }
}
