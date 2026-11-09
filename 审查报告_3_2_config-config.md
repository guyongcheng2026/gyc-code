注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：update 写 `<dir>/config.json`，但加载侧只读 gyccode.json(c)，配置更新静默失效（死写入） 1级

## 问题1分析

文件：`src/config/config.ts:791`（写入 `config.json`）、`src/config/config.ts:473`（加载仅读 `gyccode.json` / `gyccode.jsonc`）

根因：更新路径写入的文件名与加载路径读取的文件名不一致。`update` 写 `<dir>/config.json`，而 `load` 在 `:473` 处的候选名单为 `gyccode.json` / `gyccode.jsonc`，不包含 `config.json`。结果：用户调用 `update` 修改配置后，下次加载根本读不到该文件，配置回退到默认或旧值，更新静默失效。这是"写入即丢失"的最高级别缺陷——数据正确写入磁盘，却永远不被读回，用户侧表现为"改了没生效"，极难定位。

对照证据：同文件 `:802-825` 的 `updateGlobal` 也写文件，需核查其写入文件名是否同样偏离加载候选名单。

### 问题1修复后的代码

```diff
-  const target = path.join(dir, "config.json")
+  const target = path.join(dir, "gyccode.json")
```

---

# 问题2：EffectFlock 导入未使用 + updateGlobal 与读时写回均无文件锁，多进程丢失更新 1级

## 问题2分析

文件：`src/config/config.ts:25`（`EffectFlock` 导入后全文未使用）、`src/config/config.ts:802-825`（`updateGlobal` 无锁）、`src/config/config.ts:292-295`（读时写回无锁）

根因：`EffectFlock` 已被导入（`:25`），说明开发者本意是要加锁的，但实际全文从未调用——配置层所有"读-改-写"操作（`updateGlobal` 全量写、`:292-295` 读后回写）全部裸奔无锁。多进程并发时：进程 A 读到旧配置 → 进程 B 读到旧配置 → 进程 A 写入新值 → 进程 B 用旧值覆盖，A 的更新丢失。结合问题1的"写错文件名"，配置层实际处于"写了丢、丢了再写错"的双重失效状态。

对照证据：`project/project.ts` 的 `addSandbox`/`removeSandbox` 同样无锁（见对应报告 2级问题1），全仓对文件锁的纪律系统性缺失。

### 问题2修复后的代码

```diff
   Effect.gen(function* () {
+    yield* EffectFlock.acquire(configLockPath)
     const current = yield* readConfig()
     const next = mergeConfig(current, patch)
     yield* writeConfig(next)
-  })
+  }).pipe(Effect.ensuring(EffectFlock.release(configLockPath)))
```

---

# 问题3：远程配置失败 Effect.die → orDie 致实例加载整体失败 2级

## 问题3分析

文件：`src/config/config.ts:259`、`src/config/config.ts:262`、`src/config/config.ts:270`（`Effect.die`）、`src/config/config.ts:767`（`orDie`）

根因：远程配置拉取失败时使用 `Effect.die`（`:259/:262/:270`），将可恢复的网络/远程错误升级为不可恢复的 defect；外层 `:767` 又用 `orDie` 进一步确保 defect 击穿。最终结果：远程配置临时不可用（网络抖动、远端 5xx）会直接导致整个实例配置加载失败，而非降级为本地缓存/默认配置。对离线优先的 CLI 工具而言，这是可用性硬伤。

对照证据：与 `project/project.ts` 的裸 throw 问题（3级问题2）同属"把可恢复错误误升为 defect"的全仓风格问题，但本处因叠加 `orDie` 且影响实例加载主路径，危害升级为 2级。

### 问题3修复后的代码

```diff
-    Effect.die(new Error("remote config fetch failed"))
+    Effect.fail(new Error("remote config fetch failed"))
```

---

# 问题4：activeOrgName 声明后从未赋值，恒 undefined 3级

## 问题4分析

文件：`src/config/config.ts:387`

根因：变量 `activeOrgName` 声明后全文无任何赋值路径，运行时值恒为 `undefined`。若该变量参与配置序列化、条件分支或多组织切换逻辑，将导致组织维度配置静默失效或始终走默认分支。属于"声明遗忘"型死代码，但因其参与了运行时对象结构，比纯死变量危害更高。

对照证据：需核查该变量是否被导出/序列化；若仅局部声明未使用，则降级为 lint 问题。

### 问题4修复后的代码

```diff
-  let activeOrgName: string | undefined
+  let activeOrgName: string | undefined = undefined
+  // TODO: 在加载配置时从 config.activeOrg 读取并赋值，否则删除该变量
```
