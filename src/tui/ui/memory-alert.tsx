import { createEffect, createSignal } from "solid-js"
import { useToast } from "./toast"
import { buildMemoryAlertMessage, type MemoryAlertPayload } from "../util/memory-alert"

/**
 * 内存压力提示通道：app.tsx 的内存守护（Effect/meter 作用域，无法访问
 * ToastProvider 上下文）通过 publishMemoryAlert 发布；ToastProvider 内的
 * <MemoryAlertToast /> 订阅并展示。模块级信号是 Solid 允许的用法
 * （信号创建不依赖组件 owner；仅不自动 dispose，本场景为进程级单例）。
 */

const [memoryAlert, setMemoryAlert] = createSignal<MemoryAlertPayload | null>(null)

/** 供内存守护（任意作用域）发布提示。 */
export function publishMemoryAlert(payload: MemoryAlertPayload): void {
  setMemoryAlert(payload)
}

/** 仅供测试：清空信号。 */
export function resetMemoryAlertForTest(): void {
  setMemoryAlert(null)
}

/** 必须挂载在 ToastProvider 内。 */
export function MemoryAlertToast() {
  const toast = useToast()
  createEffect(() => {
    const alert = memoryAlert()
    if (!alert) return
    const { title, message, variant } = buildMemoryAlertMessage(alert)
    toast.show({ title, message, variant, duration: 10_000 })
  })
  return null
}
