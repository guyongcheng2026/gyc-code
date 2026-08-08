# gyc-code 项目架构审查任务

gyc-code 是基于 MIT 许可的单包 TS 编码 CLI，运行于 C:\Users\谷勇成\gyc-cli。
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

## 工作流同步约定（每次代码改动完成后必须执行）
1. **GitHub**：提交 commit 后 `.githooks/post-commit` 自动 `git push origin HEAD`（origin 走 gh-proxy：`https://gh-proxy.com/https://github.com/guyongcheng2026/gyc-code.git`），无需手动 push。
2. **Obsidian 知识库**：同一钩子会调用 `scripts/worklog-sync.mjs`，把本次 commit 元数据（日期/hash/message/文件数）自动追加到 `E:\谷勇成的知识库\2001.我的助手工具链\gyc-code-工作流水.md`，并自动 commit + push vault 仓库（gitee `wwkceldn/gu-yongchengs-knowledge-base`）。脚本幂等（同 hash 跳过）、容错（失败仅写 `.git/worklog-sync.log`，不阻塞 commit）。
3. 若人工编写了**详细工作记录笔记**，同样写入该 Obsidian 目录（文件名前缀 `gyc-code-`），并提交推送 vault。
4. 运行钩子相关脚本时从仓库根目录执行：`node scripts/worklog-sync.mjs`；路径中的中文一律用 `\uXXXX` 转义，保持源码 ASCII。