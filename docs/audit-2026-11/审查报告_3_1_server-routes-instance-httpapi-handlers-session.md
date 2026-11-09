注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：permissionRespond 不校验 permissionID 归属会话，可跨会话审批 1级

## 问题1分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/session.ts:346-356`（`permissionRespond` 仅以入参 `requestID` 应答，未校验其归属当前会话）。
- 根因：`permission/index.ts:275-278` 在**全局** pending 集合中按 `requestID` 查找审批单，不带会话过滤；`:320-329` 审批通过后 `always` 写入的是 **instance 级**规则（非会话级）。因此端点虽挂在会话路由下，持有任意他人 `requestID` 即可跨会话/跨用户完成审批，并把权限规则写入整个实例。
- 对照证据：审批落点为实例级规则（`permission/index.ts:320-329`），影响面超出发起会话；pending 查找无归属字段校验（`permission/index.ts:275-278`）。
- 影响：1级。构成越权审批——任何可达该端点的客户端可替任意会话批准权限请求，实现跨会话提权。

### 问题1修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/session.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/session.ts
@@ -346,6 +346,12 @@
 export const permissionRespond = (sessionId: string) =>
-  Effect.gen(function* () {
+  Effect.gen(function* () {
+    const pending = yield* getPendingPermission(requestID)
+    if (pending.sessionId !== sessionId) {
+      return yield* Effect.fail(
+        new NotFound(`permission request ${requestID}`),
+      )
+    }
     return yield* respondPermission(requestID, decision)
   })
```

# 问题2：messages limit 无上限且 limit=0 全量返回并忽略 before 2级

## 问题2分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/session.ts:108-127`（messages 端点透传 `limit`，无上界；`limit=0` 分支返回全量并跳过 `before` 分页）。
- 对照证据：`groups/session.ts:45` 对 `limit` 仅校验 `isInt ≥ 0`——允许 0、无 200 之类上界，校验层与 handler 层双重缺位。
- 根因：入参校验只保证非负整数，handler 未夹取（clamp）到 1..N；`limit=0` 被当作"不限量"且绕过 `before` 游标，单次可拖出全量消息。
- 影响：2级。已鉴权会话内可拖库式拉取消息，造成内存/带宽耗尽与响应超时（可用性），非跨会话越权。

### 问题2修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/session.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/session.ts
@@ -108,8 +108,11 @@
-  const limit = params.limit ?? DEFAULT_LIMIT
+  const rawLimit = params.limit ?? DEFAULT_LIMIT
+  if (rawLimit < 1) {
+    return yield* Effect.fail(new BadRequest("limit must be >= 1"))
+  }
+  const limit = Math.min(rawLimit, MAX_PAGE_LIMIT)
   const messages = yield* listMessages(sessionId, { limit, before: params.before })
```

# 问题3：deletePart/updatePart 缺 assertNotBusy，可与进行中任务竞态 2级

## 问题3分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/session.ts:369-391`（deletePart、updatePart 两个写操作直接执行变更）。
- 对照证据：同文件同类写操作 `session.ts:364` 在变更前 yield `assertNotBusy`——同一会话的写路径本应统一过忙碌闸门，这两处遗漏。
- 根因：删除/更新 part 未检查会话是否正处于 busy（prompt/生成中），与进行中的任务并发读写同一批 part，产生状态覆盖或半写数据。
- 影响：2级。触发条件为会话忙碌时的并发写，后果是数据一致性受损与潜在 500，不构成越权。

### 问题3修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/session.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/session.ts
@@ -369,6 +369,7 @@
 export const deletePart = (sessionId: string, partId: string) =>
   Effect.gen(function* () {
+    yield* assertNotBusy(sessionId)
     yield* removePart(sessionId, partId)
     return yield* Effect.void
   })
@@ -380,6 +381,7 @@
 export const updatePart = (sessionId: string, partId: string, patch: unknown) =>
   Effect.gen(function* () {
+    yield* assertNotBusy(sessionId)
     yield* patchPart(sessionId, partId, patch)
     return yield* Effect.void
   })
```

# 问题4：diff 不校验会话存在，summary.ts:135 orDie 直通 500 2级

## 问题4分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/session.ts:97-102`（diff 端点未先校验 session 是否存在即下钻）。
- 对照证据：`summary.ts:135` 对缺失会话路径使用 `orDie`——缺陷（defect）不走类型化错误通道，直接冒泡为 500。
- 根因：handler 缺少「会话存在性」前置检查，不存在的 `sessionId` 一路传到 summary 层，被 `orDie` 判为不可恢复缺陷，本应返回 404 却返回 500。
- 影响：2级。错误语义错误与噪音 500，可被用于错误探测刷审计；无数据泄露。

### 问题4修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/session.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/session.ts
@@ -97,6 +97,9 @@
 export const diff = (sessionId: string, params: DiffParams) =>
   Effect.gen(function* () {
+    const exists = yield* sessionExists(sessionId)
+    if (!exists) {
+      return yield* Effect.fail(new NotFound(`session ${sessionId}`))
+    }
     return yield* diffSummary(sessionId, params)
   })
```

# 问题5：promptAsync 以 forkIn(scope) 派发且无并发上限 2级

## 问题5分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/session.ts:291-308`（`promptAsync` 用 `forkIn(scope)` 直接派发后台 fiber）。
- 根因：每次调用即 fork 一个 fiber，作用域（scope）只保证随实例销毁回收，不限制同时存活的 prompt 数量——无信号量/队列背压，短时间重复调用可 fork 无上限后台任务，争抢模型调用与 IO。
- 影响：2级。已鉴权客户端可触发资源耗尽（CPU/内存/上游配额），属可用性风险，非越权。

### 问题5修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/session.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/session.ts
@@ -291,6 +291,10 @@
 export const promptAsync = (sessionId: string, req: PromptRequest) =>
   Effect.gen(function* () {
-    yield* Effect.forkIn(promptJob(sessionId, req), scope)
+    yield* promptSemaphore.withPermits(1)(
+      Effect.forkIn(promptJob(sessionId, req), scope),
+    )
     return yield* Effect.void
   })
+
+const promptSemaphore = yield* Effect.makeSemaphore(MAX_CONCURRENT_PROMPTS)
```
