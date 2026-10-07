/**
 * 渲染健康度采集：帧时趋势 + 渲染错误计数与限频。
 *
 * 背景（2026-10-05 排查）：opentui 0.5.6 吞掉帧回调异常
 * （chunk-node-ks0581vk.js:9794-9800）且 getStats() 无累计错误数，渲染异常对仓库侧
 * 完全不可见；帧率统计又只在 GYC_TUI_STATS=1 时开启且 10 分钟才写一条
 * （src/tui/app.tsx:593）。本模块提供有界采样，让「CPU 空转」与「渲染异常」可归因。
 *
 * 0.5.14 起渲染循环改为 emit render:error 并按帧重试
 * （chunk-node-wp7ct2m6.js:10160-10174），流式期 60fps 即 60 次/秒。若逐条落库，
 * 一小时可写 20 万行（message 存完整 stack）。故本模块同时承担限频与突发熔断：
 * 计数保持精确（内存内零成本），落库按错误键限频，持续失败则交给调用方降级。
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
  /** 同一错误键的落库限频窗口，默认 60_000ms */
  errorLogWindowMs?: number
  /** 限频表容量上限，默认 32 */
  errorKeyLimit?: number
  /** 突发熔断阈值：窗口内错误条数达到即降级，默认 30 */
  errorBurstThreshold?: number
  /** 突发检测窗口，默认 60_000ms */
  errorBurstWindowMs?: number
}

const DEFAULT_CAPACITY = 32
const DEFAULT_ERROR_LOG_WINDOW_MS = 60_000
const DEFAULT_ERROR_KEY_LIMIT = 32
const DEFAULT_ERROR_BURST_THRESHOLD = 30
const DEFAULT_ERROR_BURST_WINDOW_MS = 60_000

export class RenderHealthMonitor {
  private readonly capacity: number
  private readonly now: () => number
  private readonly samples: RenderStatsSample[] = []
  private errorCount = 0
  private readonly errorLogWindowMs: number
  private readonly errorKeyLimit: number
  private readonly errorBurstThreshold: number
  private readonly errorBurstWindowMs: number
  /** 限频表：键 → 上次放行时刻。按插入序淘汰，与 logging.ts 的 lineThrottle 同策略。 */
  private readonly errorLogAt = new Map<string, number>()
  private suppressed = 0
  /** 突发检测只需知道「窗口内是否达到阈值」，故最多保留 threshold 个最近时刻。 */
  private errorStamps: number[] = []

  constructor(options: RenderHealthOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY)
    this.now = options.now ?? Date.now
    this.errorLogWindowMs = options.errorLogWindowMs ?? DEFAULT_ERROR_LOG_WINDOW_MS
    this.errorKeyLimit = Math.max(1, options.errorKeyLimit ?? DEFAULT_ERROR_KEY_LIMIT)
    this.errorBurstThreshold = Math.max(1, options.errorBurstThreshold ?? DEFAULT_ERROR_BURST_THRESHOLD)
    this.errorBurstWindowMs = options.errorBurstWindowMs ?? DEFAULT_ERROR_BURST_WINDOW_MS
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
    this.errorStamps.push(this.now())
    // 只保留达到阈值所需的最近若干条，天然有界。
    while (this.errorStamps.length > this.errorBurstThreshold) this.errorStamps.shift()
  }

  errors(): number {
    return this.errorCount
  }

  /**
   * 渲染错误落库限频：同一键在窗口内只放行一条，其余只累加 suppressed 计数。
   *
   * 为什么需要：opentui 的渲染循环在抛错后会按帧重试
   * （chunk-node-wp7ct2m6.js:10171-10174），流式期 60fps 即 60 次/秒。
   * 每条都走 logError → error_audit 表（error-audit.ts:49-70，message 存完整
   * stack），一小时可写入 20 万行、数百 MB。限频把量级压到每分钟 1 条，
   * 而 errors() 的精确计数不受影响，诊断信号不丢。
   */
  shouldLogError(key: string): boolean {
    const now = this.now()
    const last = this.errorLogAt.get(key)
    if (last !== undefined && now - last < this.errorLogWindowMs) {
      this.suppressed += 1
      return false
    }
    if (this.errorLogAt.size >= this.errorKeyLimit) {
      const oldest = this.errorLogAt.keys().next().value
      if (oldest !== undefined) this.errorLogAt.delete(oldest)
    }
    this.errorLogAt.set(key, now)
    return true
  }

  /** 自上次落库以来累计被抑制的条数；放行时读它，即为日志行的 suppressed=N。 */
  suppressedErrors(): number {
    return this.suppressed
  }

  /** 限频表当前条目数（供测试与诊断确认长跑有界）。 */
  trackedErrorKeys(): number {
    return this.errorLogAt.size
  }

  /**
   * 渲染错误是否已达突发阈值（应熔断降级）。
   *
   * 为什么需要熔断而不只是限频：若某个 renderable 持续抛错，限频后日志不再刷屏，
   * 但 opentui 仍会每帧重试、界面依然不可用。阈值取 30 条 / 60s——60fps 下约半秒、
   * plain 终端 10fps 下约 3 秒，足以排除零星抖动，又不会让真正卡死的界面苟活。
   */
  exceedsBurstThreshold(): boolean {
    const cutoff = this.now() - this.errorBurstWindowMs
    return this.errorStamps.filter((at) => at >= cutoff).length >= this.errorBurstThreshold
  }

  reset(): void {
    this.samples.length = 0
    this.errorCount = 0
    this.errorLogAt.clear()
    this.errorStamps = []
    this.suppressed = 0
  }
}