注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度
# 问题1：hook.command 经 shell 解析，未做危险字符转义或白名单校验，存在命令注入风险 2级
## 问题1分析：
src/gyccode/hook/executor.ts:47 `ShellCommand.resolve(shell, hook.command, input.cwd, process.env, false)` 将用户可控的 `hook.command` 直接送入 shell 解析；:50-55 按 `useShell` 分支走 `ChildProcess.make(..., { shell })`，命令字符串经 shell 解释。攻击者可在 command 中注入 `; rm -rf /`、`$(curl ...)` 等元字符，以 hook 执行者的权限执行任意命令。
### 问题1修复后的代码：
```diff
   const spec = ShellCommand.resolve(shell, hook.command, input.cwd, process.env, false)
+  if (spec.useShell && /[;&|`$()<>]/.test(hook.command)) {
+    return Effect.succeed({
+      kind: "error" as const,
+      code: null,
+      stdout: "",
+      stderr: "",
+      error: "hook command contains shell metacharacters and is rejected",
+    })
+  }
   const stdinStream = Stream.succeed(new TextEncoder().encode(JSON.stringify(input)))
```
# 问题2：超时 kill 后 Fiber.join(stdoutFiber/stderrFiber) 可能阻塞主 fiber，超时场景卡死 2级
## 问题2分析：
src/gyccode/hook/executor.ts:78-80 超时后执行 `handle.kill`，但 kill 仅发出终止信号，子进程 stdout/stderr 流未必立即 end；:81 `yield* Fiber.join(stdoutFiber)` 直接阻塞主 fiber 等待流结束，若子进程因僵尸或缓冲区未排空而不 end，则主 fiber 挂起，超时场景卡死。
### 问题2修复后的代码：
```diff
         if (exit.kind === "timeout") {
           yield* handle.kill({ forceKillAfter: "2 seconds" }).pipe(
             Effect.catchCause(() => Effect.logWarning("failed to kill hook process after timeout", { hook: hook.event })),
           )
         }

-        const stdout = Array.from(yield* Fiber.join(stdoutFiber)).join("")
-        const stderr = Array.from(yield* Fiber.join(stderrFiber)).join("")
+        const stdout = Array.from(
+          yield* Fiber.join(stdoutFiber).pipe(Effect.timeout("5 seconds")).pipe(Effect.catchCause(() => Effect.succeed([]))),
+        ).join("")
+        const stderr = Array.from(
+          yield* Fiber.join(stderrFiber).pipe(Effect.timeout("5 seconds")).pipe(Effect.catchCause(() => Effect.succeed([]))),
+        ).join("")
         return { kind: exit.kind, code: exit.code, stdout, stderr }
```
