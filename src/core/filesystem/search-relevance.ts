export * as SearchRelevance from "./search-relevance"

/**
 * 纯本地搜索相关度打分（P1-1 检索增强 / P1-2 相关度排序）。
 *
 * 设计红线：
 *   - 零依赖、零 IO、纯函数。只吃字符串与「已经取回」的匹配结果，
 *     因此排序成本永远不会吃掉 trigram/fff 扫描的时间预算（1.5s 仍由 fff 承担）。
 *   - 不引入任何嵌入模型与云端调用。语义召回上限 = 归一化 + 代码域别名表。
 *   - 返回原对象引用，不改调用方字段（Match/Entry 结构保持兼容）。
 */

/** 打分结果：item 是入参原对象，relevance 是排序用的中间量，不写回。 */
export interface Ranked<T> {
  readonly item: T
  readonly relevance: number
}

export interface SubmatchLike {
  readonly text: string
  readonly start: number
  readonly end: number
}

export interface MatchInput {
  readonly path: string
  readonly line: number
  readonly text: string
  readonly submatches?: readonly SubmatchLike[]
}

// ---------------------------------------------------------------- 归一化

/**
 * 把标识符统一成小写蛇形：camelCase / PascalCase / kebab-case / 全角分隔符都归一，
 * 这样「查 userName 能命中 user_name.ts」这类跨书写风格的召回才成立。
 * CJK 字符不在替换范围内，中文查询与中文路径照常工作。
 */
export function normalizeIdentifier(value: string): string {
  return value
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1_$2")
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1_$2")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
}

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u

/**
 * 拆词元：保留整体形（user_name），同时给出子词（user / name）。
 * 中文没有分隔符，整串永远匹配不到「登录.ts」，因此额外产出双字窗口。
 * 正则里的一堆元字符会被归一化顺手当分隔符处理，天然降级成词元。
 */
export function tokenize(value: string): string[] {
  const normalized = normalizeIdentifier(value)
  if (!normalized) return []
  const words = normalized.split("_").filter((word) => word.length > 0)
  const tokens = [normalized, ...words]
  for (const word of words) {
    if (!CJK.test(word)) continue
    const chars = [...word]
    for (let i = 0; i + 1 < chars.length; i++) tokens.push(`${chars[i] ?? ""}${chars[i + 1] ?? ""}`)
  }
  return [...new Set(tokens)]
}

/**
 * 代码域别名表：不引模型的前提下，「同义表述能召回」只能靠这张手写表。
 * 只用于路径召回（低权重），绝不用于给 grep 的正则命中加权——
 * 那会让用户没搜过的词凭空得分。
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  auth: ["login", "logout", "signin", "authenticate", "credential", "permission", "session"],
  login: ["auth", "signin", "authenticate"],
  logout: ["signout", "auth"],
  signup: ["register", "registration"],
  register: ["signup", "registration"],
  db: ["database", "sql", "sqlite", "storage"],
  database: ["db", "sql", "storage"],
  config: ["configuration", "setting", "settings", "preference"],
  setting: ["settings", "config", "preference"],
  err: ["error", "exception", "failure", "fault"],
  error: ["err", "exception", "failure"],
  user: ["account", "member", "profile"],
  account: ["user", "member"],
  delete: ["remove", "destroy", "discard"],
  remove: ["delete", "destroy"],
  create: ["new", "add", "insert"],
  update: ["modify", "patch", "edit", "set"],
  list: ["index", "fetch", "query", "collection"],
  search: ["find", "query", "lookup", "filter"],
  find: ["search", "lookup", "query"],
  parse: ["decode", "deserialize", "reader"],
  client: ["consumer", "request"],
  server: ["handler", "backend", "service"],
  handler: ["server", "endpoint", "controller"],
  middleware: ["interceptor", "hook", "filter"],
  cache: ["buffer", "memo", "store"],
  queue: ["channel", "job", "task", "worker"],
  task: ["job", "queue", "worker"],
  test: ["spec", "case", "suite"],
  mock: ["stub", "fake", "double"],
  config_file: ["settings", "preference"],
  email: ["mail", "inbox", "message"],
  password: ["passwd", "secret", "credential"],
  image: ["picture", "photo", "avatar", "icon"],
  doc: ["document", "readme", "guide", "manual"],
  docs: ["document", "readme", "guide", "manual"],
}

/** 拆分查询为「原词元」与「别名词元」，别名权重天然低于原词。 */
export function expandTokens(query: string): { primary: string[]; aliases: string[] } {
  const primary = tokenize(query)
  const seen = new Set(primary)
  const aliases = new Set<string>()
  for (const token of primary) {
    for (const alias of ALIASES[token] ?? []) {
      if (seen.has(alias) || alias.length < 4) continue
      aliases.add(alias)
    }
  }
  return { primary, aliases: [...aliases] }
}

// ---------------------------------------------------------------- 权重

const EXACT_SEGMENT = 1.5
const PREFIX_SEGMENT = 0.6
const BASENAME_EXACT = 1.0
const BASENAME_PREFIX = 0.4
const PARTIAL = 0.6
const CONTIGUOUS = 2.0
const ALIAS_SEGMENT = 0.5
const ALIAS_PREFIX = 0.25
const MIN_PREFIX_LENGTH = 4

const DEFINITION = 3.0
const COVERAGE = 2.0
const DENSITY = 1.5
const HITS = 1.0
const POSITION = 0.8
const FILE_PATH = 2.0
const EXTRA_HITS = 0.6
const ADJACENT = 0.8
const EXTRA_HIT_CAP = 8

const DECLARATION =
  /(?:^|[\s{(;,])(?:export\s+|default\s+|declare\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|final\s+|abstract\s+|override\s+|pub\s+)*(?:function|class|interface|type|enum|struct|impl|trait|namespace|module|record|def|fn|func|const|let|var|method)\b/
const METHOD_SIGNATURE =
  /^\s*(?:async\s+)?(?:public|private|protected|static|final|override|pub\s+)?[\p{L}$][\p{L}\p{N}$_]*(?:<[^>]*>)?\s*\(/u
const FIELD_SIGNATURE =
  /^\s*(?:export\s+)?(?:const|let|var|final|public|private|protected|pub\s+)[\p{L}$][\p{L}\p{N}$_]*\s*[:=]/u

/** 声明/定义行：符号定义优先于普通调用（报告 §4.2 验收点）。 */
export function isDeclarationLine(text: string): boolean {
  return DECLARATION.test(text) || METHOD_SIGNATURE.test(text) || FIELD_SIGNATURE.test(text)
}

// ---------------------------------------------------------------- 路径打分

const segments = (normalized: string) => normalized.split("_").filter((part) => part.length > 0)

/**
 * 路径/文件名相关度：路径分词匹配 + 文件名加权 + 连续串命中 + 别名召回。
 * 完全无关返回 0，绝不返回负分。
 */
export function scorePath(query: string, candidate: string): number {
  const { primary, aliases } = expandTokens(query)
  if (primary.length === 0) return 0
  const normalized = normalizeIdentifier(candidate)
  if (!normalized) return 0
  const parts = segments(normalized)
  const base = parts[parts.length - 1] ?? ""
  const basename = segments(base)
  const joined = primary[0] ?? ""

  let score = 0
  for (const token of primary) {
    for (const part of parts) {
      if (part === token) score += EXACT_SEGMENT
      else if (token.length >= 3 && (part.startsWith(token) || token.startsWith(part))) score += PREFIX_SEGMENT
    }
    for (const part of basename) {
      if (part === token) score += BASENAME_EXACT
      else if (token.length >= 3 && (part.startsWith(token) || token.startsWith(part))) score += BASENAME_PREFIX
    }
    if (normalized.includes(token)) score += PARTIAL
  }
  if (joined && normalized.includes(joined)) score += CONTIGUOUS

  for (const alias of aliases) {
    for (const part of parts) {
      if (part === alias) score += ALIAS_SEGMENT
      else if (alias.length >= MIN_PREFIX_LENGTH && part.startsWith(alias)) score += ALIAS_PREFIX
    }
  }
  return score
}

/**
 * 路径候选排序（find/glob 用）。
 * 底层引擎分（fff score）尺度未知且可能很大，用 log10 压到同量级后再与路径信号相加，
 * 这样「路径明显更相关」能压过原始分，「打平」时仍由引擎分决胜。
 * 末位 tiebreak 保留既有的「浅路径优先」。
 */
export function rankPaths<T extends { path: string }>(
  items: readonly T[],
  query: string,
  base: (item: T) => number = () => 0,
): Ranked<T>[] {
  const scored = items.map((item, index) => {
    const engine = base(item)
    const relevance = scorePath(query, item.path) + Math.log10(1 + Math.max(0, engine))
    return { item, index, relevance }
  })
  scored.sort(
    (a, b) =>
      b.relevance - a.relevance ||
      a.item.path.length - b.item.path.length ||
      compare(a.item.path, b.item.path) ||
      a.index - b.index,
  )
  return scored.map(({ item, relevance }) => ({ item, relevance }))
}

// ---------------------------------------------------------------- 匹配打分

interface Hit {
  readonly start: number
  readonly end: number
}

/** 行内没有 submatches 时（tool/grep 路径）自行扫描词元，行为与有 submatches 对齐。 */
function collectHits(text: string, tokens: readonly string[]): Hit[] {
  const lower = text.toLowerCase()
  const hits: Hit[] = []
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    if (token.length < 2) continue
    let from = 0
    for (;;) {
      const index = lower.indexOf(token, from)
      if (index === -1) break
      const end = index + token.length
      const overlap = hits.some((hit) => index < hit.end && end > hit.start)
      if (!overlap) hits.push({ start: index, end })
      from = index + 1
    }
  }
  return hits
}

const IDENTIFIER_CHAR = /[\p{L}\p{N}$_]/u

/** 把命中向两侧扩到完整标识符边界，用来算「命中占比」。 */
function identifierLength(text: string, start: number, end: number): number {
  let from = start
  let to = end
  while (from > 0 && IDENTIFIER_CHAR.test(text.charAt(from - 1))) from--
  while (to < text.length && IDENTIFIER_CHAR.test(text.charAt(to))) to++
  return to - from
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

/** 单行打分：声明行加权 + 标识符命中占比 + 匹配密度 + 命中次数 + 命中位置。 */
function scoreLine(text: string, tokens: readonly string[]): number {
  const hits = collectHits(text, tokens)
  if (hits.length === 0) return isDeclarationLine(text) ? DEFINITION : 0
  const length = Math.max(1, text.trim().length)
  let matched = 0
  let covered = 0
  let first = hits[0]?.start ?? 0
  for (const hit of hits) {
    const size = hit.end - hit.start
    matched += size
    covered += Math.min(1, size / Math.max(1, identifierLength(text, hit.start, hit.end)))
    if (hit.start < first) first = hit.start
  }
  const coverage = covered / hits.length
  const density = clamp01(matched / length)
  const position = clamp01(1 - first / length)
  return (
    (isDeclarationLine(text) ? DEFINITION : 0) +
    COVERAGE * coverage +
    DENSITY * density +
    HITS * (Math.min(hits.length, 4) / 4) +
    POSITION * position
  )
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * grep 结果重排（P1-2 主战场）。
 * 先按行打分，再按文件聚合（同文件多命中、相邻行连续性、路径/文件名权重），
 * 最后以「文件分 → 行分 → 路径 → 行号」确定性排序。
 * 单遍扫描 + 一次 O(n log n) 排序，无 O(n^2) 项。
 */
export function rankMatches<T extends MatchInput>(matches: readonly T[], query: string): Ranked<T>[] {
  if (matches.length === 0) return []
  const { primary } = expandTokens(query)
  const rows = matches.map((item, index) => ({ item, index, line: scoreLine(item.text, primary) }))

  const totals = new Map<string, { sum: number; count: number; adjacent: number }>()
  for (const row of rows) {
    const path = row.item.path
    const group = totals.get(path) ?? { sum: 0, count: 0, adjacent: 0 }
    group.sum += row.line
    group.count += 1
    totals.set(path, group)
  }
  const lastLine = new Map<string, number>()
  for (const row of rows) {
    const previous = lastLine.get(row.item.path)
    if (previous !== undefined && row.item.line - previous === 1) {
      const group = totals.get(row.item.path)
      if (group) group.adjacent += 1
    }
    lastLine.set(row.item.path, row.item.line)
  }

  const relevance = new Map<string, number>()
  for (const [path, group] of totals) {
    relevance.set(
      path,
      group.sum +
        FILE_PATH * scorePath(query, path) +
        EXTRA_HITS * Math.min(Math.max(group.count - 1, 0), EXTRA_HIT_CAP) +
        ADJACENT * group.adjacent,
    )
  }

  rows.sort(
    (a, b) =>
      (relevance.get(b.item.path) ?? 0) - (relevance.get(a.item.path) ?? 0) ||
      b.line - a.line ||
      compare(a.item.path, b.item.path) ||
      a.item.line - b.item.line ||
      a.index - b.index,
  )
  return rows.map(({ item }) => ({ item, relevance: relevance.get(item.path) ?? 0 }))
}