import { createServer, type Server } from "node:http"
import { Effect } from "effect"

export interface IDETransportConfig {
  editor: "vscode" | "jetbrains" | "cursor"
  port: number
  extensionId: string
}

export class IDETransport {
  private server: Server | undefined

  constructor(private config: IDETransportConfig) {}

  /**
   * Start a lightweight local HTTP listener on the configured port that the
   * IDE extension can connect to. Returns the server handle; callers own the
   * handle and must clean it up via disconnect().
   */
  connect(): Effect.Effect<Server, Error> {
    return Effect.tryPromise(() => this.start())
  }

  disconnect(): Effect.Effect<void, Error> {
    return Effect.tryPromise(() => this.stop())
  }

  getServer(): Server | undefined {
    return this.server
  }

  private start(): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.url === "/health") {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify({ ok: true, extensionId: this.config.extensionId }))
          return
        }
        res.writeHead(200, { "content-type": "text/plain" })
        res.end("gyccode IDE transport")
      })
      server.once("error", reject)
      server.listen(this.config.port, "127.0.0.1", () => {
        this.server = server
        resolve(server)
      })
    })
  }

  private stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.server
      this.server = undefined
      if (!server) {
        resolve()
        return
      }
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  getEditorCommand(tool: string, args: Record<string, unknown>): string {
    switch (this.config.editor) {
      case "vscode":
        return `code --goto "${args.file}:${args.line}:${args.column}"`
      case "jetbrains":
        return `idea --line ${args.line} "${args.file}"`
      case "cursor":
        return `cursor --goto "${args.file}:${args.line}"`
      default:
        return `editor "${args.file}"`
    }
  }
}
