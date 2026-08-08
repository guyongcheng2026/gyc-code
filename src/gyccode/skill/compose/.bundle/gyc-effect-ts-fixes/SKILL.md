---
name: gyc-effect-ts-fixes
description: Use when 修复 gyc-cli 的 TypeScript/effect 类型错误（node tsc 或 bun tsc --noEmit 报错），尤其是 effect 4.0 API 变更、嵌套 Effect、Option/Size 类型与 bun tsc 缓存假错
---

# gyc effect 4.0 + TypeScript 类型修复

## Overview

gyc 使用 effect 4.0.0-beta.83（API 较旧版有破坏性变更）+ Bun 构建。类型错误分两类：**真实代码 bug**（必须修逻辑）与**依赖类型噪音**（最小改动规避）。

## 常见模式与修复

### 1. effect 4.0 API 变更
- Effect.catchAll(...) 改成 **Effect.catch(...)**（4.0 改名）
- Schema.optional(X, { default: ... }) 改成 **Schema.optional(X)**（只接受 1 参；默认值用调用处空值合并兜底）
- Stream.runForEach(stream, cb) 的 cb 必须**返回 Effect**（用 Effect.sync 包裹），不能返回 void
- Effect.orDie、Effect.fn 可用（4.0 保留）

### 2. 嵌套 Effect（真实 bug）
Effect.gen 内 `return Effect.fail(...)` 是**值返回**不扁平化，类型会变嵌套 Effect。必须 **`return yield* Effect.fail(...)`**。同理 Effect.die / Effect.succeed 都要 yield*。

### 3. Option / Size 类型
- fs.stat 返回的 mtime 是 Option<Date>、size 是 Size（branded）
- 用 Option.getOrUndefined(stat.mtime)?.getTime?.()、Number(stat.size) 转普通值
- 传给自定义 StatLike（mtime?: Date; size?: number）时先转换

### 4. bun tsc 缓存假错（重要）
bun run --conditions=browser tsc 基于 **mtime 缓存**：edit 工具改文件后可能不更新 mtime，导致 tsc 用旧内容报**假错误**。对策：
- 用 **node node_modules/typescript/bin/tsc --noEmit**（无缓存，权威）
- 或 touch 改动文件刷新 mtime 再跑 bun tsc
- 判断方法：同一文件复制成副本无报错、原文件报错，则是缓存

### 5. yargs 类型
- yargs.Argv 命名空间不可用，改用 **import type { Argv } from "yargs"**（项目一致做法）

### 6. 泛型参数
- Tool.define 需要 3 个类型参数（R 环境，补 never）
- 泛型访问缺失属性（如 T.ready）：用 `as T & { ready?: boolean }` 断言

### 7. JSX Provider 类型（opentui/solid）
- createMemo(...) 返回 Accessor 不是合法 JSX 组件返回，用 `as unknown as JSX.Element` 断言（Solid 支持返回渲染函数，仅类型断言）

## 验证

- 修复后：node node_modules/typescript/bin/tsc --noEmit **0 错误**（以 node 为准）
- 确认改动文件不在报错列表（grep 报错文件名）
- bun run test 全绿

## Common Mistakes

- 把真实 bug（嵌套 Effect、Option 误用）当"类型噪音"跳过，导致运行时行为异常
- 用 bun tsc 判断真伪（缓存假错误导）
- 盲目升级依赖"修类型"（高风险）
- 为小收益引入缓存失效管理复杂度（按 Simplicity 跳过低价值项）
