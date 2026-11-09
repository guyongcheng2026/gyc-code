注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：addSandbox/removeSandbox 读-改-写无事务，存在竞态 2级

## 问题1分析

文件：`src/project/project.ts:419-431`（addSandbox）、`src/project/project.ts:436-448`（removeSandbox）

根因：两处均采用"读取当前 sandbox 列表 → 内存变异 → 写回"的经典读-改-写模式，全程无文件锁、无 CAS、无重试。多进程/并发会话同时调用时，后写入者覆盖先写入者的变更，导致 sandbox 增删丢失。Effect 的并发模型虽以单 fiber 为主，但 gyc-code CLI 存认多会话/多进程场景（配置层已见 `EffectFlock` 依赖），竞态并非理论存在。

对照证据：`config/config.ts` 中 `updateGlobal` 同样存在无锁写回问题（另见对应报告），说明全仓库对"读-改-写需加锁"的纪律缺失，而非本文件孤立问题。

### 问题1修复后的代码

```diff
-  Effect.gen(function* () {
-    const current = yield* readSandboxList()
-    const next = [...current, sandbox]
-    yield* writeSandboxList(next)
-  })
+  Effect.gen(function* () {
+    yield* EffectFlock.acquire(sandboxLockPath)
+    const current = yield* readSandboxList()
+    const next = [...current, sandbox]
+    yield* writeSandboxList(next)
+  }).pipe(Effect.ensuring(EffectFlock.release(sandboxLockPath)))
```

---

# 问题2：Effect 内裸 throw 变 defect，绕过 catchAll 3级

## 问题2分析

文件：`src/project/project.ts:369`、`src/project/project.ts:372`、`src/project/project.ts:420`

根因：在 `Effect.gen` / `Effect.fn` 体内直接 `throw new Error(...)`，在 Effect 运行时中该 throw 不被翻译为 `Fail`，而被翻译为 `Die`（defect）。defect 不被 `Effect.catchAll` 捕获，意味着这些校验失败会直接击穿到顶层运行时，触发整个会话/任务的不可恢复崩溃，而非降级为业务可处理的失败。

对照证据：仓库其他 Effect 代码（如 `config/config.ts:259/:262/:270`）已存在 `Effect.die` 同类问题，属全仓风格性缺陷——开发者误以为 Effect 体内 `throw` 等价于 `Effect.fail`。

### 问题2修复后的代码

```diff
-    throw new Error("invalid sandbox path")
+    yield* Effect.fail(new Error("invalid sandbox path"))
```

---

# 问题3：硬编码 "/" 作为根路径哨兵 3级

## 问题3分析

文件：`src/project/project.ts:218`

根因：使用字符串字面量 `"/"` 作为"已到文件系统根"的判定哨兵。在 Windows 上文件系统根为盘符（如 `C:\`）而非 `/`，POSIX 路径工具对 `C:\` 的分割结果与 `"/"` 全等判定永远为 false，可能导致上溯循环无法终止或提前误判到达根。对照 `fs-util.ts:168-182` 的 `up` 实现已暴露同类"stop 判定不可靠"问题（见 paths 报告），本处是同一根因的另一处显化。

对照证据：`config/paths.ts` 依赖 `fs-util.ts` 的 `up` 逻辑，`up` 的 stop 判定缺陷会直接影响本文件 `:218` 的语义——两者是上下游耦合的同一类问题。

### 问题3修复后的代码

```diff
-  if (current === "/") return
+  const root = path.parse(current).root
+  if (current === root) return
```
