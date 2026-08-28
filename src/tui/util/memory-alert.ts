/**
 * 内存不足用户提示（纯逻辑，便于测试）。
 *
 * 背景（2026-08-28）：4GB 低内存机器上 gyc tui 常驻 450-800MB，系统可用内存
 * 常在 100-250MB 徘徊；此前内存压力仅写日志，用户对「运行几分钟后退回终端」
 * 没有事前感知。本模块在内存守护（app.tsx meter）检测到压力时生成面向用户的
 * 提示，建议关闭与 gyc tui 无关的进程释放内存。
 *
 * 级别：startup（启动期偏低）/ critical（进入紧张带）/ severe（即将致命）。
 */

export type MemoryAlertLevel = "startup" | "critical" | "severe"

export interface MemoryAlertPayload {
  level: MemoryAlertLevel
  rssMB: number
  totalMB: number
  freeMB: number
  streak?: number
}

export interface MemoryAlertMessage {
  title: string
  message: string
  variant: "info" | "success" | "warning" | "error"
}

const CLOSE_HINT = "建议关闭与 gyc tui 无关的程序（浏览器、大型 IDE、视频播放器等）释放内存。"

export function buildMemoryAlertMessage(input: MemoryAlertPayload): MemoryAlertMessage {
  const { level, rssMB, freeMB, totalMB, streak } = input
  switch (level) {
    case "startup":
      return {
        title: "启动时系统内存偏低",
        variant: "warning",
        message: `gyc tui 启动时系统可用内存仅约 ${freeMB}MB（共 ${totalMB}MB）。为保证运行稳定，${CLOSE_HINT}`,
      }
    case "severe":
      return {
        title: "可用内存极低",
        variant: "error",
        message: `系统可用内存仅约 ${freeMB}MB（gyc tui 已用 ${rssMB}MB${streak ? `，连续 ${streak} 轮确认` : ""}），随时可能中断。请立即${CLOSE_HINT}`,
      }
    case "critical":
      return {
        title: "系统内存紧张",
        variant: "warning",
        message: `系统可用内存约 ${freeMB}MB，gyc tui 已用 ${rssMB}MB（共 ${totalMB}MB）。为保障持续稳定运行，${CLOSE_HINT}`,
      }
  }
}

/** 冷却期内不重复提示（同级别），首次提示立即放行。 */
export function shouldEmitMemoryAlert(lastShownAt: number, now: number, cooldownMs: number): boolean {
  if (lastShownAt === 0) return true
  return now - lastShownAt >= cooldownMs
}
