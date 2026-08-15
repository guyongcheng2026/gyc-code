import { useCallback, useState } from "react"
import type { FileTreeState, TreeNode } from "../state/fileTreeReducer"
import { useFileTree } from "../client/useFileTree"

const STATUS_MARK: Record<string, string> = { added: "A", deleted: "D", modified: "M" }

export function FileTree({
  state,
  selected,
  onSelect,
  onToggle,
}: {
  state: FileTreeState
  selected: string | null
  onSelect: (path: string) => void
  onToggle: (node: TreeNode) => void
}) {
  const renderNode = useCallback(
    (node: TreeNode, depth: number): React.ReactNode => {
      const mark = node.type === "file" ? (state.status[node.path] ? STATUS_MARK[state.status[node.path]] : "") : ""
      const expanded = !!state.expanded[node.path]
      const children = node.type === "directory" ? state.children[node.path] : undefined
      return (
        <div key={node.path}>
          <div
            onClick={() => (node.type === "directory" ? onToggle(node) : onSelect(node.path))}
            style={{
              paddingLeft: 4 + depth * 14,
              paddingTop: 2,
              paddingBottom: 2,
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              background: selected === node.path ? "#2a3a4a" : "transparent",
            }}
          >
            <span style={{ color: "#777", display: "inline-block", width: 14 }}>
              {node.type === "directory" ? (expanded ? "▾" : "▸") : ""}
            </span>
            <span style={{ color: node.type === "directory" ? "#9cdcfe" : "#ccc" }}>{node.name}</span>
            {mark ? <span style={{ marginLeft: 6, color: "#e5c07b" }}>{mark}</span> : null}
          </div>
          {expanded && children
            ? children.map((c) => renderNode(c, depth + 1))
            : null}
        </div>
      )
    },
    [state.expanded, state.children, state.status, selected, onToggle, onSelect],
  )

  return (
    <div style={{ overflowY: "auto", height: "100%", fontSize: 13 }}>
      {state.root.map((n) => renderNode(n, 0))}
    </div>
  )
}
