import { useCallback, useEffect, useReducer } from "react"
import {
  fileTreeReducer,
  initialFileTreeState,
  sortTree,
  type TreeNode,
} from "../state/fileTreeReducer"
import { sdk } from "./sdk"

type FileNode = { name: string; path: string; type: "file" | "directory" }
type StatusEntry = { path: string; status: "added" | "deleted" | "modified" }

// 文件树：根目录懒加载 + 按需展开目录 + git 状态角标。
// file.list 返回指定 path 的直接子项；file.status 返回 git 变更清单。
export function useFileTree(directory?: string) {
  const [state, dispatch] = useReducer(fileTreeReducer, undefined, initialFileTreeState)

  const loadRoot = useCallback(async () => {
    const res = await sdk(directory).file.list({ query: { path: "" } })
    const nodes = ((res.data as FileNode[]) ?? []).map(toTreeNode)
    dispatch({ type: "setRoot", nodes: sortTree(nodes) })
  }, [directory])

  const loadStatus = useCallback(async () => {
    const res = await sdk(directory).file.status()
    const entries = (res.data as StatusEntry[] | undefined) ?? []
    const status: Record<string, "added" | "deleted" | "modified"> = {}
    for (const e of entries) status[e.path] = e.status
    dispatch({ type: "setStatus", status })
  }, [directory])

  const toggle = useCallback(async (node: TreeNode) => {
    dispatch({ type: "toggle", path: node.path })
    if (node.type === "directory" && !state.children[node.path]) {
      const res = await sdk(directory).file.list({ query: { path: node.path } })
      const nodes = ((res.data as FileNode[]) ?? []).map(toTreeNode)
      dispatch({ type: "setChildren", path: node.path, nodes: sortTree(nodes) })
    }
  }, [directory, state.children])

  useEffect(() => {
    void loadRoot().catch(() => {})
    void loadStatus().catch(() => {})
  }, [loadRoot, loadStatus])

  return { state, toggle, reload: loadRoot }
}

function toTreeNode(n: FileNode): TreeNode {
  return { path: n.path, name: n.name, type: n.type }
}
