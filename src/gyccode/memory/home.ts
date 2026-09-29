// 记忆家目录解析。实现下沉到 @core/global/gyc-home（core 是更底层包，
// 凭据加密 dpapi.ts 等同层模块共用同一套解析，避免再次出现多份拷贝发散），
// 此处仅做语义别名。
import { gycHome, legacyHome } from "@core/global/gyc-home"

/** 记忆家目录：$GYCCODE_MEMORY_HOME，或 ~/.gyc。 */
export function gycMemoryHome(): string {
  return gycHome()
}

/** 旧版家目录，仅供一次性数据迁移探测，不参与默认路径解析。 */
export function legacyMemoryHome(): string | undefined {
  return legacyHome()
}
