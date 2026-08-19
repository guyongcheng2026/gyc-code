import { useState, type CSSProperties, type ReactNode } from "react"

/**
 * 折叠行原子组件（对齐 DSH DisclosureRow）：
 * 紧凑标题行 + 可展开内容区；内容区高度自适应，超过 maxHeight 后滚动。
 */
export function DisclosureRow({
  icon,
  title,
  meta,
  defaultOpen = false,
  maxHeight = 141,
  children,
  titleStyle,
}: {
  icon?: ReactNode
  title: ReactNode
  meta?: ReactNode
  defaultOpen?: boolean
  maxHeight?: number
  children: ReactNode
  titleStyle?: CSSProperties
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="disclosure">
      <button
        className="disclosure-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={titleStyle}
      >
        {icon ? <span className="disclosure-icon">{icon}</span> : null}
        <span className="disclosure-title">{title}</span>
        {meta ? <span className="disclosure-meta">{meta}</span> : null}
        <span className="disclosure-chevron" style={{ transform: open ? "rotate(90deg)" : "none" }}>
          ›
        </span>
      </button>
      {open ? (
        <div className="disclosure-body" style={{ maxHeight }}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
