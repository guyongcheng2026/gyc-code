/** @jsxImportSource solid-js */
import { registerCustomTheme } from "@pierre/diffs"
import { GycCodeTheme } from "./marked-theme"

let registered = false

export function registerGycCodeTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("GycCode", () => Promise.resolve(GycCodeTheme))
}
