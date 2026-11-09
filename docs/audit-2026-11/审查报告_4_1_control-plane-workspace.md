注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：create 透传 auth.all() 到子进程环境变量，存在敏感凭据泄露 P0级
## 问题1分析:
src/gyccode/control-plane/workspace.ts:530 `GYCCODE_AUTH_CONTENT: JSON.stringify(yield* auth.all())` 将全部鉴权信息写入子进程环境，子进程或其调用的外部命令可读取全部凭据，属敏感信息泄露。
### 问题1修复后的代码：
```diff
-        GYCCODE_AUTH_CONTENT: JSON.stringify(yield* auth.all()),
+        // 不透传完整凭据，仅透传工作空间上下文所需的最小标识
+        GYCCODE_WORKSPACE_ID: config.id,
```
# 问题2：远程 HTTP 响应失败均静默降级为 fallback，无审计与重试 P1级
## 问题2分析:
src/gyccode/control-plane/workspace.ts:281 runInWorkspace 的 http.execute 失败仅 Effect.logWarning 并 as(undefined)，降级返回 fallback，远程工作空间异常不可见、不可追溯，违反审计留痕铁律。
### 问题2修复后的代码：
```diff
-        ).pipe(Effect.catch((error) => Effect.logWarning(...).pipe(Effect.as(undefined))))
+        ).pipe(Effect.catch((error) => Effect.fail(new SyncHttpError({ message: String(error), status: 0, body: undefined }))))
```