import { describe, expect, test } from "bun:test"
import { ContextAwareReplacer } from "./edit"
import { ReadCache, FILE_UNCHANGED_STUB } from "./read-cache"

const take = (content: string, find: string) => Array.from(ContextAwareReplacer(content, find))

/**
 * S-05：ContextAwareReplacer 是替换链最后一位，能走到它说明前 7 条精确匹配都已
 * 失败，oldString 与文件内容必然不完全相同。它过去只要求「首尾锚点相同 +
 * 中间行 50% 精确命中」，于是同名同签名、样板行雷同的另一个函数会被误命中。
 * 验收标准：相似函数拒绝替换，真正的同一段代码仍能命中。
 */
describe("S-05 ContextAwareReplacer 不得误改相似函数", () => {
  const other = [
    "export function handle(value: string) {",
    "  const first = value.trim()",
    "  const second = first.toUpperCase()",
    "  return second + 'suffix-from-other'",
    "}",
  ].join("\n")
  const target = [
    "export function handle(value: string) {",
    "  const first = value.trim()",
    "  const second = first.toLowerCase()",
    "  return second + 'suffix'",
    "}",
  ].join("\n")
  const content = `${other}\n\nexport function unrelated() {\n  return 1\n}\n\n${target}\n`

  test("内容里存在同名函数时，find 命中的是目标那一处而不是撞上第一个", () => {
    const results = take(content, target)
    expect(results).toHaveLength(1)
    expect(results[0]).toBe(target)
  })

  test("与另一个函数只有锚点相同、中间实质不同时不再被接受", () => {
    // find 的首行与末行都能在内容里撞到，但整段内容并不一致
    const impostor = [
      "export function handle(value: string) {",
      "  const totally = value.split(',')",
      "  const rebuilt = totally.join('-')",
      "  return rebuilt + 'suffix-from-other'",
      "}",
    ].join("\n")
    expect(take(content, impostor)).toEqual([])
  })

  test("同一段代码的小改动仍能命中，避免把匹配收得过死", () => {
    const withTypo = target.replace("trim()", "trim() ")
    expect(take(content, withTypo)).toHaveLength(1)
  })

  test("整段一致时照旧命中", () => {
    expect(take(content, target)).toEqual([target])
  })

  test("首尾锚点缺失时不命中", () => {
    expect(take(content, "const first = value.trim()")).toEqual([])
  })
})

/**
 * S-06：readSet 是真 LRU（delete+add 重排），map 曾是 FIFO（命中不重排），
 * 两者容量又相同，淘汰节奏长期错位 → 缓存里有的键不在 readSet，read 会命中
 * 缓存返回 `<file unchanged>`，而 write/edit 又报「File has not been read」。
 */
describe("S-06 readSet 与缓存淘汰不得错位", () => {
  const prefix = "s06-fixture/"

  test("反复命中的文件只要仍在缓存里，就不会先被 readSet 忘掉", () => {
    const cache = ReadCache()
    const a = `${prefix}a.ts`
    cache.set(a, "content-a", { mtime: new Date(), size: 1 })
    // 读 A → 读 B → 再读 A：readSet 重排而 map 原先不重排，正是错位的成因
    cache.set(`${prefix}b.ts`, "content-b", { mtime: new Date(), size: 1 })
    cache.set(a, "content-a", { mtime: new Date(), size: 1 })
    for (let i = 0; i < 100; i++) {
      cache.set(`${prefix}pad-${i}.ts`, `x${i}`, { mtime: new Date(), size: 1 })
    }
    // 只要还在缓存里命中，就必须带已读标记，否则 write/edit 会误报未读
    expect(cache.get(a)).toBeDefined()
    expect(cache.hasRead(a)).toBe(true)
  })

  test("已被缓存淘汰的键可以一并忘记——不产生不一致即可", () => {
    const cache = ReadCache()
    const a = `${prefix}gone.ts`
    cache.set(a, "content-a", { mtime: new Date(), size: 1 })
    for (let i = 0; i < 300; i++) {
      cache.set(`${prefix}pad-${i}.ts`, `x${i}`, { mtime: new Date(), size: 1 })
    }
    // A 的内容早已不在缓存里，此时忘记它是对的；关键是绝不会出现
    // 「缓存里还能命中、却没被标记为已读」这种反向错位。
    expect(cache.get(a) === undefined || cache.hasRead(a)).toBe(true)
  })

  test("命中缓存的键一定带已读标记：write/edit 不得误报未读", () => {
    const cache = ReadCache()
    let mismatches = 0
    for (let i = 0; i < 400; i++) {
      cache.set(`${prefix}f-${i}.ts`, `c${i}`, { mtime: new Date(), size: 1 })
      cache.set(`${prefix}f-${i % 7}.ts`, `c${i % 7}`, { mtime: new Date(), size: 1 })
      // 不变式：凡是缓存里能命中的键，都必须被标记为已读
      if (cache.get(`${prefix}f-${i}.ts`) && !cache.hasRead(`${prefix}f-${i}.ts`)) mismatches++
    }
    expect(mismatches).toBe(0)
  })

  test("缓存条目被显式失效后不再返回内容", () => {
    const cache = ReadCache()
    const file = `${prefix}evict.ts`
    cache.set(file, "v1", { mtime: new Date(), size: 2 })
    expect(cache.get(file)?.content).toBe("v1")
    cache.invalidate(file)
    expect(cache.get(file)).toBeUndefined()
  })

  test("unchanged 占位与 markRead 共用同一套记账", () => {
    const cache = ReadCache()
    const file = `${prefix}stub.ts`
    cache.set(file, FILE_UNCHANGED_STUB, FILE_UNCHANGED_STUB)
    expect(cache.getStat(file)).toBe(FILE_UNCHANGED_STUB)
    cache.markRead(`${prefix}marked.ts`)
    expect(cache.hasRead(`${prefix}marked.ts`)).toBe(true)
  })
})