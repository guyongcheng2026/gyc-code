import type { QueuedPrompt } from "../client/useQueue"

// 运行中投递队列面板（对齐 DSH QueueDock）：busy 态排队/插话的消息气泡，
// 输入区上方展示，消息进入 LLM 处理（session.next.prompted）后自动移除。
export function QueueDock({ items }: { items: QueuedPrompt[] }) {
  if (items.length === 0) return null
  return (
    <div className="queue-dock">
      {items.map((item) => (
        <div key={item.messageID} className="queue-item">
          <span className={`queue-badge queue-badge-${item.delivery}`}>{item.delivery === "steer" ? "插话" : "排队"}</span>
          <span className="queue-text">{item.text}</span>
        </div>
      ))}
    </div>
  )
}