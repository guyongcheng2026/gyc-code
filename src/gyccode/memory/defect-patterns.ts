/**
 * 审查缺陷模式库（Defect Patterns）
 *
 * 从 62 份代码审查报告（118 个问题）归并提炼的可复用缺陷模式。
 * 供后续审查/自查自动匹配：输入问题描述、错误信息或代码片段，
 * 返回命中的已知模式及其修复要点，避免同类问题重复引入。
 */

export interface DefectPattern {
  /** 稳定模式 ID（跨审查轮次不变） */
  readonly id: string
  /** 归属问题级别（1级/2级/3级，对应审查报告分级） */
  readonly level: 1 | 2 | 3
  /** 模式名称 */
  readonly name: string
  /** 症状：这类问题长什么样 */
  readonly symptoms: string
  /** 匹配关键词（小写，命中任一即候选） */
  readonly keywords: readonly string[]
  /** 修复要点 */
  readonly fix: string
}

export interface DefectMatch {
  readonly pattern: DefectPattern
  readonly hits: readonly string[]
}

/** 从 62 份审查报告归并的缺陷模式（同类问题合并为一条）。 */
export const DEFECT_PATTERNS: readonly DefectPattern[] = [
  // ---- 1级（安全/核心正确性） ----
  {
    id: "P1-RMW-UNSAFE",
    level: 1,
    name: "读-改-写无锁并发丢失",
    symptoms: "先读全量数据、内存中修改、再整份覆写；并发调用时后写者覆盖前者更新",
    keywords: ["读-改-写", "覆盖", "竞态", "丢失更新", "并发写", "无锁", "cas", "读改写"],
    fix: "文件锁/信号量串行化，或单事务内原子读改写（atomicWriteJson/mutate）",
  },
  {
    id: "P1-TOCTOU",
    level: 1,
    name: "检查-使用间隙竞态（TOCTOU）",
    symptoms: "先检查（端口空闲/锁陈旧/状态存在）再使用，两个 await 之间状态可被改变",
    keywords: ["toctou", "间隙", "检查后", "先检查", "预检"],
    fix: "去掉预检直接执行并显式处理失败（如 EADDRINUSE），或在锁内完成检查与使用",
  },
  {
    id: "P1-EXCESS-GLOBAL",
    level: 1,
    name: "模块级全局可变状态",
    symptoms: "模块顶层 let/Map 持有流程状态；测试无法隔离、并发流程互相污染",
    keywords: ["模块级", "全局可变", "全局状态", "单例状态", "状态泄漏"],
    fix: "状态收敛进 class 实例（或注入的 context），模块级只保留默认单例",
  },
  {
    id: "P1-UNBOUNDED-CACHE",
    level: 1,
    name: "缓存容量无限/无过期",
    symptoms: "capacity: Infinity 或缓存无 TTL；长期运行内存单调增长、配置变更不生效",
    keywords: ["容量无限", "positive_infinity", "无 ttl", "内存泄漏", "永不驱逐", "不更新缓存"],
    fix: "有界 LRU 容量 + TTL，配合显式 invalidate",
  },
  {
    id: "P1-RAW-ASYNC",
    level: 1,
    name: "裸 async 破坏 Effect 组合性",
    symptoms: "Effect 服务里出现裸 async/await Promise；无法接超时/重试/中断，错误通道变 unknown",
    keywords: ["裸 async", "promise", "await effect.runpromise", "破坏 effect", "组合性"],
    fix: "改为 Effect.fn/Effect.tryPromise，错误走类型化 TaggedError",
  },
  {
    id: "P1-DUP-IMPL",
    level: 1,
    name: "双实现重复且不一致",
    symptoms: "两份近乎相同的实现（不同错误类型/细节漂移）；修复只落一处",
    keywords: ["重复实现", "两套", "双实现", "重复定义", "同构代码"],
    fix: "提取单一来源，另一处降为薄再导出/组合（节点列表单源化）",
  },
  {
    id: "P1-DEAD-WRITE",
    level: 1,
    name: "死写入（写读路径不一致）",
    symptoms: "update 写文件 A，加载侧只读文件 B；配置更新静默失效",
    keywords: ["死写入", "写入路径", "加载侧只读", "静默失效", "不生效"],
    fix: "写读统一到同一文件名，写后 invalidate",
  },
  {
    id: "P1-CROSS-SESSION",
    level: 1,
    name: "跨会话/跨用户越权",
    symptoms: "仅凭 requestID/资源 ID 操作，不校验归属会话；可跨会话审批/读取",
    keywords: ["跨会话", "越权", "归属校验", "权限绕过", "会话绑定"],
    fix: "操作入口校验资源归属（sessionID 匹配），不匹配映射 NotFound",
  },
  {
    id: "P1-STALE-WRITE",
    level: 1,
    name: "过期快照整体回写",
    symptoms: "await 前读取的对象在 await 后被整体回写，覆盖并发期间的更新",
    keywords: ["过期", "整体回写", "覆盖并发", "读取后回写"],
    fix: "改用原子 modify（基于最新值变换）而非整对象 set",
  },
  {
    id: "P1-SECRET-IN-ENV",
    level: 1,
    name: "敏感信息进环境变量",
    symptoms: "凭据/令牌 JSON.stringify 进 process.env 传递给子进程，扩散到全部子进程",
    keywords: ["环境变量", "process.env", "泄露到子进程", "auth_content"],
    fix: "敏感数据走受控通道（文件 0600/IPC），env 白名单只放非敏感项",
  },
  // ---- 2级（健壮性/安全） ----
  {
    id: "P2-SILENT-FAIL",
    level: 2,
    name: "静默吞错/静默降级",
    symptoms: "catch 后 logWarning 便返回 fallback/undefined；故障无审计、上层无感知",
    keywords: ["静默", "吞掉", "吞错", "降级", "忽略失败", "catchcause", "orElseSucceed"],
    fix: "显式 fail 或落审计后降级；关键路径不得静默",
  },
  {
    id: "P2-DEFECT-500",
    level: 2,
    name: "orDie/die 直通 500",
    symptoms: "orDie/Effect.die 处理可预期输入错误（正则编译/解析失败），缺陷升级为 500",
    keywords: ["ordie", "effect.die", "defect", "直通 500", "缺陷"],
    fix: "改 Effect.fail 走类型化错误并映射 400/404/403",
  },
  {
    id: "P2-INJECTION",
    level: 2,
    name: "命令注入/ReDoS",
    symptoms: "用户输入直接进 shell 拼接或 new RegExp；危险字符未转义/无白名单",
    keywords: ["注入", "redos", "shell 解析", "正则注入", "拼接命令", "危险字符"],
    fix: "参数数组直传（不经 shell）、白名单校验、正则长度/复杂度限制",
  },
  {
    id: "P2-PATH-TRAVERSAL",
    level: 2,
    name: "路径遍历",
    symptoms: "filePath/location 未过 guardDirectory，含 ../ 可读写工作区外文件",
    keywords: ["路径遍历", "../", "guardDirectory", "工作区外", "任意文件"],
    fix: "规范化后校验前缀在托管根内，越界映射 403",
  },
  {
    id: "P2-OPEN-REDIRECT",
    level: 2,
    name: "开放重定向",
    symptoms: "授权/跳转 URL 只校验协议，不校验主机是否为预期授权服务器",
    keywords: ["开放重定向", "重定向", "授权地址", "redirect"],
    fix: "校验 hostname 在同源/白名单内再跳转",
  },
  {
    id: "P2-PLAINTEXT-SECRET",
    level: 2,
    name: "凭证明文存储",
    symptoms: "token/key 明文 JSON 落盘；0600 仅防同机用户，不防备份/转储",
    keywords: ["明文", "未加密", "plaintext", "存储凭据"],
    fix: "复用加密通道（DPAPI/AES-GCM）落盘，历史明文下次写入时迁移",
  },
  {
    id: "P2-NO-RATE-LIMIT",
    level: 2,
    name: "无认证频率限制",
    symptoms: "登录/授权失败可无限重试；无计数、锁定、IP 封禁",
    keywords: ["频率限制", "暴力", "锁定", "重试次数", "brute"],
    fix: "失败计数 + 滑动窗口封禁，成功后复位",
  },
  {
    id: "P2-HARDCODED",
    level: 2,
    name: "关键值硬编码",
    symptoms: "缓冲时长/基础 URL/根路径哨兵/密钥常量等写死，环境变化即失效",
    keywords: ["硬编码", "写死", "hardcoded", "localhost", "常量"],
    fix: "配置化（sys_config/构造参数），保留安全默认值",
  },
  {
    id: "P2-UNIT-MISMATCH",
    level: 2,
    name: "时间单位混淆",
    symptoms: "秒 vs 毫秒混用（Date.now() 直接比较 Unix 秒）；0 表示永不过期被误判过期",
    keywords: ["单位混淆", "秒 vs", "毫秒", "expires_in", "expiresat"],
    fix: "统一单位并写明；0 值语义（永不过期）显式判断",
  },
  {
    id: "P2-LOG-ISSUE",
    level: 2,
    name: "日志注入/热路径刷盘",
    symptoms: "客户端 message/extra 透传日志注入；热路径每次请求 logInfo 刷盘",
    keywords: ["日志注入", "透传", "刷盘", "热路径", "loginfo"],
    fix: "客户端输入转义/截断；热路径日志降级或采样",
  },
  {
    id: "P2-NO-SIZE-LIMIT",
    level: 2,
    name: "无大小/分页上限",
    symptoms: "整文件读入内存无上限；分页 limit 无上界或 limit=0 全量返回",
    keywords: ["无上限", "全量返回", "整文件", "limit=0", "无界"],
    fix: "强制上界（字节/条数），超限截断或 413",
  },
  {
    id: "P2-STATE-LEAK",
    level: 2,
    name: "状态不清理/无过期",
    symptoms: "pending 状态成功后不清理、无超时；拒绝计数无 TTL 长期驻留",
    keywords: ["不清理", "无过期", "残留", "不回收", "泄漏"],
    fix: "成功/超时即清理 + 定期兜底清扫",
  },
  {
    id: "P2-ERROR-SWALLOW",
    level: 2,
    name: "错误吞噬致静默失败",
    symptoms: "promise 链 .then(noop, noop) 吞掉失败；allSettled 吞掉 disposer 失败",
    keywords: ["吞噬", "静默失败", "allsettled", "失败不传播", "then(() => undefined"],
    fix: "失败落审计/日志；链上保留失败事实，仅隔离不吞",
  },
  // ---- 3级（精洁度/一致性） ----
  {
    id: "P3-CONSOLE-LEFTOVER",
    level: 3,
    name: "裸 console.log 残留",
    symptoms: "事件处理器/回调里直接 console.log，与全仓 logError/logDebug 收敛约定不一致",
    keywords: ["console.log", "裸 console", "console.error"],
    fix: "统一走 logError/logDebug 等收敛通道",
  },
  {
    id: "P3-DEAD-CODE",
    level: 3,
    name: "死代码/零引用",
    symptoms: "导出函数/阈值常量全仓无调用方；重复实现与活跃版本漂移",
    keywords: ["死代码", "零引用", "未使用", "无调用方", "无引用"],
    fix: "删除或接线（确保被节点组/调用方引用）",
  },
  {
    id: "P3-DOC-DRIFT",
    level: 3,
    name: "注释/文档与行为漂移",
    symptoms: "注释宣称的行为与实现方向相反；优先级说明与代码不一致",
    keywords: ["注释与", "文档不一致", "漂移", "自认", "方向相反"],
    fix: "注释随实现同步更新，或删除误导注释",
  },
  {
    id: "P3-UNSAFE-PARSE",
    level: 3,
    name: "解析无容错",
    symptoms: "JSON.parse/URI 解码/正则编译无 try，畸形输入直接击穿",
    keywords: ["json.parse", "无容错", "urierror", "解析失败", "畸形"],
    fix: "try + 降级默认值，失败路径可观测",
  },
  {
    id: "P3-NON-ATOMIC-WRITE",
    level: 3,
    name: "非原子写关键文件",
    symptoms: "writeFileSync 直写目标文件；中途崩溃留下截断 JSON，重启静默回空",
    keywords: ["非原子", "直写", "截断", "writefilesync"],
    fix: "临时文件 + rename 原子替换",
  },
  {
    id: "P3-NULL-ASSERT",
    level: 3,
    name: "非空断言取缺失值",
    symptoms: "用 ! / as 取可能不存在的值（调色板/句柄），缺失即 TypeError",
    keywords: ["非空断言", "undefined", "缺失时", "!", "崩溃"],
    fix: "判空守卫 + 合理回退，禁止 ! 直取",
  },
  {
    id: "P3-MISSING-GUARD",
    level: 3,
    name: "缺生命周期/判空守卫",
    symptoms: "await 后不复查元素存活；定时器无卸载清理；与同文件其他路径守卫不一致",
    keywords: ["判空", "守卫", "卸载", "定时器", "竞态下", "未挂载"],
    fix: "await 后复查有效性；定时器绑定卸载清理",
  },
] as const

/**
 * 在文本（问题描述/错误信息/代码片段）中匹配已知缺陷模式。
 * 命中任一关键词即入选；按命中关键词数降序返回。
 */
export function matchDefectPatterns(text: string): DefectMatch[] {
  const haystack = text.toLowerCase()
  const matches: DefectMatch[] = []
  for (const pattern of DEFECT_PATTERNS) {
    const hits = pattern.keywords.filter((k) => haystack.includes(k))
    if (hits.length > 0) matches.push({ pattern, hits })
  }
  matches.sort((a, b) => b.hits.length - a.hits.length)
  return matches
}

/** 将命中的模式格式化为 prompt 片段（供审查/自查时注入）。 */
export function formatDefectMatches(matches: readonly DefectMatch[], limit = 5): string | undefined {
  if (matches.length === 0) return undefined
  const lines = matches.slice(0, limit).map(
    (m) => `[${m.pattern.id}|${m.pattern.level}级] ${m.pattern.name}：${m.pattern.fix}`,
  )
  return `<known-defect-patterns>\n${lines.join("\n")}\n</known-defect-patterns>`
}
