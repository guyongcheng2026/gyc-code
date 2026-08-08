// 对标 Claude Code 的 history.ts（历史记录管理：会话历史与输入历史）。
// gyc 等价实现：
//  - 会话历史核心：./gyccode/session/message-v2.ts
//  - 输入历史环：./gyccode/cli/cmd/run/prompt.shared.ts
export * from "./gyccode/session/message-v2"