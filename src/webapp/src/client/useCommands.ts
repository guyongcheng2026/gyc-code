import { useEffect, useState } from "react"
import { sdk } from "./sdk"
import { v2 } from "./v2"

export type CommandItem = { name: string; description?: string; agent?: string; model?: string; subtask?: boolean }

// v1 响应兼容解包：裸数组 或 {location, data} 包装（服务端 location 中间件包装形态）。
export function unwrapList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  const wrapped = body as { data?: unknown } | null
  if (wrapped && Array.isArray(wrapped.data)) return wrapped.data as T[]
  return []
}

// 获取可用斜杠命令：v1 command.list 失败或空时回退 v2 /api/command（已实测全量）。
export function useCommands(directory?: string) {
  const [commands, setCommands] = useState<CommandItem[]>([])

  useEffect(() => {
    let cancelled = false
    const apply = (body: unknown) => {
      const list = unwrapList<CommandItem>(body).filter((c) => !c.subtask)
      if (!cancelled && list.length > 0) setCommands(list)
    }
    void sdk(directory)
      .command.list()
      .then((res) => {
        const list = unwrapList<CommandItem>(res.data)
        if (list.length > 0) apply(res.data)
        else throw new Error("empty")
      })
      .catch(() =>
        v2(directory)
          .v2.command.list()
          .then((res) => apply(res.data))
          // 命令列表拉取失败时保持已有命令，不阻断界面渲染
          .catch(() => {}),
      )
    return () => {
      cancelled = true
    }
  }, [directory])

  return { commands }
}
