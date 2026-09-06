// P2：projectors 用于将事件投影到持久化存储（会话事件溯源）
// TODO: 实现 Session projector（event → session_message/part/todo projection 表写入）
// 未来支持后，initProjectors 应注册所有 projector 到 EventBus
export function initProjectors() {}
