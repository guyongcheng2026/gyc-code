// 加载态组件（对齐 frontend-geeker Loading：4 点旋转 spinner，ant 风格）。
// 颜色用 gyc 品牌色 var(--brand) 替代 Element Plus 的 var(--el-color-primary)。
// 用法：<Loading label="加载中" />（spinner + 文字）或 <Loading />（纯动画）。
export function Loading({ label }: { label?: string }) {
  return (
    <div className="loading-box" role="status" aria-live="polite">
      <span className="dot" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      {label ? <span className="loading-label">{label}</span> : null}
    </div>
  )
}
