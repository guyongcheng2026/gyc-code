import { useCallback } from "react"
import { sdk } from "./sdk"

// 创建 PTY：POST /pty，返回 pty id。command 为空时用默认 shell。
export function usePty(directory?: string) {
  const create = useCallback(
    async (command?: string, cwd?: string) => {
      const res = await sdk(directory).pty.create({ body: { command, cwd } })
      return (res.data as { id: string }).id
    },
    [directory],
  )

  const updateSize = useCallback(
    async (ptyID: string, cols: number, rows: number) => {
      await sdk(directory).pty.update({ path: { id: ptyID }, body: { size: { cols, rows } } })
    },
    [directory],
  )

  const remove = useCallback(
    async (ptyID: string) => {
      await sdk(directory).pty.remove({ path: { id: ptyID } })
    },
    [directory],
  )

  return { create, updateSize, remove }
}

export type PtyHandlers = { onData: (text: string) => void; onClose?: () => void }

export type PtyConnection = {
  send: (text: string) => void
  disconnect: () => void
}

// 建立到 /pty/{id}/connect 的 WebSocket。协议：
// - 出站（server→client）：raw UTF-8 终端文本；首个字节为 0x00 的二进制帧是元帧（cursor），跳过。
// - 入站（client→server）：raw UTF-8 文本（xterm 输入直发）。
export function connectPty(ptyID: string, handlers: PtyHandlers): PtyConnection {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  const ws = new WebSocket(`${proto}//${window.location.host}/pty/${ptyID}/connect?cursor=-1`)
  ws.binaryType = "arraybuffer"

  ws.onmessage = (ev) => {
    const data: unknown = ev.data
    if (typeof data === "string") {
      handlers.onData(data)
      return
    }
    const bytes = new Uint8Array(data as ArrayBuffer)
    if (bytes.length > 0 && bytes[0] === 0) return // 元帧 {cursor}，客户端无需处理
    handlers.onData(new TextDecoder().decode(bytes))
  }
  ws.onclose = () => handlers.onClose?.()

  return {
    send: (text: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(text)
    },
    disconnect: () => {
      try {
        ws.close()
      } catch {
        // 忽略关闭异常
      }
    },
  }
}
