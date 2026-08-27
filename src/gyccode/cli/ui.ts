import { EOL } from "os"
import { Schema } from "effect"
import { logo as glyphs } from "./logo"
import { TokyoNight, Typography } from "./theme"

const wordmark = [
  `                                         `,
  `█▀▀▀█ █   █ █▀▀▀▀ █▀▀▀▀ █▀▀▀█ █▀▀▀█ █▀▀▀▀`,
  `█▀▀   ▀▀█▀▀ █     █     █   █ █   █ █▀▀▀▀`,
  `█▄▄▄█   █   █▄▄▄▄ █▄▄▄▄ █▄▄▄█ █▄▄▄▄ █▄▄▄▄`,
]

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("UICancelledError", {}) {}

// 样式常量全部取自"东京夜"主题（对齐 gyc tui：src/tui/theme/assets/tokyonight.json）
// TEXT_NORMAL 语义为"恢复正文样式"：重置修饰并回到主题正文色
export const Style = {
  TEXT_HIGHLIGHT: TokyoNight.primary,
  TEXT_HIGHLIGHT_BOLD: TokyoNight.primary + Typography.bold,
  TEXT_DIM: TokyoNight.textMuted,
  TEXT_DIM_BOLD: TokyoNight.textMuted + Typography.bold,
  TEXT_NORMAL: Typography.reset + TokyoNight.text,
  TEXT_NORMAL_BOLD: TokyoNight.text + Typography.bold,
  TEXT_WARNING: TokyoNight.warning,
  TEXT_WARNING_BOLD: TokyoNight.warning + Typography.bold,
  TEXT_DANGER: TokyoNight.error,
  TEXT_DANGER_BOLD: TokyoNight.error + Typography.bold,
  TEXT_SUCCESS: TokyoNight.success,
  TEXT_SUCCESS_BOLD: TokyoNight.success + Typography.bold,
  TEXT_INFO: TokyoNight.info,
  TEXT_INFO_BOLD: TokyoNight.info + Typography.bold,
}

export function println(...message: string[]) {
  print(...message)
  process.stderr.write(EOL)
}

export function print(...message: string[]) {
  blank = false
  process.stderr.write(message.join(" "))
}

let blank = false
export function empty() {
  if (blank) return
  println("" + Style.TEXT_NORMAL)
  blank = true
}

export function logo(pad?: string) {
  if (!process.stdout.isTTY && !process.stderr.isTTY) {
    const result = []
    for (const row of wordmark) {
      if (pad) result.push(pad)
      result.push(row)
      result.push(EOL)
    }
    return result.join("").trimEnd()
  }

  const result: string[] = []
  const reset = "\x1b[0m"
  const left = {
    fg: reset,
    shadow: "\x1b[38;5;238m",
    bg: "\x1b[48;5;238m",
  }
  const right = {
    fg: reset,
    shadow: "\x1b[38;5;238m",
    bg: "\x1b[48;5;238m",
  }
  const gap = " "
  const draw = (line: string, fg: string, shadow: string, bg: string) => {
    const parts: string[] = []
    for (const char of line) {
      if (char === "_") {
        parts.push(bg, " ", reset)
        continue
      }
      if (char === "^") {
        parts.push(fg, bg, "▀", reset)
        continue
      }
      if (char === "~") {
        parts.push(shadow, "▀", reset)
        continue
      }
      if (char === " ") {
        parts.push(" ")
        continue
      }
      parts.push(fg, char, reset)
    }
    return parts.join("")
  }
  glyphs.left.forEach((row, index) => {
    if (pad) result.push(pad)
    result.push(draw(row, left.fg, left.shadow, left.bg))
    result.push(gap)
    const other = glyphs.right[index] ?? ""
    result.push(draw(other, right.fg, right.shadow, right.bg))
    result.push(EOL)
  })
  return result.join("").trimEnd()
}

export async function input(prompt: string): Promise<string> {
  const readline = require("readline")
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export function error(message: string) {
  if (message.startsWith("Error: ")) {
    message = message.slice("Error: ".length)
  }
  println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
}

export function markdown(text: string): string {
  return text
}

export * as UI from "./ui"
