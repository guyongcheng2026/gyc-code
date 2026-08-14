# 决策评估：gyc-code 内核升级 opencode 2.0 以解决"吃内存"
日期：2026-08-14
依据：opencode.ai / opencode.ai/v2/docs / InfoQ《16 万 Star 的 OpenCode 彻底重写》/ 掘金《OpenCode 2.0：Bun 迁移到 Node、API、运行时、迁移避坑》 + gyc-code 源码实证

## 一、核心结论
1. opencode 2.0 解决"吃内存"的根本手段是运行时从 Bun 迁移到 Node（Bun 常驻服务长期运行内存回收不稳定，1.x 达 2GB+）；迁移后"原跑一个实例的内存，现跑多个"。
2. gyc-code 与 opencode 1.x 同根（Bun + Effect + SolidJS TUI）；heap.ts 内置 RSS>2GB 自动堆快照监控印证同源问题。"升级内核根治吃内存"实质 = 完成 Bun → Node 迁移。
3. gyc-code 迁移基础已大半就绪（数据库/PTY 双层 Node/Bun 双实现、Bun 特有 API 仅 17 处、Node v25 满足 node:sqlite、Windows 原生可跑）。
4. 彻底解决需组合拳：运行时迁移 + 多实例收敛 + 数据库保留策略 + 子进程并发限制。

## 二、opencode 2.0 内存解
- 根因：Bun 常驻内存回收不稳定 → 2GB+。
- 方法：先移除 Bun.file/Bun.write 等特有 API，核心逻辑 Node 化，再切运行时。
- 效果：官方未给数字，"原跑一个实例内存，现跑多个"。
- 其余变化（API 重做/常驻服务/Electron/热重载/跨设备）与内存无直接关系；常驻服务反吃几百 MB。

## 三、gyc-code 迁移可行性（已具备）
- 数据库：sqlite.bun.ts（@effect/sql-sqlite-bun）↔ sqlite.node.ts（node:sqlite 内置，无第三方原生依赖）——已双实现。
- PTY：pty.bun.ts（bun-pty）↔ pty.node.ts（@lydell/node-pty，含 Windows ConPTY）——已双实现。
- 抽象层：Context.Service，运行时无关。
- Bun API 面：Bun. 调用 17 处（stringWidth×10、stdin×2、file×2、write×2、hash×1）；bun: 导入 0 处。
- 运行时：Node v25.9.0，node:sqlite 实测可用。

## 四、剩余迁移成本
| 项 | 位置 | 工作量 |
|---|---|---|
| Bun.stringWidth×10 | 终端宽度，换 strip-ansi/wcwidth | 小 |
| Bun.file/write×4 | 换 node:fs/promises | 小 |
| Bun.stdin×2 | 换 process.stdin | 小 |
| Bun.hash×1 | 换 node:crypto | 小 |
| @effect/sql-sqlite-bun | driver.ts 切 @effect/sql-sqlite-node（注释已预留） | 小 |
| bun-pty→node-pty | pty 路由切换 | 小 |
| build.mjs | Bun bundle → Node bundle（esbuild 已依赖） | 中 |
| tsconfig/bin/类型 | @tsconfig/bun→node22、@types/bun、package.json bin | 小 |
| 运行期回归 | 全量测试（1291 文件、19.5 万行） | 中 |

## 五、opencode 2.0 其余变化取舍
- API 重做：不照搬（自研 API），吸收"统一消息格式/热重载 Skill"思想。
- 常驻服务：默认关（与解决吃内存目标相悖），serve 子命令保留为可选。
- 桌面端 Electron：不适用（无桌面端）。
- 热重载 Skill / 跨设备：远期能力增强，与内存无关。

## 六、彻底解决组合拳
1. 运行时迁移 Bun → Node（根治 Bun 内存回收）。
2. 多实例收敛（历史主因：3 个并存实例，只留当前）。
3. 数据库 WAL/事件保留（--prune-events=12、checkpoint TRUNCATE 保持）。
4. 子进程/LSP/PTY 并发限制（cross-spawn 上限可下调）。
5. RSS 基线监控（heap.ts 阈值 2GB→1GB，建立迁移前后对比）。

## 七、路线图
- 阶段 0（立即，零风险）：收敛多实例；heap.ts 阈值降 1GB 建基线；记录迁移前 RSS 峰值。
- 阶段 1（迁移，低-中风险）：去 Bun 特有 API（17 处）→ driver.ts 切 node → pty 切 node-pty → build.mjs 改 Node bundle → 全量测试回归。
- 阶段 2（验证）：Node 下真实会话对比 RSS；确认"原一个实例内存现跑多个"复现；决定默认 Node 或双运行时并存。

## 八、风险
1. Windows 原生是差异化优势：opencode 2.0 beta 无原生 Windows 二进制；gyc-code 用 node:sqlite+node-pty 可原生跑 Windows，迁移后优势保留增强。
2. Effect 4.0.0-beta.83 的 @effect/sql-sqlite-node 绑定需实测。
3. build.mjs 切 Node 需验证 esbuild 目标与外部依赖标记。
4. 勿照搬"常驻服务默认开"。

## 九、阶段 1 实测结果（2026-08-14 执行后追加）

### 完成情况
阶段 1（Bun → Node 运行时迁移）已全部落地并提交（9 个 commit）：
- **T0 Spike**：Node 目标构建可行；发现 4 处 `from "bun"`（node:url 替代）+ 2 处 `from "bun:"`（zed-sqlite / win32-kernel 适配层）。
- **T1**：24 处 Bun.stringWidth → displayWidth（string-width），7 文件。
- **T1A**：`#zed-sqlite` 条件适配层（bun:sqlite ↔ node:sqlite）。
- **T1B**：`#win32-kernel` 条件适配层（bun:ffi ↔ koffi）；顺带修复原代码使用了不存在的 `SetConsoleInputCP/GetConsoleInputCP`（正确为 `SetConsoleCP/GetConsoleCP`）导致输入代码页从未切换的隐藏 bug。
- **T2/T3/T4**：persistence 去 Bun.file/write；readStdin 替换 Bun.stdin×2；Bun.hash → 已有 `Hash.sha256`（期间发生一次覆盖已存在 hash.ts 的事故，已恢复原文件并修复）。
- **T5**：build.mjs 支持 `GYC_RUNTIME`（默认 node），external koffi/jsonc-parser（native/UMD 无法打包）。
- **T6/T7**：engines.node ≥22.5；bin/gyc 纯 Node 直跑 dist（不再 spawn Bun）。
- **T8**：全量测试 460 pass / 3 fail（3 个为**预存失败**：context-render.test.tsx 的 opentui "Orphan text" 渲染错误，git 基线验证改动前同样失败，与迁移无关）。

### 内存基线实测（启动 + --help 峰值 WorkingSet）
| 运行时 | 目标 | 启动峰值 RSS |
|---|---|---|
| Node v25.9 | node 目标 dist | **179.3 MB** |
| Bun 1.3.14 | bun 目标 dist | **17.8 MB** |

**重要修正**：启动/轻量命令下 Node 峰值显著高于 Bun（V8 堆开销）。opencode 2.0 "迁移 Node 降低内存"针对的是**常驻会话长期运行**（Bun 内存回收不稳定 → 无限增长，官方称 2GB+）；而非启动/峰值。因此：
- 一次性命令（--help / 单次 run）用 Bun 更省（17.8 vs 179 MB）。
- 常驻会话的收益需**阶段 2 真实会话长测**确认（Node 稳定 vs Bun 增长）。
- 双运行时并存（GYC_RUNTIME 切换）是合理策略：默认 node（目标常驻稳定性），轻量场景可 GYC_RUNTIME=bun。

### 环境限制（tsgo 假错）
TS 7.0.2（typescript-go 原生版）在中文路径（C:\Users\谷勇成）下对部分既有文件（`*.bun.ts` 等）存在**旧内容缓存假错**：修改后仍报旧版本类型错误。判断法（沿用既有经验）：复制为副本编译 0 错误则原文件为假错。T1A/T1B 均以副本验证通过。

## 十、总评
自研项目"升级到 opencode 2.0" = 跟随其 Bun → Node 迁移。gyc-code 迁移基础大半就绪，成本低-中，能根治 Bun 运行时层面的吃内存；配合多实例收敛/保留策略/并发限制可"彻底"解决。批准阶段 0+阶段 1 推进。
