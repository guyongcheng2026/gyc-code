import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  // payload 为异构事件总线载体（session/provider/update 等各类事件），
  // 且 emit 时会就地补写 id 字段，统一结构化类型会破坏全部发布方。
  payload: any
}

class GlobalBusEmitter extends EventEmitter {
  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === "event") {
      const event = args[0] as GlobalEvent | undefined
      if (event?.payload && typeof event.payload === "object" && !("id" in event.payload)) {
        event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
      }
    }
    return super.emit(eventName, ...args)
  }
}

export const GlobalBus = new GlobalBusEmitter()
