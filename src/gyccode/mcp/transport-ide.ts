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
    const file = stringArg(args.file)
    const line = intArg(args.line, 1)
    const column = intArg(args.column, 1)
    switch (this.config.editor) {
      case "vscode":
        return `code --goto ${shellQuote(`${file}:${line}:${column}`)}`
      case "jetbrains":
        return `idea --line ${line} ${shellQuote(file)}`
      case "cursor":
        return `cursor --goto ${shellQuote(`${file}:${line}`)}`
      default:
        return `editor ${shellQuote(file)}`
    }
  }
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "")
}

/** Coerce an unknown line/column value to a positive integer (safe fallback). */
function intArg(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback
}

/** POSIX single-quote shell escaping: everything literal except embedded single quotes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
