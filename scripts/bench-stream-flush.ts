// 流式 delta 上屏延迟基准：旧方案（固定 30ms 攒批）vs 新方案（16ms 自适应调度）
// 对标口径：pi agent 从 message_update 到上屏最坏 ~16ms（pi-tui MIN_RENDER_INTERVAL_MS=16）。
// 本脚本只测"事件到达 → store 写"的调度延迟；渲染帧等待另计：
//   流式期间 targetFps=60 → 平均帧等待 8.3ms；旧 30fps → 平均 16.7ms。
// 运行：bun scripts/bench-stream-flush.ts
import { createDeltaFlushController, DELTA_FLUSH_MS } from "../src/tui/context/delta-flush"

type Sample = { arrival: number; flushed: number }

function benchFixedBatch(tokenIntervalsMs: number[], batchMs: number): Sample[] {
  const samples: Sample[] = []
  let pending = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    timer = undefined
    if (pending === 0) return
    const now = performance.now()
    for (let i = 0; i < pending; i++) samples[samples.length - pending + i].flushed = now
    pending = 0
  }
  let t = 0
  for (const interval of tokenIntervalsMs) {
    t += interval
    const arrival = t
    setTimeout(() => {
      pending++
      samples.push({ arrival: performance.now(), flushed: 0 })
      if (!timer) timer = setTimeout(flush, batchMs)
    }, arrival)
  }
  return samples
}

function benchAdaptive(tokenIntervalsMs: number[]): Sample[] {
  const samples: Sample[] = []
  const controller = createDeltaFlushController(() => {
    const now = performance.now()
    for (const s of samples) if (s.flushed === 0) s.flushed = now
  }, DELTA_FLUSH_MS)
  let t = 0
  for (const interval of tokenIntervalsMs) {
    t += interval
    setTimeout(() => {
      samples.push({ arrival: performance.now(), flushed: 0 })
      controller.schedule()
    }, t)
  }
  return samples
}

function tokens(count: number, intervalMs: number): number[] {
  return Array.from({ length: count }, () => intervalMs)
}

function report(name: string, samples: Sample[]) {
  const latencies = samples
    .map((s) => s.flushed - s.arrival)
    .filter((x) => Number.isFinite(x) && x >= 0)
    .toSorted((a, b) => a - b)
  if (latencies.length === 0) {
    console.log(`${name}: 无样本`)
    return
  }
  const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))]
  console.log(
    `${name}: n=${latencies.length} 平均=${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1)}ms p50=${p(0.5).toFixed(1)}ms p95=${p(0.95).toFixed(1)}ms 最大=${latencies[latencies.length - 1].toFixed(1)}ms`,
  )
}

async function main() {
  // 场景 1：涓流 50 token/s（真人对话典型速率）
  // 场景 2：洪泛 300 token/s（高速模型长回复）
  const scenarios = [
    { name: "涓流 50 t/s", intervals: tokens(60, 20) },
    { name: "洪泛 300 t/s", intervals: tokens(600, 3.33) },
  ]
  for (const scenario of scenarios) {
    console.log(`\n== ${scenario.name} ==`)
    const totalMs = scenario.intervals.reduce((a, b) => a + b, 0) + 100
    const oldSamples = benchFixedBatch(scenario.intervals, 30)
    await Bun.sleep(totalMs)
    report("旧 固定30ms攒批 ", oldSamples)
    const newSamples = benchAdaptive(scenario.intervals)
    await Bun.sleep(totalMs)
    report("新 自适应16ms   ", newSamples)
  }
  console.log("\n注：上屏总延迟 = 调度延迟 + 帧等待（流式期间 60fps 平均 8.3ms；pi 口径 ~16ms 最坏）")
}

void main()
