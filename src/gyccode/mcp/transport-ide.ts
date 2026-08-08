import { Effect } from "effect"

export interface IDETransportConfig {
  editor: "vscode" | "jetbrains" | "cursor"
  port: number
  extensionId: string
}

export class IDETransport {
  constructor(private config: IDETransportConfig) {}

  connect(): Effect.Effect<void, never> {
    return Effect.sync(() => {
      // IDE transport connects via local extension IPC
      // Stub for future VS Code / JetBrains extension integration
    })
  }

  disconnect(): Effect.Effect<void, never> {
    return Effect.sync(() => {
      // Cleanup IDE connection
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