/** Reads the entire stdin as UTF-8 text (Node-compatible replacement for Bun.stdin.text()). */
export function readStdin(): Promise<string> {
  // stdin 已 EOF（readableEnded）后，end 事件不会再次触发，直接返回空串，
  // 避免二次读取时永久挂起。
  if (process.stdin.readableEnded) return Promise.resolve("")
  return new Promise((resolve, reject) => {
    let data = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => (data += chunk))
    process.stdin.on("end", () => resolve(data))
    process.stdin.on("error", reject)
  })
}
