import { useEffect, useState } from "react"
import { sdk } from "./sdk"

export type ModelOption = {
  providerID: string
  providerName: string
  modelID: string
  modelName: string
  label: string // provider/modelID
}

type ProviderInfo = {
  id: string
  name: string
  models: Record<string, { id: string; name: string }>
}

// 获取可用模型列表（provider.list → 各 provider 的 models 映射）
export function useModels(directory?: string) {
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void sdk(directory)
      .provider.list()
      .then((res) => {
        if (cancelled) return
        const all = ((res.data as { all?: ProviderInfo[] } | undefined)?.all ?? [])
        const list: ModelOption[] = []
        for (const p of all) {
          for (const m of Object.values(p.models ?? {})) {
            if (!m?.id) continue
            list.push({
              providerID: p.id,
              providerName: p.name,
              modelID: m.id,
              modelName: m.name ?? m.id,
              label: `${p.id}/${m.id}`,
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
