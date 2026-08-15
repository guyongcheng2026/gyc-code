import { useEffect, useState } from "react"
import { sdk } from "./sdk"

export type CommandItem = { name: string; description?: string; agent?: string; model?: string; subtask?: boolean }

// 获取可用斜杠命令（服务端 command.list）
export function useCommands(directory?: string) {
  const [commands, setCommands] = useState<CommandItem[]>([])

  useEffect(() => {
    void sdk(directory)
      .command.list()
      .then((res) => {
        const list = (res.data as CommandItem[] | undefined) ?? []
        setCommands(list.filter((c) => !c.subtask))
      })
      .catch(() => {})
  }, [directory])

  return { commands }
}
