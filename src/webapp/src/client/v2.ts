import { createGyccodeClient as createV2Client } from "@gyccode/protocol/v2"

// v2 客户端：提供 switchAgent / switchModel / compact 等 v1 缺失的服务端能力（浏览器同栈）
export function v2(directory?: string) {
  return createV2Client({ baseUrl: "", directory })
}
