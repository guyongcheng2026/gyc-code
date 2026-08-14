import path from "path"
import { writeHeapSnapshot } from "node:v8"
import { Flag } from "@gyccode/core/flag/flag"
import { Global } from "@gyccode/core/global"
const MINUTE = 60_000
const LIMIT = 1024 * 1024 * 1024 // 1 GiB 常驻基线：超过即记录堆快照

let timer: Timer | undefined
let lock = false
let armed = true

export function start() {
  if (!Flag.GYCCODE_AUTO_HEAP_SNAPSHOT) return
  if (timer) return

  const run = async () => {
    if (lock) return

    const stat = process.memoryUsage()
    if (stat.rss <= LIMIT) {
      armed = true
      return
    }
    if (!armed) return

    lock = true
    armed = false
    const file = path.join(
      Global.Path.log,
      `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
    )
    await Promise.resolve()
      .then(() => writeHeapSnapshot(file))
      .catch(() => {})

    lock = false
  }

  timer = setInterval(() => {
    void run()
  }, MINUTE)
  timer.unref?.()
}

export * as Heap from "./heap"
