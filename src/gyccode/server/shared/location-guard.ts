// HTTP 层请求指定的目录白名单校验（等保三级 · 访问控制）。
//
// 独立成模块的理由：这套判定是纯函数、无 Effect 依赖，抽出后即可被单测直接覆盖；
// 放在 location.ts 里会与 Location 业务类型耦合，测试只能走 HTTP 层间接验证。
import { realpathSync } from "node:fs"
import { resolve, sep } from "node:path"

/**
 * 目录白名单（等保三级 · 访问控制）。
 *
 * x-gyccode-directory / location[directory] 由请求方直接指定，若不设限，
 * 任何持凭据的调用方都能把服务端的项目根指向任意绝对路径，配合 file/pty
 * 组接口实现跨项目读写——等于把服务端变成任意文件读写代理。
 *
 * 规则：
 *   - 规范化并 realpath 解析，消解 ../ 与符号链接，阻断路径穿越；
 *   - 必须落在 GYCCODE_SERVER_ROOTS（多根用 ; 或 , 分隔）之内；
 *   - 未配置白名单时原样放行（单用户本机开发的既有行为，不扩大暴露面）。
 */
export function guardDirectory(input: string) {
  const roots = resolveRoots()
  if (roots.length === 0) return input

  const resolved = realpathSafe(resolve(input))
  // 前缀匹配必须卡在路径分隔符边界上：直接 startsWith 会让白名单
  // C:\work\proj 错误放行相邻目录 C:\work\project-secret，构成穿越。
  const permitted = roots.some(
    (root) => resolved === root || resolved.startsWith(root.endsWith(sep) ? root : root + sep),
  )
  if (permitted) return resolved

  throw new Error(`directory not permitted: ${resolved} is outside GYCCODE_SERVER_ROOTS (${roots.join(", ")})`)
}

/** 解析并 realpath 规范化；路径不存在时退回 resolve 结果（新建目录场景）。 */
function realpathSafe(target: string) {
  try {
    return realpathSync(target)
  } catch {
    return resolve(target)
  }
}

function resolveRoots(): string[] {
  const configured = process.env.GYCCODE_SERVER_ROOTS
  if (configured === undefined || configured.trim().length === 0) return []
  return configured
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => realpathSafe(resolve(entry)))
}
