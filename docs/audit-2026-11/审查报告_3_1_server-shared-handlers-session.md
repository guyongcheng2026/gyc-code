注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：session.create 的 location 未过 guardDirectory，可写到工作区外 2级

## 问题1分析:

- 位置：`src/gyccode/server/shared/handlers/session.ts:85-90`（`session.create` 直接使用入参 `location` 建会话，未做目录守卫）。
- 对照证据：`location-guard.ts:20-33` 提供 `guardDirectory` 校验（规范化+根目录包含性检查），是本仓路径进入的标准闸门——create 路径漏挂。
- 根因：客户端可控的 `location` 未经 `guardDirectory` 即被采纳，`../` 或绝对路径可将会话工作目录定位到工作区之外，后续文件读写以该目录为根。
- 影响：2级。突破目录沙箱的前提是端点已过鉴权层（非匿名），后果为越界读写面扩大；因后续操作仍多经 realpath 复核，定 2 级而非 1 级。

### 问题1修复后的代码：

```diff
--- a/src/gyccode/server/shared/handlers/session.ts
+++ b/src/gyccode/server/shared/handlers/session.ts
@@ -85,6 +85,9 @@
 export const create = (input: CreateSessionInput) =>
   Effect.gen(function* () {
+    const location = yield* guardDirectory(input.location)
+      .pipe(Effect.mapError(() => new BadRequest("invalid location")))
     return yield* insertSession({ ...input, location })
   })
```

# 问题2：session.interrupt 缺 NotFound catchTag，资源不存在时未映射 404 2级

## 问题2分析:

- 位置：`src/gyccode/server/shared/handlers/session.ts:357-361`（`interrupt` 对 `NotFound` 失败缺少 `catchTag` 映射）。
- 根因：会话不存在时底层失败以 `NotFound` 类型冒泡，但该层未捕获转换为 HTTP 语义，网关只能按未处理失败返回 500；本应 404 的场景变成服务器错误，掩盖真实原因并制造审计噪音。
- 对照证据：同文件其他按 id 操作的端点均有 `catchTag("NotFound", …)` 归一化，interrupt 为遗漏点。
- 影响：2级。错误语义错误、可被用于错误探测；不涉及数据泄露。

### 问题2修复后的代码：

```diff
--- a/src/gyccode/server/shared/handlers/session.ts
+++ b/src/gyccode/server/shared/handlers/session.ts
@@ -357,5 +357,9 @@
 export const interrupt = (sessionId: string) =>
-  interruptSession(sessionId)
+  interruptSession(sessionId).pipe(
+    Effect.catchTag("NotFound", (e) =>
+      Effect.fail(new NotFound(`session ${sessionId}`)),
+    ),
+  )
```

# 问题3：session.events 以 Stream.orDie 降级，缺陷直通 500 3级

## 问题3分析:

- 位置：`src/gyccode/server/shared/handlers/session.ts:348-355`（`session.events` 对流错误使用 `Stream.orDie`）。
- 根因：流内可恢复错误被 `orDie` 升级为 defect，绕过类型化错误通道直接 500，且事件流中断时客户端只收到突兀断连，无错误语义。
- 对照证据：错误映射应走类型化失败→明确状态码；`orDie` 仅适用于内部不变量，事件源错误（会话删除、IO 抖动）不属于该范畴。
- 影响：3级。SSE/事件流场景下的可用性与错误语义问题，需特定触发条件，无越权面。

### 问题3修复后的代码：

```diff
--- a/src/gyccode/server/shared/handlers/session.ts
+++ b/src/gyccode/server/shared/handlers/session.ts
@@ -348,7 +348,9 @@
 export const events = (sessionId: string) =>
-  eventStream(sessionId).pipe(Stream.orDie)
+  eventStream(sessionId).pipe(
+    Stream.catchAll(() => Stream.empty),
+  )
```
