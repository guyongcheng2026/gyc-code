# gyc-code 项目架构审查任务

gyc-code 是基于 MIT 许可的单包 TS 编码 CLI，运行于 C:\gyc-code。
1291 个 TS/TSX 文件，约 19.5 万行。

## 审查目标（四大对标基准）
1. **性能**：冷启动(<3.5s)、run 全链路(<42s)、dist 体积、初始化开销
2. **记忆**：会话记忆、跨会话持久化、上下文管理、记忆检索
3. **功能**：功能完备性、workflow(plan/tdd/review/debug/verify)、skill 系统
4. **编码能力**：编码质量、类型安全、代码精洁度、工具设计

## 五维审查（每维输出问题定位：级别/文件/行号/锚点/问题/建议）
1. **架构完整性**：模块边界、目录职责、依赖方向、数据流
2. **架构健全性**：错误处理、边界条件、资源泄漏、并发安全
3. **架构健壮性**：异常恢复、可测试性、可观测性、低意见配置下沉
4. **代码精炼度**：重复、死代码、复杂度过高的函数、可简化逻辑
5. **对标差距**：四基准各自的差距与可移植改进点

## 审查纪律
- 每个结论必须带文件路径+行号(锚点代码)
- 分级：P0(阻断/严重) / P1(重要) / P2(建议)
- 复用率口径：(重复行/总行)
- 不臆造：只看真实代码，未覆盖的明确标注"未检"

## 依赖豁免记录（2026-08-17 审查 Issue #11）

- **effect v4 beta**：违反"仅稳定版"铁律的豁免项之一。豁免原因：深度耦合（Schema/Layer/Effect 遍布 core 与 server），v3→v4 迁移成本高；且 beta 已造成生产事故（`Schema.Union` 可变参数运行时崩溃、`Schema.filter` 缺失）。
- **退出条件**：effect v4 首个 stable 发布后 48h 内升级锁定；期间新增代码禁用 v4-only 的不稳定 API（新 Schema API 先在 REPL 验证再引入）。
- **drizzle-orm 1.0.0-rc.2**：豁免项之二（2026-08-17 依赖治理时确认）。npm `latest`=0.45.2，但本项目深度依赖 v1-only API（`drizzle-orm/effect-core/*`、`drizzle-orm/cache/core/*`，见 `src/effect-drizzle-sqlite/`），无法降级到 0.45.x。**处理**：锁定在 rc.2（不上调 rc.4/rc.5），与 effect v4 beta 同款"豁免 + 迁移计划"；drizzle 1.0 stable 发布后 48h 内升级锁定。
- **依赖治理已落地（2026-08-17）**：`package.json` 全部 `^`/`~`/`*` 已固化为精确版本；webapp 专属依赖（react/react-dom/monaco/@xterm/react-virtuoso）与 typescript 已从 dependencies 移入 devDependencies（主链路 dist 入口零引用，webapp 走 vite 预构建 + 静态 manifest）。
- 其余依赖（opentui 0.4.5 / @ai-sdk\* / koffi / fuzzysort，均 MIT）均为开源稳定版，无专有依赖。

## 铁律：界面、会话与显示内容必须使用简体中文（强制）

任何时候的主界面、会话窗口、对话及显示内容都必须使用中文（简体）！无论用户输入语言、操作系统语言或其它环境因素如何，所有面向用户呈现的文字一律使用简体中文。适用范围：CLI/TUI 主界面、会话窗口、对话回复、日志、提示语、状态提示、错误信息等所有面向用户的显示内容。代码标识符、命令名、文件路径等程序性内容除外。

## 铁律：任务完成后的自我总结、归纳、学习与进化（强制）

每次任务完成后（无论成功、部分成功或失败），必须执行以下 4 步，不得跳过：

1. **总结**：用 3-5 句话概括本次任务的做了什么、结果如何、留下什么文件/命令/配置。
2. **归纳**：提炼出可复用的规律——哪些方法有效、哪些踩坑、哪些假设被验证或推翻。
3. **学习**：把关键经验沉淀为记忆/知识（写入 `docs/` 或 Obsidian 知识库，或更新本规则/相关 SKILL），让下一次同类任务直接受益。
4. **进化**：如果有可改进的流程、配置、脚本或规则，立即落地改动；如果本轮没机会，记录为待办。

触发时机：任何子任务结束、会话结束、commit 之前，都必须自检是否完成了上述 4 步。缺失即视为任务未完成。

## 工作流同步约定（每次代码改动完成后必须执行）
1. **GitHub**：提交 commit 后 `.githooks/post-commit` 自动 `git push origin HEAD`（origin 走 gh-proxy：`https://gh-proxy.com/https://github.com/guyongcheng2026/gyc-code.git`），无需手动 push。
2. **Obsidian 知识库**：同一钩子会调用 `scripts/worklog-sync.mjs`，把本次 commit 元数据（日期/hash/message/文件数）自动追加到 `E:\谷勇成的知识库\2001.我的助手工具链\gyc-code-工作流水.md`，并自动 commit（vault 的 post-commit 钩子自动推送 Gitee 与 GitHub mydoc）。脚本幂等（同 hash 跳过）、容错（失败仅写 `.git/worklog-sync.log`，不阻塞 commit）。
3. 若人工编写了**详细工作记录笔记**，同样写入该 Obsidian 目录（文件名前缀 `gyc-code-`），并提交推送 vault。
4. 运行钩子相关脚本时从仓库根目录执行：`node scripts/worklog-sync.mjs`；路径中的中文一律用 `\uXXXX` 转义，保持源码 ASCII。