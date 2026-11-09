注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：clearIfStale/存在 TOCTOU 竞态，陈旧锁可能被误删 P2级
## 问题1分析:
src/gyccode/memory/file-lock.ts:54 writeFile flag:"wx" 建锁后，EEXIST 分支调用 clearIfStale（stat mtime 后 unlink），存在检查-使用间隙：另一进程在 stat 与 unlink 之间重新建锁，本进程会误删他人持有的锁，导致互斥失效。
### 问题1修复后的代码：
```diff
-        if (code === "EEXIST") {
-          await this.clearIfStale()
+        if (code === "EEXIST") {
+          const st = await stat(this.lockPath).catch(() => null)
+          if (st && Date.now() - st.mtimeMs > this.options.staleMs) {
+            await unlink(this.lockPath).catch(() => {})
+          }
         }
```
# 问题2：release() 无进程终止兜底，锁可泄漏 P2级
## 问题2分析:
src/gyccode/memory/file-lock.ts:90-101 release 仅 unlink，进程崩溃/被杀时 lock 文件残留，依赖 clearIfStale 的 staleMs（30s）才可清理，期间该路径锁不可用，存在资源泄漏与拒绝服务。
### 问题2修复后的代码：
```diff
+process.on("exit", () => this.acquired && unlink(this.lockPath).catch(() => {}))
+
 async release(): Promise<void> {
   if (this.acquired) {
     await unlink(this.lockPath).catch(() => {})
     this.acquired = false
   }
 }
```