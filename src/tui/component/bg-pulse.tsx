import {
  FrameBufferRenderable,
  RGBA,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core"
import { extend, useRenderer } from "@opentui/solid"
import { onCleanup, onMount } from "solid-js"
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
  let active = false
  // 挂载时的 fps 原值（app.tsx 基线 30 / opentui 默认 maxFps），cleanup 条件恢复：
  // 若 BgPulse 存活期间 session 路由已把 targetFps 接管为流式 60，此处不覆盖——
  // 直接恢复快照会把 60 打回 12，触发"流式降帧到动画刷新率"竞态（P2-1）。
  let originalFps: number | undefined
  let originalMaxFps: number | undefined

  onMount(() => {
    // Respect the global animations toggle; when off, never force a render loop.
    if (!kv.get("animations_enabled", false)) return
    originalFps = renderer.targetFps
    originalMaxFps = renderer.maxFps
    renderer.targetFps = 12
    renderer.maxFps = 12
    active = true
  })

  onCleanup(() => {
    if (!active) return
    // 仅当当前值仍是本组件压低的 12（即未被 session 路由接管）时才恢复原值；
    // 否则保留路由的新值（如流式 60fps），避免空转或降帧。
    if (originalFps !== undefined && renderer.targetFps === 12) renderer.targetFps = originalFps
    if (originalMaxFps !== undefined && renderer.maxFps === 12) renderer.maxFps = originalMaxFps
  })

  if (!kv.get("animations_enabled", false)) return null

  return (
    <go_upsell_art
      width="100%"
      height="100%"
      backgroundPanel={theme.backgroundPanel}
      primary={theme.primary}
      logoBase={tint(theme.background, theme.text, 0.62)}
      live
    />
  )
}
