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
    for (const [key, entry] of cache.entries()) {
      if (entry.expiresAt <= now) {
        totalSize -= entry.size
        cache.delete(key)
      }
    }
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
    while ((cache.size >= maxSize || totalSize + size > maxSize * 10) && cache.size > 0) {
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
      const size = sizeOf(value)
      makeRoomFor(size)
      // 同键覆盖：先扣除旧 entry 已计入的 size，否则 totalSize 虚高，
      // 且 delete/evict 时只减一次导致 totalSize 永不回落（缓存被提前清空）。
      const prev = cache.get(key)
      if (prev) totalSize -= prev.size
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
      return this.get(key) !== undefined
    },

    /** 删除指定键 */
    delete(key: K): boolean {
      const entry = cache.get(key)
      if (entry) {
        totalSize -= entry.size
        return cache.delete(key)
      }
      return false
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