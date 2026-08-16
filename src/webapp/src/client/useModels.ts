import { useEffect, useState } from "react"
import { sdk } from "./sdk"
import { v2 } from "./v2"

export type ModelOption = {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
  label: string // provider/modelID
  variants: Array<string>
}

type ProviderInfo = {
  id: string
  name: string
  models: Record<string, { id: string; name: string }>
}

// 模型列表来自 provider.list（与历史一致），variants 来自 v2 model.list（含 variants 字段）。
export function useModels(directory?: string) {
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([
      sdk(directory).provider.list(),
      v2(directory).v2.model.list().catch(() => ({ data: undefined })),
    ])
      .then(([providerRes, modelRes]) => {
        if (cancelled) return
        const variantMap = new Map<string, Array<string>>()
        const rawModels = (
          modelRes.data as
            | { data?: Array<{ providerID: string; id: string; variants?: Array<{ id: string }> }> }
            | undefined
        )?.data
        for (const m of rawModels ?? []) {
          variantMap.set(
            `${m.providerID}/${m.id}`,
            (m.variants ?? []).map((v) => v.id),
          )
        }
        const all = ((providerRes.data as { all?: ProviderInfo[] } | undefined)?.all ?? [])
        const list: ModelOption[] = []
        for (const p of all) {
          for (const m of Object.values(p.models ?? {})) {
            if (!m?.id) continue
            const key = `${p.id}/${m.id}`
            list.push({
              providerID: p.id,
              providerName: p.name,
              modelID: m.id,
              modelName: m.name ?? m.id,
              label: key,
              variants: variantMap.get(key) ?? [],
            })
          }
        }
        setModels(list)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [directory])

  return { models, loading }
}
