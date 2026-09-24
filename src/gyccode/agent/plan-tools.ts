/**
 * plan 只读模式的工具裁剪集（T1 token 优化）：在 agent.ts 的 plan permission 中
 * 配 `*:deny` → Permission.disabled 自动从每轮 tool schema 去除这些工具定义，
 * 每轮请求不再携带其描述与参数结构（省约 4-5K 字符）。
 *
 * 不含 edit/write/apply_patch：三者在 disabled 中映射到 edit permission（edit 族），
 * 需保留 plans/*.md 写入能力；切回 build agent 即恢复全量工具集。
 */
export const PLAN_PRUNED_TOOLS = [
  "bash",
  "swarm",
  "actor",
  "execute",
  "notebook_edit",
  "schedule_cron",
  "cron_delete",
  "cron_list",
  "worktree_enter",
  "worktree_exit",
  "worktree_list",
  "config",
  "peer_send",
  "mcp_authenticate",
] as const
