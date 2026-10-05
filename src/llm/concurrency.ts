// LLM 请求层的有界并发闸。
//
// 背景：`src/llm` 内原先没有任何并发上限（`Semaphore|withPermits|maxConcurrent|concurrency`
// 全部零命中），会话、子代理、summarizer 一起来就并发打 provider，很容易触发 429 / DSQ
// （DeepSeek 配额）这类限流。本模块补上这一层背压。
//
// 锁粒度：**全局单闸**（按 permit 数缓存，见文件末尾 `globalGate`）。
//
// 为什么选全局而不是「每 provider」或「每 route」：
//   - 每 route：route 是协议维度（anthropic-messages / openai-chat ...），不是配额维度。
//     同一个 provider 上挂 3 个 route 时每 route 各放 4 并发，总并发仍是 12，
//     对 provider 的压力没有任何削减，等于没加闸。
//   - 每 provider：语义上最贴合 429 的成因，但 `RequestExecutor` 的 `execute` 只拿到
//     `HttpClientRequest`，拿不到 provider 身份——provider 信息在上层 `LLMClient`
//     才确定，而 executor 是所有 route 共用的单例。要按 provider 分闸就得把
//     provider 身份透传进 executor 的接口签名，属于跨层改造，超出本缺口的最小修复范围。
//   - 全局：与 `src/gyccode/tool/swarm.ts` 的 `globalGate` 完全一致的做法——
//     429/DSQ 是「打太多」的问题，全局闸能保证任意时刻整个进程在飞的 LLM 请求数
//     有界，这是背压真正要保证的不变量。代价是不同 provider 之间互相排队，
//     但 LLM 请求本身是分钟级的长任务，这个代价比 429 重试风暴小得多。
//
// 取舍记录：如果将来 provider 维度的配额差异成为真实瓶颈（例如某家 provider
// 单独限流 2 并发），应在本模块之上再加一层 keyed 闸（可照抄
// `src/core/effect/keyed-mutex.ts` 的 `makeUnsafe`），而不是把全局闸调小。
import { Effect, Semaphore } from "effect"

/**
 * 未配置时的默认并发数，与 `src/gyccode/tool/swarm.ts` 的
 * `DEFAULT_TEAMMATE_CONCURRENCY` 保持一致：4 个并发对大多数 provider 的速率限制
 * 都有足够余量，同时能在 subagent 扇出时把瞬时并发压到可控范围。
 */
export const DEFAULT_LLM_CONCURRENCY = 4

/**
 * 并发上限。写死一个上界，避免有人把环境变量设成 999 或 10000 之后
 * 直接把背压关掉——上限存在本身就是一种保护。
 */
export const MAX_LLM_CONCURRENCY = 16

/** 覆盖默认并发数的环境变量名。 */
export const CONCURRENCY_ENV = "GYC_LLM_MAX_CONCURRENCY"

/**
 * 把配置值（环境变量原始字符串）夹成一个合法的 permit 数。
 *
 * 规则与 `swarm.ts` 的 `teammateConcurrencyLimit` 保持一致：
 *   - 缺失 / 非数字 / NaN / 小于 1 → 回落到默认值（宁可保守也不要意外放开并发）
 *   - 超过上限 → 夹到上限（防止有人用环境变量把背压整个关掉）
 *   - 其余 → 向下取整后使用
 */
export const llmConcurrencyLimit = (raw: string | number | undefined | null): number => {
  if (raw === undefined || raw === null) return DEFAULT_LLM_CONCURRENCY
  const parsed = typeof raw === "number" ? raw : Number(raw.trim())
  if (typeof raw === "string" && raw.trim() === "") return DEFAULT_LLM_CONCURRENCY
  if (!Number.isFinite(parsed)) return DEFAULT_LLM_CONCURRENCY
  const floored = Math.floor(parsed)
  if (floored < 1) return DEFAULT_LLM_CONCURRENCY
  return Math.min(floored, MAX_LLM_CONCURRENCY)
}

/** 读取当前生效的 permit 数。进程内每次调用都重新读环境变量，便于测试与运行时调整。 */
export const requestConcurrency = (): number => llmConcurrencyLimit(process.env[CONCURRENCY_ENV])

const gates = new Map<number, Semaphore.Semaphore>()

/**
 * 按 permit 数缓存的全局信号量。
 *
 * 必须缓存：同一进程里 executor 的 layer 可能被构建多次（不同 runtime / 不同测试），
 * 每次都新建 Semaphore 会让「全局」这个前提失效——每个实例各自放行 4 个，总并发
 * 又变成 4×N。按 permit 数缓存保证同一并发配置下所有持有者共用同一个闸，
 * 与 `src/gyccode/tool/swarm.ts` 的 `globalGate` 是同一写法。
 */
export const globalGate = (permits: number): Semaphore.Semaphore => {
  const cached = gates.get(permits)
  if (cached) return cached
  const created = Semaphore.makeUnsafe(permits)
  gates.set(permits, created)
  return created
}

/**
 * 把一次请求包进全局并发闸。
 *
 * `withPermit` 在成功与失败路径上都会归还 permit（Effect 的结构化并发保证），
 * 因此不需要额外的 `Effect.ensuring`。
 */
export const withRequestPermit = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  globalGate(requestConcurrency()).withPermit(effect)

export * as LLMConcurrency from "./concurrency"