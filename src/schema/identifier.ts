const length = 26
const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastTimestamp = 0
let counter = 0

export function ascending() {
  return create(false)
}

export function descending() {
  return create(true)
}

export function create(descending: boolean, timestamp = Date.now()) {
  // 同毫秒内最多 4096 个 ID（12bit 计数器空间）。超限时进位到下一毫秒，
  // 保证 timestamp() 反解出的毫秒值始终单调（不随 counter 溢出污染时间字段）。
  if (timestamp > lastTimestamp) {
    lastTimestamp = timestamp
    counter = 0
  }
  counter++
  if (counter > 0xfff) {
    counter = 0
    lastTimestamp++
  }

  const current = BigInt(lastTimestamp) * 0x1000n + BigInt(counter)
  const value = descending ? ~current : current
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("")
  const bytes = crypto.getRandomValues(new Uint8Array(length - 12))
  // 拒绝采样：256 % 62 = 8，丢弃 [248, 256) 的字节以消除模偏差
  return (
    time +
    Array.from(bytes, (byte) => {
      while (byte >= 248) byte = crypto.getRandomValues(new Uint8Array(1))[0]!
      return chars[byte % 62]
    }).join("")
  )
}
