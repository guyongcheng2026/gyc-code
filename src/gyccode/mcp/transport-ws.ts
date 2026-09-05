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
      const socket = new WebSocket(url, { headers: this.options.headers, protocol: "mcp" })
      this.socket = socket
      const timer = this.options.timeout
        ? setTimeout(() => {
            socket.terminate()
            reject(new Error(`WebSocket connect timed out: ${url}`))
          }, this.options.timeout)
        : undefined
      socket.once("open", () => {
        if (timer) clearTimeout(timer)
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
      socket.once("close", () => resolve())
      socket.on("error", () => {})
      socket.close()
    })
  }

  private handleMessage(text: string) {
    this.onMessage?.(text)
    try {
      this.onmessage?.(JSON.parse(text) as JSONRPCMessage)
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

export * as McpWS from "./transport-ws"