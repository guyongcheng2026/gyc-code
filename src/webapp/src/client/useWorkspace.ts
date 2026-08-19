import { useCallback, useEffect, useState } from "react"
import { v2 } from "./v2"

const DIRS_KEY = "gyc-web-dirs"
const MAX_RECENT = 8

export type LocationInfo = { directory: string; workspaceID?: string; project?: { name?: string } | null }

function readRecent(): string[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DIRS_KEY) : null
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function persistRecent(dirs: string[]) {
  try {
    localStorage.setItem(DIRS_KEY, JSON.stringify(dirs.slice(0, MAX_RECENT)))
  } catch {
    // 无存储时忽略
  }
}

/**
 * 工作区（目录）管理：directory 为 undefined 时使用服务端默认目录（process.cwd），
 * 设置后经 x-gyccode-directory header 作用于全部 API 请求；最近列表 localStorage 持久化。
 */
export function useWorkspace() {
  const [directory, setDirectoryState] = useState<string | undefined>(() => {
    try {
      return (typeof localStorage !== "undefined" ? localStorage.getItem("gyc-web-dir") : null) ?? undefined
    } catch {
      return undefined
    }
  })
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [location, setLocation] = useState<LocationInfo | null>(null)

  useEffect(() => {
    try {
      if (directory) localStorage.setItem("gyc-web-dir", directory)
      else localStorage.removeItem("gyc-web-dir")
    } catch {
      // 无存储时忽略
    }
  }, [directory])

  // 当前生效目录（服务端视角，v2 location.get；directory 经 header 传递）
  useEffect(() => {
    void v2(directory)
      .v2.location.get()
      .then((res) => setLocation((res.data as LocationInfo | undefined) ?? null))
      .catch(() => setLocation(null))
  }, [directory])

  const select = useCallback((dir: string | undefined) => {
    const trimmed = dir?.trim()
    setDirectoryState(trimmed ? trimmed : undefined)
    if (trimmed) {
      setRecent((prev) => {
        const next = [trimmed, ...prev.filter((d) => d !== trimmed)].slice(0, MAX_RECENT)
        persistRecent(next)
        return next
      })
    }
  }, [])

  return { directory, select, recent, location }
}
