/**
 * TTL LRU Cache - 带有过期时间的 LRU 缓存
 * 用于 model-based query 缓存（如 getLanguage），避免重复计算
 */
export interface TtlCacheOptions<K, V> {
  /** 最大条目数 */
  maxSize: number
  /** 生存时间（毫秒） */
  ttlMs: number
  /** 可选：值的序列化大小估算，用于内存控制 */
  sizeOf?: (value: V) => number
}

interface CacheEntry<V> {
  value: V
  expiresAt: number
  size: number
}

/**
 * 创建一个带有 TTL 和 LRU 淘汰的缓存
 */
export function createTtlCache<K, V>(options: TtlCacheOptions<K, V>) {
  const { maxSize, ttlMs, sizeOf = () => 1 } = options
  const cache = new Map<K, CacheEntry<V>>()
  let totalSize = 0

  function evictExpired(): void {
    const now = Date.now()
    for (const key of Array.from(cache.keys())) {
      const entry = cache.get(key)
      if (entry && entry.expiresAt <= now) {
        totalSize -= entry.size
        cache.delete(key)
      }
    }
  }

  function hasUnexpired(key: K): boolean {
    const entry = cache.get(key)
    if (!entry) return false
    if (entry.expiresAt <= Date.now()) {
      totalSize -= entry.size
      cache.delete(key)
      return false
    }
    return true
  }

  function evictLru(): void {
    if (cache.size === 0) return
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) {
      const entry = cache.get(firstKey)!
      totalSize -= entry.size
      cache.delete(firstKey)
    }
  }

  function makeRoomFor(size: number): void {
    evictExpired()
    // cache.size > 0 保护：单条 value 的 size 超过预算（size > maxSize * 10）时，
    // 清空缓存后仍会满足 totalSize + size > maxSize * 10，若无保护将死循环。
    while (cache.size > 0 && (cache.size >= maxSize || totalSize + size > maxSize * 10)) {
      evictLru()
    }
  }

  return {
    /** 获取值，若过期或不存在返回 undefined */
    get(key: K): V | undefined {
      const entry = cache.get(key)
      if (!entry) return undefined
      if (entry.expiresAt <= Date.now()) {
        totalSize -= entry.size
        cache.delete(key)
        return undefined
      }
      // LRU: 移到末尾（重新插入）
      cache.delete(key)
      cache.set(key, entry)
      return entry.value
    },

    /** 设置值，自动处理过期和 LRU 淘汰 */
    set(key: K, value: V): void {
      const raw = sizeOf(value)
      // sizeOf 返回 NaN/负数/Infinity 会让预算判据静默失效，按 1 兜底。
      const size = Number.isFinite(raw) && raw > 0 ? raw : 1
      // 覆盖已存在的键时先释放旧条目：否则 cache.size >= maxSize 会让
      // makeRoomFor 淘汰无关条目——覆盖写入不该扩大驱逐范围。
      const prev = cache.get(key)
      if (prev) {
        totalSize -= prev.size
        cache.delete(key)
      }
      makeRoomFor(size)
      const entry: CacheEntry<V> = {
        value,
        expiresAt: Date.now() + ttlMs,
        size,
      }
      cache.set(key, entry)
      totalSize += size
    },

    /** 检查是否存在且未过期 */
    has(key: K): boolean {
      return hasUnexpired(key)
    },

    /** 删除指定键 */
    delete(key: K): boolean {
      const entry = cache.get(key)
      if (!entry) return false
      // 只要条目还在 cache 里，totalSize 就一定含它的 size（所有过期清理路径
      // 都会同时移除条目），因此与是否过期无关，都必须扣减。
      totalSize -= entry.size
      return cache.delete(key)
    },

    /** 清空缓存 */
    clear(): void {
      cache.clear()
      totalSize = 0
    },

    /** 当前条目数 */
    get size(): number {
      return cache.size
    },

    /** 获取所有键（用于调试/统计） */
    keys(): IterableIterator<K> {
      return cache.keys()
    },

    /** 获取统计信息 */
    stats(): { size: number; totalSize: number; maxSize: number } {
      return { size: cache.size, totalSize, maxSize }
    },
  }
}

/**
 * 创建用于 model-based query 的标准缓存（30s TTL，最多 100 条目）
 */
export function createModelQueryCache<K, V>() {
  return createTtlCache<K, V>({
    maxSize: 100,
    ttlMs: 30_000, // 30 seconds
  })
}

/**
 * 缓存包装器 - 为异步函数添加缓存
 */
export function withCache<K, V>(
  cache: ReturnType<typeof createTtlCache<K, V>>,
  fn: (key: K) => Promise<V>,
): (key: K) => Promise<V> {
  return async (key: K) => {
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const value = await fn(key)
    cache.set(key, value)
    return value
  }
}

/**
 * 同步版本的缓存包装器
 */
export function withCacheSync<K, V>(
  cache: ReturnType<typeof createTtlCache<K, V>>,
  fn: (key: K) => V,
): (key: K) => V {
  return (key: K) => {
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const value = fn(key)
    cache.set(key, value)
    return value
  }
}