注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：直接变异共享对象 + all() 返回内部引用，调用方可篡改 env 快照 2级

## 问题1分析

文件：`src/env/index.ts:26-29`（直接变异共享对象）、`src/env/index.ts` 的 `all()` 返回内部引用

根因：`set` 方法（`:26-29`）直接对内部共享的 `envStore` 对象执行属性赋值变异，未做浅拷贝；`all()` 方法返回该内部对象的直接引用而非副本。后果：

1. **调用方篡改快照**：任何拿到 `all()` 返回值的代码，对其属性的新增/修改/删除会直接反映到 env 模块内部状态，绕过 `set` 方法的任何未来校验/审计钩子。这种"外部可变内部"的反封装是 OOP 封装性破坏的典型模式。
2. **并发可见性混乱**：若多个 fiber 持有 `all()` 返回值并在不同时机变异，内部状态变更顺序不可控，且无变更通知机制。
3. **快照不可重放**：本意为"环境变量快照"的对象，因被外部变异而失去快照语义，调试/审计时无法信任 `all()` 的返回值代表某一时刻的稳定状态。

对照证据：`:26` 处 `set` 不回写 `process.env`（见问题2），说明该模块对"env 是受控副本还是 process.env 的镜像"的定位本身就模糊——既不严格镜像进程环境，又不保证自身快照的不可变性。

### 问题1修复后的代码

```diff
   all(): Record<string, string> {
-    return envStore
+    return { ...envStore }
   }
```

---

# 问题2：set 不回写 process.env，子进程 extendEnv 看不到 3级

## 问题2分析

文件：`src/env/index.ts:26`

根因：`set(key, value)` 仅更新模块内部 `envStore`，不执行 `process.env[key] = value`。当 gyc-code CLI 通过 `child_process.spawn` / `Bun.spawn` 启动子进程（如 lint、构建、git）并使用 `extendEnv` 模式合并环境变量时，子进程继承的是 `process.env`，而非模块内部副本——`set` 写入的变量对子进程不可见。用户侧表现：在 env 层设置的变量（如 `NODE_ENV`、自定义路径）对子进程失效，需排查后才知是"写到了别处"。

对照证据：与问题1共同指向该模块的定位缺陷——内部 store 既非纯快照（可被外部变异）、又非 process.env 的真实镜像（不回写），处于"两头不靠"的中间态。

### 问题2修复后的代码

```diff
   set(key: string, value: string) {
     envStore[key] = value
+    process.env[key] = value
   }
```
