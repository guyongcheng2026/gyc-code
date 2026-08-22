import { describe, expect, it } from "bun:test"
import { displayWidth } from "./display-width"

const CJK = "\u4e2d\u6587" // "中文"
const FULLWIDTH = "\uff01" // "！"
const cases = ["", "abc", CJK, CJK + " a", "\u{1F680}", "\x1b[31mred\x1b[0m", "a\tb", FULLWIDTH]

describe("displayWidth", () => {
  it("matches Bun.stringWidth on representative inputs", () => {
    for (const s of cases) {
      expect(displayWidth(s), JSON.stringify(s)).toBe(Bun.stringWidth(s))
    }
  })
})
