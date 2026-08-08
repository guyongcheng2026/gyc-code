// 对标 Claude Code 的 context.ts（系统上下文构建：Git 状态、环境信息等）。
// gyc 等价实现位于 ./gyccode/session/system.ts（SystemPrompt 模块，含 git 仓库状态行）。
export * from "./gyccode/session/system"