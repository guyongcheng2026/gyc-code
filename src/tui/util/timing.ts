// gyc tui 启动链路计时打点：GYCCODE_TUI_TIMING=1 时向 stderr 输出各阶段
// 绝对墙钟毫秒（epoch ms），用于与 gyccode.log / 启动探针对齐分析。
// 默认完全关闭：单次布尔判断 + 早退，无 IO 开销，不影响启动性能。
// 注意：绝不写 stdout——OpenTUI 渲染通道独占 stdout。

const enabled = process.env.GYCCODE_TUI_TIMING === "1"

export function tuiTiming(phase: string) {
  if (!enabled) return
  try {
    process.stderr.write(`[tui-timing] ${Date.now()} ${phase}\n`)
  } catch {
    // stderr 不可用时静默放弃：诊断设施不得引入新故障路径
  }
}
