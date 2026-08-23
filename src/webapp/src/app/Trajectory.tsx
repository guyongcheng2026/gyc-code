import { useMemo, useState } from "react"
import { Virtuoso } from "react-virtuoso"
import { useSessionHistory, type TrajectoryEvent } from "../client/useSessionHistory"

/**
 * 轨迹视图（对齐 DSH Trajectory 的核心交互子集）：
 * - 按事件顺序的记录表：索引 / 事件类型 / 内容摘要
 * - 轮次边界（turn/start 类事件）渲染较粗分隔线
 * - 点击行打开局部检查器（完整 properties）
 * - 更早历史保留首行「加载更早」控件；列表虚拟化（Virtuoso）
 */

const TURN_BOUNDARY = /^session\.(next\.)?turn\.start$|^message\.updated$/

const TYPE_LABELS: Record<string, string> = {
  "message.updated": "消息",
  "message.part.updated": "消息更新",
  "session.busy": "会话运行",
  "session.idle": "会话空闲",
  "session.next.prompt.admitted": "提示词接纳",
  "session.next.compaction.started": "压缩开始",
  "session.next.compaction.delta": "压缩输出",
  "session.next.compaction.ended": "压缩完成",
  "permission.updated": "权限请求",
  "permission.replied": "权限回复",
  "question.v2.asked": "提问",
  "question.v2.replied": "回答",
  "question.v2.rejected": "拒绝提问",
}

function labelOf(type: string): string {
  return TYPE_LABELS[type] ?? type
}

// 从事件 properties 提取一行内容摘要
function summarize(e: TrajectoryEvent): string {
  const p = e.properties ?? {}
  const info = p.info as Record<string, unknown> | undefined
  const part = p.part as Record<string, unknown> | undefined
  const text = (p.text ?? info?.error ?? part?.text) as string | undefined
  if (typeof text === "string" && text) return text.length > 80 ? `${text.slice(0, 80)}…` : text
  const tool = part?.tool as string | undefined
  if (tool) return `工具 ${tool}`
  const status = part?.state as { status?: string } | undefined
  if (status?.status) return `工具状态 ${status.status}`
  const role = info?.role as string | undefined
  if (role) return `${role} 消息落地`
  const delivery = p.delivery as string | undefined
  if (delivery) return `投递 ${delivery}`
  const title = p.title as string | undefined
  if (title) return String(title)
  return ""
}

function timeOf(e: TrajectoryEvent): string {
  const ts = e.timestamp ?? (e.properties?.timestamp as number | undefined)
  if (!ts) return ""
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false })
}

function EventRow({ e, index, selected, onSelect }: { e: TrajectoryEvent; index: number; selected: boolean; onSelect: () => void }) {
  const boundary = TURN_BOUNDARY.test(e.type) && e.type.includes("turn")
  return (
    <>
      {boundary ? <div className="traj-boundary" /> : null}
      <button
        className={selected ? "traj-row active" : "traj-row"}
        onClick={onSelect}
      >
        <span className="traj-index">{index + 1}</span>
        <span className="traj-time">{timeOf(e)}</span>
        <span className="traj-type">{labelOf(e.type)}</span>
        <span className="traj-summary">{summarize(e)}</span>
      </button>
    </>
  )
}

export function Trajectory({ sessionID, directory }: { sessionID: string | null; directory?: string }) {
  const { events, hasMore, loading, error, loadEarlier } = useSessionHistory(sessionID, directory)
  const [selectedID, setSelectedID] = useState<string | null>(null)
  const selected = useMemo(() => events.find((e) => e.id === selectedID), [events, selectedID])

  if (!sessionID) return <div className="traj-empty">选择一个会话查看轨迹</div>
  if (error) return <div className="traj-empty" style={{ color: "var(--error)" }}>{error}</div>
  if (loading && events.length === 0) return <div className="traj-empty">加载轨迹…</div>
  if (events.length === 0) return <div className="traj-empty">暂无事件记录</div>

  // 逆序展示（最新在上），加载更早=尾部
  const ordered = [...events].reverse()

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Virtuoso
          style={{ flex: 1, minHeight: 0 }}
          data={ordered}
          itemContent={(i, e) => (
            <EventRow e={e} index={events.length - 1 - i} selected={e.id === selectedID} onSelect={() => setSelectedID(e.id)} />
          )}
          components={{
            Footer: () =>
              hasMore ? (
                <button className="btn btn-ghost traj-load-earlier" disabled={loading} onClick={() => void loadEarlier()}>
                  {loading ? "加载中…" : "加载更早"}
                </button>
              ) : null,
          }}
        />
      </div>
      {selected ? (
        <div className="traj-inspector">
          <div className="traj-inspector-head">
            <span className="traj-type">{labelOf(selected.type)}</span>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "0 6px" }} onClick={() => setSelectedID(null)}>
              ✕
            </button>
          </div>
          <pre className="traj-inspector-body">{JSON.stringify(selected, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  )
}
