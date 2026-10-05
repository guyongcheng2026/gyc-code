/**
 * 渲染健康度采集：帧时趋势 + 渲染错误计数。
 *
 * 背景（2026-10-05 排查）：opentui 0.5.6 吞掉帧回调异常
 * （chunk-node-ks0581vk.js:9794-9800）且 getStats() 无累计错误数，渲染异常对仓库侧
 * 完全不可见；帧率统计又只在 GYC_TUI_STATS=1 时开启且 10 分钟才写一条
 * （src/tui/app.tsx:593）。本模块提供有界采样，让「CPU 空转」与「渲染异常」可归因。
 *
 * 字段名说明：opentui 的 getStats() 返回 averageFrameTime（不是 avgFrameMs），
 * 映射到本模块自定的 RenderStatsSample.avgFrameMs 上，两版 0.5.6/0.5.14 一致。
 */

export interface RenderStatsSample {
  at: number
  fps: number
  frameCount: number
  avgFrameMs: number
}

export interface RenderTrend {
  fpsDelta: number
  avgFrameMsDelta: number
}

export interface RenderHealthOptions {
  /** 历史采样保留条数，默认 32 */
  capacity?: number
  now?: () => number
}

const DEFAULT_CAPACITY = 32

export class RenderHealthMonitor {
  private readonly capacity: number
  private readonly now: () => number
  private readonly samples: RenderStatsSample[] = []
  private errorCount = 0

  constructor(options: RenderHealthOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY)
    this.now = options.now ?? Date.now
  }

  push(stats: Omit<RenderStatsSample, "at">): void {
    this.samples.push({ at: this.now(), ...stats })
    if (this.samples.length > this.capacity) this.samples.shift()
  }

  history(): readonly RenderStatsSample[] {
    return this.samples
  }

  trend(): RenderTrend | undefined {
    if (this.samples.length < 2) return undefined
    const oldest = this.samples[0]!
    const newest = this.samples[this.samples.length - 1]!
    return {
      fpsDelta: newest.fps - oldest.fps,
      avgFrameMsDelta: newest.avgFrameMs - oldest.avgFrameMs,
    }
  }

  noteError(): void {
    this.errorCount += 1
  }

  errors(): number {
    return this.errorCount
  }

  reset(): void {
    this.samples.length = 0
    this.errorCount = 0
  }
}