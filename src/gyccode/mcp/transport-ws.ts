import WebSocket from "ws"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"

export interface WSTransportOptions {
  url?: string
  headers?: Record<string, string>
  timeout?: number
}

/**
 * Minimal WebSocket transport for MCP endpoints (ws:// or wss://).
 * Exposes connect(url) / send(message) / close() / onMessage, and also
 * implements the MCP SDK Transport interface so it can be passed to
 * `client.connect(...)`.
 */
export class WSTransport implements Transport {
  onMessage: ((message: string) => void) | undefined
  onmessage: ((message: JSONRPCMessage) => void) | undefined
  onerror: ((error: Error) => void) | undefined
  onclose: (() => void) | undefined

  private socket: WebSocket | undefined
  private url: string | undefined

  constructor(private options: WSTransportOptions = {}) {
    // 允许在构造期注入 url（SDK 的 Client.connect 只会调用 start()，不会调用 connect(url)）。
    // 若未注入，调用方可先显式 connect(url) 再交给 SDK。
    if (options.url) this.url = options.url
  }

  connect(url: string): Promise<void> {
    this.url = url
    return this.start()
  }

  start(): Promise<void> {
    if (this.socket) return Promise.resolve()
    const url = this.url
    if (!url) return Promise.reject(new Error("WSTransport: connect(url) must be called before start()"))
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: this.options.headers,
        protocol: "mcp",
        // 入帧上限：缺少它时一个超大帧就能把进程内存撑爆（对端异常或恶意）。
        maxPayload: 1024 * 1024,
      })
      const timer = this.options.timeout
        ? setTimeout(() => {
            // P2 修复：terminate 失败时记录日志而非静默忽略
            try {
              socket.terminate()
            } catch (err) {
              console.error("WebSocket terminate failed:", err)
            }
            // 超时后必须摘掉监听：否则重连时旧 socket 的 close 仍会触发 onclose，
            // 把新建立的连接误标为已关闭。error 需留一个空监听，避免 uncaught。
            socket.removeAllListeners()
            socket.on("error", () => {})
            reject(new Error(`WebSocket connect timed out: ${url}`))
          }, this.options.timeout)
        : undefined
      socket.once("open", () => {
        if (timer) clearTimeout(timer)
        // P0 修复：socket 赋值在连接打开后进行，避免竞态
        this.socket = socket
        resolve()
      })
      socket.once("error", (error) => {
        if (timer) clearTimeout(timer)
        const wrapped = error instanceof Error ? error : new Error(String(error))
        this.onerror?.(wrapped)
        reject(wrapped)
      })
      socket.on("message", (data) => this.handleMessage(data.toString()))
      socket.on("close", () => this.onclose?.())
    })
  }

  send(message: string | JSONRPCMessage): Promise<void> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("WSTransport: not connected"))
    }
    const payload = typeof message === "string" ? message : JSON.stringify(message)
    return new Promise((resolve, reject) => {
      socket.send(payload, (error) => (error ? reject(error) : resolve()))
    })
  }

  close(): Promise<void> {
    const socket = this.socket
    this.socket = undefined
    if (!socket || socket.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve()
      }
      timer = setTimeout(() => {
        // close 帧可能永远收不到（对端挂起）：兜底 terminate 并结束等待。
        try {
          socket.terminate()
        } catch {}
        done()
      }, 1000)
      socket.once("close", done)
      // P0 修复：使用 once 而非 on，避免监听器累积
      socket.once("error", () => {}) // 忽略关闭时的错误
      socket.close()
    })
  }

  private handleMessage(text: string) {
    this.onMessage?.(text)
    let parsed: JSONRPCMessage
    try {
      parsed = JSON.parse(text) as JSONRPCMessage
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)))
      // 畸形帧只回调 onerror 会让请求方永久挂起（连接既不关也不回帧）：
      // 回一个 JSON-RPC ParseError 后按协议用 1007 关闭。
      try {
        this.socket?.send(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }))
      } catch {}
      this.socket?.close(1007, "invalid frame payload")
      return
    }
    this.onmessage?.(parsed)
  }
}

export * as McpWS from "./transport-ws"