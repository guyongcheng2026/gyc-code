注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：findText 以 orDie 处理正则编译，非法 pattern 直接 defect 500 2级

## 问题1分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/file.ts:28-31`（`findText` 构造/执行正则失败路径使用 `orDie`）。
- 根因：客户端可控的 `pattern` 未经 `Effect.try` 包裹即进入正则引擎，非法正则（或超长回溯 pattern）抛出的异常被 `orDie` 升级为 defect，绕过类型化错误通道直通 500；校验层未在入口拒绝非法 pattern。
- 对照证据：同仓错误处理惯例为类型化失败→400，`orDie` 仅用于「不应发生」的内部不变量；此处 pattern 来自外部输入，不属于该范畴。
- 影响：2级。已鉴权客户端可稳定触发 500 与审计噪音（`defect` 记录），亦可借灾难性回溯消耗 CPU；非数据越权。

### 问题1修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/file.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/file.ts
@@ -28,7 +28,12 @@
-  const re = yield* Effect.try(() => new RegExp(pattern)).orDie()
+  const re = yield* Effect.try({
+    try: () => new RegExp(pattern),
+    catch: () => new BadRequest(`invalid pattern: ${pattern}`),
+  })
```

# 问题2：content 端点整文件读入内存且无大小上限 2级

## 问题2分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/file.ts:111-134`（`content` 将目标文件整体读入后返回，未检查体积）。
- 根因：读取前缺少 `File.Info.size` stat 预检，大文件（或指向大文件的合法路径）被整读进内存再序列化，单请求即可打满堆内存。
- 对照证据：同文件其他操作按需分块/按路径处理，唯独 content 为无界全量读；`filesystem.ts` 已暴露 stat 能力，修复只需复用。
- 影响：2级。已鉴权客户端可发起内存耗尽（OOM）攻击造成实例不可用；路径本身仍受根目录约束，非越权读。

### 问题2修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/file.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/file.ts
@@ -111,6 +111,13 @@
   Effect.gen(function* () {
     const path = yield* resolveWorkspacePath(file)
+    const info = yield* File.Info.stat(path)
+    if (info.size > MAX_CONTENT_BYTES) {
+      return yield* Effect.fail(
+        new BadRequest(`file too large: ${info.size} bytes`),
+      )
+    }
     const content = yield* readFileString(path)
     return { path, content }
   })
```

# 问题3：findFile 每请求 logInfo，热路径刷盘 3级

## 问题3分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/file.ts:52-59`（`findFile` 每次调用无条件 `logInfo`）。
- 根因：文件查找属高频热路径，逐请求 INFO 级落盘会快速放大审计表体积并拖慢响应；该日志对复盘价值低（无异常、无变更），按数据存储准则属噪声数据落盘。
- 对照证据：与已知热路径 INFO 刷盘问题（snapshot/index.ts、config/config.ts 等）同类，级别与频率均不匹配信息价值。
- 影响：3级。仅日志表增长与 IO 放大，无安全后果。

### 问题3修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/file.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/file.ts
@@ -52,7 +52,6 @@
   Effect.gen(function* () {
     const results = yield* searchFiles(query)
-    yield* Effect.logInfo(`findFile: ${query} -> ${results.length}`)
     return results
   })
```

**已排除项**：TOCTOU 竞态不成立——`filesystem.ts:66-71` 在使用前做二次 `realpath` 归一化校验，路径替换攻击面已被覆盖。
