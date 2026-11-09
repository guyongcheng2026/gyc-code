注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：init 失败仅 logWarning 吞掉，初始化错误不抛、后续无感知 3级

## 问题1分析

文件：`src/project/bootstrap.ts:40`

根因：`initialize` 流程中对初始化步骤的错误仅调用 `logWarning` 记录，未抛出/未转 defect，也未阻断后续逻辑。Effect 语义下，`logWarning` 不改变流的成功返回值——上层调用方拿到的是成功完成的初始化结果，对内部已发生的错误毫无感知，后续依赖该初始化产物的代码（如 store 注入、runtime 挂载）将在错误状态下继续运行。

对照证据：`bootstrap.ts:32` 处有 `logInfo` 记录启动信息，与 `:40` 的 `logWarning` 同属"记录即放过"模式；区别在于 init 失败是结构性错误，不可与普通 INFO 信息等价处理。

### 问题1修复后的代码

```diff
-    Effect.catchAll(error => Effect.logWarning(`init failed: ${error}`))
+    Effect.catchAll(error =>
+      Effect.logWarning(`init failed: ${error}`).pipe(
+        Effect.andThen(Effect.fail(error))
+      )
+    )
```
