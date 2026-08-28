import * as pty from "@lydell/node-pty"
import type { Opts, Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  // 注意：@lydell/node-pty v1.x 的 Windows 实现已默认使用 ConPTY，
  // 且 IWindowsPtyForkOptions 不再支持旧版 node-pty 的 useConptyDll 选项——
  // 传入该未知选项会导致 spawn 报 ERROR_INVALID_PARAMETER(87)（PTY 一直 500）。
  const proc = pty.spawn(file, args, {
    ...opts,
  })
  return {
    pid: proc.pid,
    onData(listener) {
      return proc.onData(listener)
    },
    onExit(listener) {
      return proc.onExit(listener)
    },
    write(data) {
      proc.write(data)
    },
    resize(cols, rows) {
      proc.resize(cols, rows)
    },
    kill(signal) {
      try {
        proc.kill(signal)
      } catch {
        // 进程已退出或权限不足，幂等视为成功
      }
    },
  }
}
