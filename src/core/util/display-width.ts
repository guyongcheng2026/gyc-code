import stringWidth from "string-width"

/** Display width of a string (CJK/emoji count as 2), Bun.stringWidth-compatible. */
export const displayWidth = (s: string): number => stringWidth(s)
