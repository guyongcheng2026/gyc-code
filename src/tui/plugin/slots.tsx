import type { TuiPluginApi, TuiSlotContext, TuiSlotMap, TuiSlotProps } from "@gyccode/protocol/plugin/tui"
import { logError } from "@core/observability/log-error"
import { createSlot, createSolidSlotRegistry, type JSX, type SolidPlugin } from "@opentui/solid"
import { createSignal } from "solid-js"
import { isRecord } from "../util/record"

type RuntimeSlotMap = TuiSlotMap<Record<string, object>>
type SlotView = <Name extends string>(props: TuiSlotProps<Name>) => JSX.Element | null

export type HostSlotPlugin<Slots extends Record<string, object> = {}> = SolidPlugin<TuiSlotMap<Slots>, TuiSlotContext>
export type HostPluginApi = TuiPluginApi
export type HostSlots = {
  register: {
    (plugin: HostSlotPlugin): () => void
    <Slots extends Record<string, object>>(plugin: HostSlotPlugin<Slots>): () => void
  }
  dispose: () => void
}

function isHostSlotPlugin(value: unknown): value is HostSlotPlugin<Record<string, object>> {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  return isRecord(value.slots)
}

export function createSlots() {
  const empty: SlotView = () => null
  const [view, setView] = createSignal<SlotView>(empty)
  // 必须写成 JSX 表达式：solid 的 createComponent 用 untrack 包裹组件体，
  // 裸写 `return view()(props)` 只在组件体执行时求值一次、不建立订阅，
  // 于是 setup() 里的 setView 永远不会触发重渲染（表现为侧栏整体空白）。
  // 放进 JSX 后编译成 render effect，signal 读取进追踪域，setView 即重渲染。
  const Slot: SlotView = (props) => <>{view()(props)}</>

  return {
    Slot,
    setup(api: HostPluginApi): HostSlots {
      const registry = createSolidSlotRegistry<RuntimeSlotMap, TuiSlotContext>(
        api.renderer,
        { theme: api.theme },
        {
          onPluginError(event) {
            logError("tui.slot", event.error, {
              plugin: event.pluginId,
              slot: event.slot,
              phase: event.phase,
              source: event.source,
              message: event.error.message,
            })
          },
        },
      )
      const slot = createSlot<RuntimeSlotMap, TuiSlotContext>(registry)
      setView(() => (props: TuiSlotProps<string>) => slot(props))

      return {
        register(plugin: HostSlotPlugin) {
          if (!isHostSlotPlugin(plugin)) return () => {}
          return registry.register(plugin)
        },
        dispose() {
          setView(() => empty)
        },
      }
    },
    clear() {
      setView(() => empty)
    },
  }
}
