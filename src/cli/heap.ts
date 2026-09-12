import { readdirSync, rmSync } from "node:fs"
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
      // 滞回（hysteresis）：必须显著回落到阈值 75% 以下才重新武装，
      // 否则 RSS 在 1GB 附近锯齿震荡时会反复写 GB 级快照（硬盘+卡顿源）。
      if (stat.rss <= LIMIT * 0.75) armed = true
      return
    }
    if (!armed) return

    lock = true
    armed = false
    const file = path.join(
      Global.Path.log,
      `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
    )
    // 快照保留上限：写新快照前清理旧快照，连同新写的最多保留 2 个，
    // 防止长跑进程多次触发后 GB 级 .heapsnapshot 累积写满磁盘。
    try {
      const stale = readdirSync(Global.Path.log)
        .filter((name) => name.startsWith(`heap-${process.pid}-`) && name.endsWith(".heapsnapshot"))
        .sort()
      for (const name of stale.slice(0, Math.max(0, stale.length - 1))) {
        rmSync(path.join(Global.Path.log, name), { force: true })
      }
    } catch {
      // 旧快照清理失败不阻断本次快照写入，忽略
    }
    await Promise.resolve()
      .then(() => writeHeapSnapshot(file))
      .catch((error) => console.error(`[heap] 堆快照写入失败: ${String(error)}`))

    lock = false
  }

  timer = setInterval(() => {
    void run()
  }, MINUTE)
  timer.unref?.()
}

export function stop() {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}

export * as Heap from "./heap"
