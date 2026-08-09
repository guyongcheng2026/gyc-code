import type { Provider } from "@opencode-ai/sdk/v2"

export type ContextWindow = {
  hard: number
  effective: number
  source: "model" | "config"
}

export function contextWindow(
  _config: unknown,
  model: Provider["models"][string] | undefined,
): ContextWindow | undefined {
  if (!model) return undefined
  const hard = model.limit.context
  if (!hard || hard === 0) return undefined
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
