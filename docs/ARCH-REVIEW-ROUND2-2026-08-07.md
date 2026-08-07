# gyc-code 架构审查报告（第二轮 — 全项目可用性核查）

日期：2026-08-07 15:20
范围：全项目（承接第一轮 docs/ARCH-REVIEW-ROUND1-2026-08-07.md），重点 = 程序是否可正常使用 + 架构级问题
方法：真实命令实测 + 静态代码核查（每条结论带文件/行号/锚点）
环境：Windows / Bun 1.3.14 / Node v25.9.0 / HEAD=375317e（工作区 clean）

## 〇、结论速览

**程序能否正常使用：部分可用。**

| 路径 | 状态 | 证据 |
|------|------|------|
| `gyc --help` / 命令注册 | ✅ 正常 | 实测输出完整命令列表 |
| TUI / run 主链路 | ✅ 前轮已验证（本轮未重跑长链路） | PERF-OPTIMIZATION 文档 |
| `gyc serve` 安全护栏 | ✅ 已落实 | serve.ts:17-29 非回环无密码拒绝启动 |
| `gyc debug config` | ❌ **运行时报错** | 实测 `InstanceRef not provided` |
| `npm start`（dist 产物） | ❌ **脚本指向不存在的文件** | package.json:15 → dist/gyc.mjs，实际产物是 dist/index.js |
| `gyc compose plan` / `gyc memory read` | ❌ **命令未注册**，落入 help | README 宣传但 index.ts 无注册 |
| Benchmark 20/20 | ⚠️ 不可复现 | 用例 03 依赖已损坏的 debug config；13/20 用例只查文件存在 |

一句话：**opencode 主干（session/tool/provider/TUI）可用且一轮 P0 已修复；但自研增量（记忆桥/Compose/基准）是未接线的展示代码，且品牌迁移引入了 2 个新的启动级断点。**

## 一、一轮 P0/P1 修复复核（全部属实）

| 一轮问题 | 复核结果 | 锚点 |
|----------|----------|------|
| P0 apply_patch move 自指删文件 | ✅ 已修 | apply_patch.ts:150-154 `movePath === filePath` 守卫 |
| P0 plugin 单 hook 失败阻断全链路 | ✅ 已修 | plugin/index.ts:285-292 每 hook tryPromise+ignore 隔离 |
| P0 plugin server() 异常被吞 | ✅ 已修 | plugin/index.ts:173-176、230 publishPluginError 恢复 |
| P1 重试回放工具二次执行 | ✅ 已修 | processor.ts:337-340 completed/error 跳过重执行 |
| P1 tokens 覆盖不累加 | ✅ 已修 | processor.ts:459-462 total 累加 |
| P1 webfetch SSRF | ⚠️ **半修**（见 P0-1） | webfetch.ts:70-80 |
| P1 符号链接逃逸 | ✅ 已修 | external-directory.ts:29-34 realpath 后再判包含 |
| P1 edit 全量读无上限 | ❌ **未修**（见 P1-6） | edit.ts:126 |

## 二、本轮新发现问题清单

### P0（阻断/严重）

**P0-1 webfetch SSRF 的 DNS rebinding 校验是死代码**
- 文件：`src/gyccode/tool/webfetch.ts:70-80`
- 锚点：
  ```ts
  if (isPrivateHost(parsedUrl.hostname)) {
    throw new Error(`URL points to a private/loopback address: ...`)
    // ↓ 以下全部位于 throw 之后、if 块之内 —— 永不执行
    const resolved = yield* Effect.tryPromise(() => lookup(...))
    if (resolved.some(isPrivateHost)) { throw ... }
  }
  ```
- 问题：提交 375317e 声称"安全修复：webfetch SSRF DNS rebinding 校验"，但 DNS 二次校验代码被错误地嵌在 `throw` 语句之后。语法合法（tsc 不报），语义上**域名走 DNS 解析到内网的 rebinding 攻击路径完全没设防**。字面量私网 IP 防护有效，域名形态无效。
- 建议：把 71 行的 `}` 补在 throw 后、DNS 校验前（3 行改动），并加一个 `lookup("localhost")` 级别的单测钉住行为。

**P0-2 `gyc debug config` 运行时 defect：InstanceRef not provided**
- 文件：实测命令；静态锚点 `src/gyccode/cli/cmd/debug/config.ts:9-13`、`src/gyccode/cli/effect-cmd.ts:84-94`、`src/gyccode/effect/instance-state.ts:14-18`
- 现象：`bun run ... debug config` → `Error: Unexpected error` + `InstanceRef not provided`（--print-logs 下可见）。
- 问题：effectCmd 默认 instance:true，已 `provideService(InstanceRef, ctx)`（effect-cmd.ts:91），但 handler 走 `Config.Service.use(cfg => cfg.get())` 仍取不到 InstanceRef。指向架构级缺陷：**Layer 构建的 app 级服务在其构建 scope 内固化了上下文，调用侧后补的 Context.Reference 传不进已 memo 的服务内部**。凡"app 级服务内部读 instance 上下文"的命令都会踩中。
- 影响：debug config 损坏；benchmark 用例 03 必然失败 → "20/20" 声明当前不可复现。
- 建议：先复现并确认 Config.get 的依赖链是否经 InstanceState.context；若是，将此类命令改为 `InstanceStore.provide(input, handler)` 包裹（instance-store.ts:189-190 已有现成 provide），让 InstanceRef 在整条 effect 链最外层提供。（本轮受执行时限未完成动态复验，标注"需复验"。）

**P0-3 `npm start` 指向不存在的产物**
- 文件：`package.json:15` `"start": "node dist/gyc.mjs"`
- 实测：dist 目录入口为 `dist/index.js`（207KB），无 gyc.mjs；且 build target=bun，node 直跑亦不成立。
- 问题：品牌迁移（bin/opencode→bin/gyc）时 start 脚本未同步，文档化的启动方式直接断链。
- 建议：改为 `"start": "bun dist/index.js"`，或让 build.mjs 输出名与脚本对齐。

### P1（重要）

**P1-1 README 宣传的 compose/memory 命令不存在**
- 文件：`src/gyccode/index.ts:98-120`（命令注册列表无 compose/memory）；`src/gyccode/composer/index.ts:49`、`src/gyccode/memory/hermes-bridge.ts` 全项目零接线（扫描确认仅 benchmark 引用）
- 实测：`gyc compose plan "test"`、`gyc memory read` 均落入 help 输出。
- 问题：README"支持的命令"列出 `gyc compose plan`、`gyc memory read/write`，与实际不符。两大卖点（记忆桥、Compose 编排）目前是**未通电的展示代码**。
- 建议：二选一 —— ① 在 index.ts 注册 composeCommands + MemoryCommand 真正接线；② 从 README 删除这两条，避免虚假能力声明。

**P1-2 双架构并行，core 层约 3 万行疑似影子实现**
- 证据：`src/core/tool/`（19 文件 2694 行，含 AGENTS.md 自述"Do not add a second executable entry type"）对外引用 = **0**（全 src 扫描 `@gyccode/core/tool/*` 命中 NONE）；`src/core/session/runner` 仅被引用 1 个常量（gyccode/session/prompt.ts:19 MAX_STEPS_PROMPT）。
- 问题：core（33k 行）与 gyccode（81k 行）存在 session/tool/permission/snapshot/event 双份实现。真实运行走 gyccode 侧；core 侧 tool/runner 疑似上游 v2 重构的未接线残留。死代码拉高审查面、误导后续修改（一轮 SSRF 修复就只改了 gyccode 侧，core/tool/webfetch.ts 无同款防护——所幸它没被引用）。
- 建议：确认 core/tool、core/session/runner 的去留：要么接线（v2 迁移），要么删除。删除前用 build 产物 diff 验证零影响。

**P1-3 hermes-bridge 的 `~` 不展开，记忆桥实际不可用**
- 文件：`src/gyccode/memory/hermes-bridge.ts:7-11`
- 锚点：`path.join(process.env.HERMES_HOME || "~/.codex", "memory", ...)`
- 问题：Node fs 不展开 `~`。HERMES_HOME 未设时，读写的是 cwd 下字面量 `~` 目录。即使接线也会静默失效。
- 建议：fallback 改 `path.join(homedir(), ".codex")`（index.ts:10 已有同款正确写法可抄）。

**P1-4 Composer.listSkills 假实现**
- 文件：`src/gyccode/composer/index.ts:43-46`
- 锚点：注释 "scans for SKILL.md files"，实现 `return ["compose", "hermes-agent", ...]` 硬编码列表。
- 建议：接 `src/gyccode/skill/discovery.ts`（真实发现器已存在），或删掉注释。

**P1-5 "类型清零"成色不足：tsconfig 未开 strict，any 仍有 148 处**
- 文件：`tsconfig.json:2-29`（无 strict/noImplicitAny）；静态扫描 `: any|as any|<any>` = 148 处
- 问题：提交声称"类型错误 193→0"，但基线是非 strict 模式；与既定编码信条"禁止 any 类型"差距明显。
- 建议：分阶段开 `strict`（先 strictNullChecks），把 any 清零列入 P1 债务；至少对新代码用 lint 卡住 any。

**P1-6 edit 工具全量读文件无大小上限（一轮遗留未修）**
- 文件：`src/gyccode/tool/edit.ts:126` `const source = yield* Bom.readFile(afs, filePath)`
- 问题：对超大文件（日志/生成物）直接整读进内存，无 stat.size 预检。read 工具有截断，edit 没有。
- 建议：stat 后对超过阈值（如 5MB）直接 fail 并提示用 write/其他路径。

**P1-7 Benchmark 20/20 的证据强度不足**
- 文件：`src/gyccode/benchmark/benchmark.test.ts:67-197`
- 问题：用例 07-20 全部只断言 `Bun.file(f).exists()`；04/05 只断言模块可 import；14-16/19/20 用"两路径任一存在"（`some(Boolean)`）回避双架构问题。文件存在 ≠ 能力可用，本轮 P0-2 已证明"存在的命令可以跑不起来"。
- 建议：把 03(config)/04(memory)/05(compose) 升级为行为断言；文件存在类用例降级为结构冒烟，不对外宣称"能力 20/20"。

**P1-8 bin/gyc 硬编码个人绝对路径**
- 文件：`bin/gyc:12-16` candidates 含 `C:\Users\谷勇成\.bun\bin\bun.exe`
- 问题：不可移植 + 泄露用户名；GYC_BUN 环境变量已覆盖该需求。
- 建议：删除硬编码行，保留 `process.env.GYC_BUN` + PATH 回退。

### P2（建议）

- **P2-1** `src/gyccode/index.ts:9-20` 手写 .env 解析：不支持引号/注释/`export ` 前缀；且仍回退读 `~/.codex/.env`（品牌残留，建议保留一个版本周期后移除）。
- **P2-2** `src/gyccode/plugin/index.ts:183-184` 空 if 块 `if (flags.pure && cfg.plugin_origins?.length) {}` —— 死代码，删。
- **P2-3** `src/gyccode/tool/registry.ts:299-301` 用 `modelID.includes("gpt-")` 决定 apply_patch/edit 分流，脆弱启发式；建议移到模型能力元数据。
- **P2-4** `src/gyccode/index.ts:153-159` finally 中 `process.exit()`：有注释说明（子进程不响应信号），但会跳过未完成的 Effect finalizer（DB WAL checkpoint 等）。继承自上游，记录在案。
- **P2-5** 空壳目录残留：`src/sdk`（1 文件）、`src/validate-session`（1 文件）。
- **P2-6** 静态卫生：any 148 处 / TODO-FIXME 212 处 / console 23 处（console 多在 CLI 调试输出，合理）。

## 三、五维总评

1. **架构完整性**：模块边界在 gyccode 层内清晰（cli/session/tool/provider 分层、LayerNode 依赖显式声明），但 core↔gyccode 存在大面积影子实现（P1-2），依赖方向出现"core 自述单一入口、实际双份"的矛盾。
2. **架构健全性**：一轮的并发/资源问题修复质量高（plugin 隔离、move 守卫、realpath 防逃逸都是对的）；新伤集中在"修复本身的正确性"（P0-1 死代码）和 Effect 上下文传播边界（P0-2）。
3. **架构健壮性**：serve 无密码拒绝上公网 ✅、heap 超 2GB 自动快照（cli/heap.ts）✅、plugin 加载失败有用户反馈 ✅；短板是错误可观测性——`debug config` 报错只剩 "Unexpected error"，cause 链要靠 --print-logs 才露出。
4. **代码精炼度**：重复率大头是双架构（约 3 万行影子代码，占总行数 ~15%）；其余函数级重复未见显著新增。
5. **对标差距**（承接一轮）：
   - 性能：冷启动 3.5s / run 41.7s，压线达标、无余量；dist 产物命名断裂（P0-3）让"dist 快路径"实际不可达，**当前真实冷启动走源码 ~4s**。
   - 记忆：跨会话记忆 = 0（hermes-bridge 未接线 + ~ bug）。
   - 功能：workflow 编排 = 静态计划文件生成器，无执行闭环；skill 系统真实存在。
   - 编码能力：非 strict + 148 any，与信条差距最大的维度。

## 四、修复优先级建议

1. P0-1 webfetch 花括号（3 行，安全）
2. P0-3 package.json start 脚本（1 行，可用性）
3. P1-1 compose/memory 接线或删 README 声明（诚实性）
4. P0-2 debug config / InstanceRef 传播（需动态复验，可能牵动 effect-cmd 包裹方式）
5. P1-2 core 影子代码去留决策（最大技术债，建议单独立项）

## 五、未检项（本轮未覆盖，明确标注）

- benchmark 全量运行（长耗时，被跳过）；models/网络类命令实测
- TUI 交互、acp、mcp add、web 界面的动态验证
- tui/（27k 行）、ui/（27k 行）仅做结构扫描，未逐文件审
- tsc --noEmit 全量复核（长耗时，被跳过；"类型清零"声明按非 strict 口径存疑）
