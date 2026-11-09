# 问题1：锚点落盘用非原子 `writeFileSync` 直写目标文件，进程在写入中途崩溃会留下截断 JSON，重启后 `loadCacheAnchors` 静默回空、全部漂移基线丢失 3级
## 问题1分析:
`persistCacheAnchors`（src/gyccode/session/cache-anchor.ts:101-114）直接 `fs.writeFileSync(ANCHOR_FILE, JSON.stringify(payload))`（cache-anchor.ts:108）覆盖写 `Global.Path.state/cache-anchors.json`（cache-anchor.ts:67），没有「写临时文件 + rename」的原子替换。

风险链：
1. 写入被中断（进程崩溃/断电/磁盘满，`writeFileSync` 中途抛错）→ 目标文件残留为**截断或半截 JSON**；
2. 下次启动 `loadCacheAnchors`（cache-anchor.ts:79-96）`JSON.parse` 失败后走 `catch { return new Map() }`（cache-anchor.ts:93-95）**静默返回空表**，且不清理损坏文件——全部会话的 `cacheRead/inputTokens` 基线一次性丢失；
3. 损坏文件要等到下一次通过节流窗口的 `persistCacheAnchors`（cache-anchor.ts:102，30s 间隔，cache-anchor.ts:70）才会被整表重写覆盖，在此之前所有 `trackCacheDrift`（cache-anchor.ts:122-141）都拿不到 `prev`，缓存命中骤降告警**静默漏报**——而这正是 cache-anchor.ts:75-78 注释强调「最该看见的一次」的场景。

同时该写盘发生在 step-finish 热路径（src/gyccode/session/processor.ts:498 调用 `persistCacheAnchors(cacheDriftAnchors)`），`loadCacheAnchors` 也在模块加载期同步读盘（processor.ts:34 `const cacheDriftAnchors = loadCacheAnchors()`），均为事件循环内的同步 IO；节流已把频次压到 ≥30s 一次，残余风险主要是**非原子**而非频次，故整体判 3级。

### 问题1修复后的代码：
```diff
 export function persistCacheAnchors(anchor: AnchorMap, now = Date.now()): void {
   if (now - lastPersist < PERSIST_INTERVAL_MS) return
   lastPersist = now
   const payload: Record<string, { cacheRead: number; inputTokens: number }> = {}
   for (const [sessionID, entry] of anchor) payload[sessionID] = entry
   try {
     fs.mkdirSync(path.dirname(ANCHOR_FILE), { recursive: true })
-    fs.writeFileSync(ANCHOR_FILE, JSON.stringify(payload), "utf-8")
+    // 先写临时文件再 rename：writeFileSync 直写会在崩溃时留下截断 JSON，
+    // loadCacheAnchors 解析失败静默回空 → 全部漂移基线丢失且漏报首轮骤降。
+    const tmp = `${ANCHOR_FILE}.${process.pid}.tmp`
+    fs.writeFileSync(tmp, JSON.stringify(payload), "utf-8")
+    fs.renameSync(tmp, ANCHOR_FILE)
   } catch (error) {
     logError("cache-anchor.persist", error, { entries: Object.keys(payload).length })
   }
 }
```
---
# 问题2：`loadCacheAnchors` 解析失败静默返回空表且不落痕，锚点丢失后无任何可观测信号 3级
## 问题2分析:
`loadCacheAnchors`（cache-anchor.ts:79-96）的 `catch { return new Map() }`（cache-anchor.ts:93-95）把**三种性质完全不同的失败**统一吞掉：文件不存在（正常首次启动）、JSON 损坏（问题1 的截断写）、权限/IO 错误。后两种本应留痕——`persistCacheAnchors` 侧已经确立了「写失败只记日志但必须留痕迹」的原则（cache-anchor.ts:110-112 显式调用 `logError("cache-anchor.persist", …)`），读侧却没有对称处理。

后果：锚点表非预期清空后，`trackCacheDrift`（cache-anchor.ts:140）首调用 `prev` 为 `undefined` 只能返回 `null`，后续所有真实漂移在「基线重建」期间（下一次 persist 前至少 30s，cache-anchor.ts:70）全部静默漏报，且日志里查不到「锚点为何没生效」——正是 cache-anchor.ts:110-111 注释所要避免的现象。属可观测性缺口，判 3级（不改变请求行为，仅漏报信号）。

### 问题2修复后的代码：
```diff
     for (const [sessionID, entry] of Object.entries(parsed)) {
       const cacheRead = typeof entry?.cacheRead === "number" ? entry.cacheRead : undefined
       const inputTokens = typeof entry?.inputTokens === "number" ? entry.inputTokens : undefined
       if (cacheRead === undefined || inputTokens === undefined) continue
       if (cacheRead < 0 || inputTokens < 0) continue
       anchors.set(sessionID, { cacheRead, inputTokens })
       if (anchors.size >= ANCHOR_MAX) break
     }
     return anchors
-  } catch {
-    return new Map()
+  } catch (error) {
+    // 区分「首次启动无文件」与「已存在但损坏/不可读」：后者意味着漂移基线
+    // 被清空，必须留痕，否则 cacheDrift 漏报会变成查不到原因的现象。
+    if (fs.existsSync(ANCHOR_FILE)) {
+      logError("cache-anchor.load", error, { file: ANCHOR_FILE })
+    }
+    return new Map()
   }
 }
```
---
# 问题3：`trackCacheDrift` 的 LRU 淘汰在「无 prev 的新会话」分支才触发，已存在的会话命中路径缺少 size 上限兜底，极端并发下 map 可能越过 ANCHOR_MAX 3级
## 问题3分析:
`trackCacheDrift`（cache-anchor.ts:122-141）的淘汰逻辑分两支：
- 已存在 `prev`：`anchor.delete(sessionID)` 后 `anchor.set(...)`（cache-anchor.ts:134、139），不检查 size；
- 不存在 `prev` 且 `anchor.size >= ANCHOR_MAX`：淘汰 `keys().next().value`（cache-anchor.ts:135-138）。

单线程顺序调用下 size 不会越界（每新增一项都先淘汰一项）。但该函数在 step-finish 热路径被调用（processor.ts:494），且 `loadCacheAnchors` 初始化时也用 `anchors.size >= ANCHOR_MAX` 截断（cache-anchor.ts:90）——**两处上限语义一致但各自独立维护**：若磁盘文件里已有 1000 条（cache-anchor.ts:64 `ANCHOR_MAX = 1000`），初始化即达上限，之后任何新会话都走淘汰分支，行为正常；真正的缺口是 `persistCacheAnchors` 每次把**整表**写盘（cache-anchor.ts:104-105），表越大序列化与同步写越重，而上限恒为 1000、无按需收紧机制。

严格说当前实现没有可观测的越界路径，本条仅指出「上限分散在 load（cache-anchor.ts:90）与 track（cache-anchor.ts:135）两处、persist 无独立校验」的结构性弱点，属次要改进，判 3级；若谷总认为宁缺毋滥可直接忽略本条。

### 问题3修复后的代码：
```diff
   anchor.set(sessionID, cur)
+  // 统一兜底：load 侧与 track 侧各自维护上限，这里补一次收敛，
+  // 保证 persistCacheAnchors 写出的表恒 ≤ ANCHOR_MAX，同步写体积可控。
+  while (anchor.size > ANCHOR_MAX) {
+    const oldest = anchor.keys().next().value
+    if (oldest === undefined) break
+    anchor.delete(oldest)
+  }
   return prev ? cacheDriftFromUsage(prev, cur) : null
 }
```
