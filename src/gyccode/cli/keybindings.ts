export interface Keybinding {
  key: string
  action: string
  description: string
  mode: "normal" | "insert" | "visual"
}

export const VIM_KEYBINDINGS: readonly Keybinding[] = [
  // Navigation
  { key: "h", action: "cursor.left", description: "Move cursor left", mode: "normal" },
  { key: "j", action: "cursor.down", description: "Move cursor down", mode: "normal" },
  { key: "k", action: "cursor.up", description: "Move cursor up", mode: "normal" },
  { key: "l", action: "cursor.right", description: "Move cursor right", mode: "normal" },
  { key: "w", action: "cursor.nextWord", description: "Jump to next word", mode: "normal" },
  { key: "b", action: "cursor.prevWord", description: "Jump to previous word", mode: "normal" },
  { key: "0", action: "cursor.lineStart", description: "Go to line start", mode: "normal" },
  { key: "$", action: "cursor.lineEnd", description: "Go to line end", mode: "normal" },
  { key: "gg", action: "cursor.fileStart", description: "Go to file start", mode: "normal" },
  { key: "G", action: "cursor.fileEnd", description: "Go to file end", mode: "normal" },

  // Editing
  { key: "dd", action: "editor.deleteLine", description: "Delete current line", mode: "normal" },
  { key: "yy", action: "editor.yankLine", description: "Yank (copy) current line", mode: "normal" },
  { key: "p", action: "editor.pasteAfter", description: "Paste after cursor", mode: "normal" },
  { key: "P", action: "editor.pasteBefore", description: "Paste before cursor", mode: "normal" },
  { key: "u", action: "editor.undo", description: "Undo", mode: "normal" },
  { key: "x", action: "editor.deleteChar", description: "Delete character", mode: "normal" },

  // Mode switching
  { key: "i", action: "mode.insert", description: "Enter insert mode", mode: "normal" },
  { key: "v", action: "mode.visual", description: "Enter visual mode", mode: "normal" },
  { key: "Escape", action: "mode.normal", description: "Enter normal mode", mode: "insert" },
  { key: "Escape", action: "mode.normal", description: "Enter normal mode", mode: "visual" },
]

export const EMOJI_KEYBINDINGS: readonly Keybinding[] = [
  { key: "ctrl+c", action: "editor.copy", description: "Copy", mode: "normal" },
  { key: "ctrl+v", action: "editor.paste", description: "Paste", mode: "normal" },
  { key: "ctrl+z", action: "editor.undo", description: "Undo", mode: "normal" },
  { key: "ctrl+y", action: "editor.redo", description: "Redo", mode: "normal" },
  { key: "ctrl+a", action: "editor.selectAll", description: "Select all", mode: "normal" },
  { key: "ctrl+f", action: "editor.find", description: "Find", mode: "normal" },
  { key: "ctrl+s", action: "editor.save", description: "Save", mode: "normal" },
]

export class KeybindingManager {
  private bindings: Keybinding[] = [...VIM_KEYBINDINGS, ...EMOJI_KEYBINDINGS]
  private currentMode: "normal" | "insert" | "visual" = "normal"

  getMode(): "normal" | "insert" | "visual" {
    return this.currentMode
  }

  setMode(mode: "normal" | "insert" | "visual"): void {
    this.currentMode = mode
  }

  resolve(key: string): string | undefined {
    const binding = this.bindings.find(b => b.key === key && b.mode === this.currentMode)
    if (binding?.action.startsWith("mode.")) {
      const newMode = binding.action.split(".")[1] as "normal" | "insert" | "visual"
      this.setMode(newMode)
    }
    return binding?.action
  }

  addBinding(binding: Keybinding): void {
    this.bindings.push(binding)
  }

  removeBinding(key: string, mode: "normal" | "insert" | "visual"): void {
    this.bindings = this.bindings.filter(b => !(b.key === key && b.mode === mode))
  }

  getBindings(): readonly Keybinding[] {
    return this.bindings
  }

  switchStyle(toStyle: "vim" | "emacs"): void {
    if (toStyle === "vim") {
      this.bindings = [...VIM_KEYBINDINGS, ...EMOJI_KEYBINDINGS]
    } else {
      this.bindings = [...EMOJI_KEYBINDINGS]
    }
  }
}
