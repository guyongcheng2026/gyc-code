import { useEffect, useState } from "react"
import { sdk } from "./sdk"
import { v2 } from "./v2"
import { unwrapList } from "./useCommands"

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

// 兼容解包 provider 响应：{all} 或 {data:{all}} 或 {location,data:{all}}
function unwrapProviders(body: unknown): ProviderInfo[] {
  const b = body as { all?: ProviderInfo[]; data?: { all?: ProviderInfo[] } } | null
  if (!b) return []
  if (Array.isArray(b.all)) return b.all
  if (b.data && Array.isArray(b.data.all)) return b.data.all
  return []
}

// 模型列表来自 provider.list（主体，先到先渲染）；variants 来自 v2 model.list（后台增强，
// 失败/超时不阻塞列表——此前 Promise.all 被慢的 model.list 拖死导致"一直加载中"）。
export function useModels(directory?: string) {
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    // 主体：provider 列表（v1 失败/空回退 v2）
    const loadProviders = async () => {
      setLoading(true)
      try {
        let all: ProviderInfo[] = []
        try {
          const res = await sdk(directory).provider.list()
          all = unwrapProviders(res.data)
        } catch {
          all = []
        }
        if (all.length === 0) {
          const res2 = await v2(directory).v2.provider.list()
          all = unwrapProviders(res2.data)
        }
        if (cancelled) return
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
              variants: [],
            })
          }
        }
        setModels(list)
      } catch {
        // 两路都失败：保持空列表
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    // 增强：variants（不阻塞主体；带 8s 超时防止悬挂）
    const loadVariants = async () => {
      try {
        const res = await Promise.race([
          v2(directory).v2.model.list(),
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 8000)),
        ])
        if (cancelled) return
        const raw =
          (res.data as { data?: Array<{ providerID: string; id: string; variants?: Array<{ id: string }> }> })
            ?.data ??
          unwrapList<{ providerID: string; id: string; variants?: Array<{ id: string }> }>(res.data)
        const variantMap = new Map<string, Array<string>>()
        for (const m of raw) {
          variantMap.set(`${m.providerID}/${m.id}`, (m.variants ?? []).map((v) => v.id))
        }
        if (cancelled) return
        setModels((prev) => prev.map((m) => ({ ...m, variants: variantMap.get(m.label) ?? m.variants })))
      } catch {
        // variants 增强失败不影响主体
      }
    }

    void loadProviders()
    void loadVariants()
    return () => {
      cancelled = true
    }
  }, [directory])

  return { models, loading }
}
