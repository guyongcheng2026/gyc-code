/**
 * 正则编译缓存。
 *
 * 背景（2026-10-05 排查）：按键别名展开（src/tui/keymap.tsx:119-126，每次按键
 * 编译 4 个正则）与 i18n 插值（src/tui/fallback/i18n.ts:67，每个参数一个正则）
 * 都是高频路径，每次调用都 new RegExp，在长按与流式期累积成可观开销。
 *
 * 两处的 pattern 虽由模板拼接而来，但取值集合是静态小集：
 *  - keymap 的别名固定为 KEY_ALIASES 的 4 个字面量，命中率恒为 100%；
 *  - i18n 的占位符键来自文案，实际只用十几个，重复率高。
 *
 * 上限 256 条，超出后整表清空：这些 pattern 集合本身很小，全量清空不会造成抖动，
 * 而逐条 LRU 淘汰的 bookkeeping 反而比重编译更贵。
 */

/** 缓存条目上限；超出即整表清空。 */
const CACHE_LIMIT = 256

const store = new Map<string, RegExp>()

export interface CachedRegex {
  (pattern: string, flags?: string): RegExp
  cacheSize(): number
  readonly CACHE_LIMIT: number
}

export const cachedRegex = ((pattern: string, flags = ""): RegExp => {
  // 用 \u0000 作分隔符：pattern 与 flags 都是用户可控制的字符串，
  // 单纯拼接会产生 "g" + "a" 与 "ga" + "" 撞车的情况。
  const key = `${flags}\u0000${pattern}`
  const hit = store.get(key)
  if (hit) {
    // /g 与 /y 的 lastIndex 是跨调用残留的有状态，不复位会让第二次匹配起于旧位置。
    hit.lastIndex = 0
    return hit
  }
  const compiled = new RegExp(pattern, flags)
  store.set(key, compiled)
  if (store.size > CACHE_LIMIT) store.clear()
  return compiled
}) as CachedRegex

cachedRegex.cacheSize = () => store.size
Object.defineProperty(cachedRegex, "CACHE_LIMIT", { value: CACHE_LIMIT, enumerable: true })