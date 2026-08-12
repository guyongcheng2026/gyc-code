import type { Provider } from "@gyccode/protocol/v2"
import { isRecord } from "./record"

export type ContextWindow = {
  hard: number
  effective: number
  source: "model" | "config"
}

function configContextLimit(config: unknown, providerID: string, modelID: string): number | undefined {
  if (!isRecord(config)) return undefined
  const providers = config.provider
  if (!isRecord(providers)) return undefined
  const provider = providers[providerID]
  if (!isRecord(provider)) return undefined
  const models = provider.models
  if (!isRecord(models)) return undefined
  const entry = models[modelID]
  if (!isRecord(entry)) return undefined
  const limit = entry.limit
  if (!isRecord(limit)) return undefined
  const value = limit.context
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return value
}

export function contextWindow(
  config: unknown,
  providerID: string,
  modelID: string,
  model: Provider["models"][string] | undefined,
): ContextWindow | undefined {
  if (!model) return undefined
  const hard = model.limit.context
  if (!hard || hard === 0) return undefined
  const configLimit = configContextLimit(config, providerID, modelID)
  if (configLimit !== undefined) {
    return { hard, effective: configLimit, source: "config" }
  }
  return { hard, effective: hard, source: "model" }
}

export function parse(value: string) {
  const [providerID, ...modelID] = value.split("/")
  return { providerID, modelID: modelID.join("/") }
}

export function index(list: Provider[] | undefined) {
  return new Map((list ?? []).map((item) => [item.id, item] as const))
}

export function get(list: Provider[] | ReadonlyMap<string, Provider> | undefined, providerID: string, modelID: string) {
  const provider =
    list instanceof Map
      ? list.get(providerID)
      : Array.isArray(list)
        ? list.find((item) => item.id === providerID)
        : undefined
  return provider?.models[modelID]
}

export function name(
  list: Provider[] | ReadonlyMap<string, Provider> | undefined,
  providerID: string,
  modelID: string,
) {
  return get(list, providerID, modelID)?.name ?? modelID
}
