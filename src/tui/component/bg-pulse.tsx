import {
  FrameBufferRenderable,
  RGBA,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core"
import { extend, useRenderer } from "@opentui/solid"
import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import { tint, useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { GoUpsellArtPainter } from "./bg-pulse-render"

type GoUpsellArtOptions = RenderableOptions<FrameBufferRenderable> & {
  backgroundPanel?: RGBA
  primary?: RGBA
  logoBase?: RGBA
}

class GoUpsellArtRenderable extends FrameBufferRenderable {
  private painter = new GoUpsellArtPainter()

  constructor(ctx: RenderContext, options: GoUpsellArtOptions = {}) {
    const width = typeof options.width === "number" ? options.width : 1
    const height = typeof options.height === "number" ? options.height : 1
    super(ctx, {
      ...options,
      width,
      height,
      live: options.live ?? true,
      respectAlpha: false,
    })

    if (options.width !== undefined && typeof options.width !== "number") this.width = options.width
    if (options.height !== undefined && typeof options.height !== "number") this.height = options.height
    this.painter.setBackgroundPanel(options.backgroundPanel)
    this.painter.setPrimary(options.primary)
    this.painter.setLogoBase(options.logoBase)
  }

  set backgroundPanel(value: RGBA | undefined) {
    if (this.painter.setBackgroundPanel(value)) this.requestRender()
  }

  set logoBase(value: RGBA | undefined) {
    if (this.painter.setLogoBase(value)) this.requestRender()
  }

  set primary(value: RGBA | undefined) {
    if (this.painter.setPrimary(value)) this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    if (!this.visible || this.isDestroyed) return

    this.painter.render(this.frameBuffer, {
      deltaTime,
      rgb: this._ctx.capabilities?.rgb === true,
    })
    super.renderSelf(buffer)
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    go_upsell_art: typeof GoUpsellArtRenderable
  }
}

extend({ go_upsell_art: GoUpsellArtRenderable })

export function BgPulse() {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const kv = useKV()
  // 响应式读取全局动画开关。
  // 必须包在 createMemo 里：kv.get 读的是 Solid store 代理，本身是响应式的，
  // 但 Solid 的 createComponent 用 untrack 执行组件体——组件体内直接读不建立
  // 依赖，挂载后再切换 animations_enabled 不会生效（旧实现因此关不掉动画，
  // 动效节点继续常驻并持续占帧）。
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", false))
  // 挂载时的 fps 原值（app.tsx 基线 30 / opentui 默认 maxFps），cleanup 条件恢复：
  // 若 BgPulse 存活期间 session 路由已把 targetFps 接管为流式 60，此处不覆盖——
  // 直接恢复快照会把 60 打回 12，触发"流式降帧到动画刷新率"竞态（P2-1）。
  let originalFps: number | undefined
  let originalMaxFps: number | undefined

  createEffect(() => {
    // 开关关闭时不压帧：整个动效不挂载，零渲染、零占帧。
    if (!animationsEnabled()) return
    originalFps = renderer.targetFps
    originalMaxFps = renderer.maxFps
    renderer.targetFps = 12
    renderer.maxFps = 12
    onCleanup(() => {
      // targetFps：仅当当前值仍是本组件压低的 12（即未被 session 路由接管）时才恢复原值；
      // 否则保留路由的新值（如流式 60fps），避免把 60 打回 12 的竞态（P2-1）。
      if (originalFps !== undefined && renderer.targetFps === 12) renderer.targetFps = originalFps
      // maxFps：同样条件恢复。maxFps 决定帧间隔下限（1000/maxFps），
      // 压到 12 会把 requestRender 的调度延迟钉到 ≥83ms；若期间有别的组件
      // 改过 maxFps，无条件恢复会把它打回快照值。
      if (originalMaxFps !== undefined && renderer.maxFps === 12) renderer.maxFps = originalMaxFps
      originalFps = undefined
      originalMaxFps = undefined
    })
  })

  return (
    // 关闭时根本不挂载动效节点：零渲染、零占帧。
    <Show when={animationsEnabled()}>
      <go_upsell_art
        width="100%"
        height="100%"
        backgroundPanel={theme.backgroundPanel}
        primary={theme.primary}
        logoBase={tint(theme.background, theme.text, 0.62)}
        live
      />
    </Show>
  )
}
