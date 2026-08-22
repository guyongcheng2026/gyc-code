import { useCallback, useEffect, useState } from "react"
import { sdk } from "./sdk"

export type FileContentData = {
  type: "text" | "binary"
  content: string
}

// 读取文件内容：file.read 返回文本/二进制与内容。
export function useFileContent(path: string | null, directory?: string) {
  const [content, setContent] = useState<FileContentData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!path) return
    setLoading(true)
    setError(null)
    try {
      const res = await sdk(directory).file.read({ query: { path } })
      const data = res.data as FileContentData
      if (data.type === "binary") {
        setError("二进制文件无法预览")
        setContent(null)
      } else {
        setContent(data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setContent(null)
    } finally {
      setLoading(false)
    }
  }, [path, directory])

  useEffect(() => {
    void load()
  }, [load])

  return { content, loading, error, reload: load }
}
