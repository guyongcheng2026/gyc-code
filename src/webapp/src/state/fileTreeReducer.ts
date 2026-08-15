export type TreeNode = {
  path: string
  name: string
  type: "file" | "directory"
  status?: "added" | "deleted" | "modified"
}

export type FileTreeState = {
  root: TreeNode[]
  children: Record<string, TreeNode[]>
  expanded: Record<string, boolean>
  status: Record<string, "added" | "deleted" | "modified">
}

export const initialFileTreeState = (): FileTreeState => ({ root: [], children: {}, expanded: {}, status: {} })

export type FileTreeAction =
  | { type: "setRoot"; nodes: TreeNode[] }
  | { type: "setChildren"; path: string; nodes: TreeNode[] }
  | { type: "toggle"; path: string }
  | { type: "setStatus"; status: Record<string, "added" | "deleted" | "modified"> }

export function fileTreeReducer(state: FileTreeState, action: FileTreeAction): FileTreeState {
  switch (action.type) {
    case "setRoot":
      return { ...state, root: action.nodes }
    case "setChildren":
      return { ...state, children: { ...state.children, [action.path]: action.nodes } }
    case "toggle": {
      const expanded = { ...state.expanded, [action.path]: !state.expanded[action.path] }
      return { ...state, expanded }
    }
    case "setStatus":
      return { ...state, status: action.status }
    default:
      return state
  }
}

// 把 node 数组排序：目录在前，文件在后，各自按名称字典序。
export function sortTree(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
