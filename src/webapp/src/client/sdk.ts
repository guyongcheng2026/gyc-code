import { createGyccodeClient } from "@gyccode/protocol/v1"

// 同源访问（页面由 gyc server 托管）；跨源场景可用 baseUrl 指向远程 server。
export function sdk(directory?: string) {
  return createGyccodeClient({ baseUrl: "", directory })
}
