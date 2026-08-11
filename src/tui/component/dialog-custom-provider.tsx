import { TextAttributes } from "@opentui/core"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { For, Show, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useBindings } from "../keymap"
import { DialogModel } from "./dialog-model"
import {
  buildCustomProviderConfig,
  hasFormErrors,
  validateCustomProviderForm,
  type CustomProviderFormErrors,
  type CustomProviderHeaderRow,
  type CustomProviderModelRow,
} from "../util/custom-provider"

type Props = {
  initialProviderID?: string
}

type Field =
  | { type: "fixed"; field: "providerID" | "name" | "baseURL" | "apiKey" }
  | { type: "model"; row: number; col: "id" | "name" }
  | { type: "header"; row: number; col: "key" | "value" }

const FIXED_FIELDS: Array<"providerID" | "name" | "baseURL" | "apiKey"> = ["providerID", "name", "baseURL", "apiKey"]

export function DialogCustomProvider(props: Props) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const [store, setStore] = createStore({
    providerID: props.initialProviderID ?? "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: [{ id: "", name: "" }] as CustomProviderModelRow[],
    headers: [{ key: "", value: "" }] as CustomProviderHeaderRow[],
    active: 0 as number,
    errors: {} as CustomProviderFormErrors,
    busy: false as boolean,
  })

  const fieldCount = createMemo(() => 4 + store.models.length * 2 + store.headers.length * 2)

  function fieldOf(active: number): Field {
    if (active < 4) return { type: "fixed", field: FIXED_FIELDS[active]! }
    let cursor = 4
    for (let i = 0; i < store.models.length; i++) {
      if (active === cursor) return { type: "model", row: i, col: "id" }
      if (active === cursor + 1) return { type: "model", row: i, col: "name" }
      cursor += 2
    }
    for (let i = 0; i < store.headers.length; i++) {
      if (active === cursor) return { type: "header", row: i, col: "key" }
      if (active === cursor + 1) return { type: "header", row: i, col: "value" }
      cursor += 2
    }
    return { type: "fixed", field: "apiKey" }
  }

  function indexOfField(field: Field): number {
    if (field.type === "fixed") return FIXED_FIELDS.indexOf(field.field)
    if (field.type === "model") return 4 + field.row * 2 + (field.col === "id" ? 0 : 1)
    return 4 + store.models.length * 2 + field.row * 2 + (field.col === "key" ? 0 : 1)
  }

  function moveFocus(delta: number) {
    setStore("active", Math.max(0, Math.min(fieldCount() - 1, store.active + delta)))
  }

  function addModelRow() {
    setStore("models", (models) => [...models, { id: "", name: "" }])
  }

  function addHeaderRow() {
    setStore("headers", (headers) => [...headers, { key: "", value: "" }])
  }

  function removeActiveRow() {
    const field = fieldOf(store.active)
    if (field.type === "model" && store.models.length > 1) {
      setStore("models", (models) => models.filter((_, i) => i !== field.row))
      moveFocus(-2)
    }
    if (field.type === "header" && store.headers.length > 1) {
      setStore("headers", (headers) => headers.filter((_, i) => i !== field.row))
      moveFocus(-2)
    }
  }

  function focusFirstError(errors: CustomProviderFormErrors) {
    if (errors.providerID) setStore("active", 0)
    else if (errors.name) setStore("active", 1)
    else if (errors.baseURL) setStore("active", 2)
    else if (errors.models) {
      const first = Number(Object.keys(errors.models)[0])
      setStore("active", indexOfField({ type: "model", row: first, col: "id" }))
    } else if (errors.headers) {
      const first = Number(Object.keys(errors.headers)[0])
      setStore("active", indexOfField({ type: "header", row: first, col: "key" }))
    }
  }

  async function save() {
    if (store.busy) return
    const modelRows = store.models.map((row) => ({ id: row.id, name: row.name }))
    const headerRows = store.headers.map((row) => ({ key: row.key, value: row.value }))
    const errors = validateCustomProviderForm({
      providerID: store.providerID,
      name: store.name,
      baseURL: store.baseURL,
      modelRows,
      headerRows,
      existingProviderIDs: new Set(sync.data.provider_next.all.map((provider) => provider.id)),
    })
    setStore("errors", errors)
    if (hasFormErrors(errors)) {
      focusFirstError(errors)
      return
    }
    setStore("busy", true)
    const providerID = store.providerID.trim()
    const key = store.apiKey.trim()
    if (key) {
      const setResult = await sdk.client.auth.set({ providerID, auth: { type: "api", key } })
      if (setResult.error) {
        setStore("busy", false)
        toast.show({ variant: "error", message: `保存凭据失败：${JSON.stringify(setResult.error)}` })
        return
      }
    }
    const config = buildCustomProviderConfig({ providerID, name: store.name, baseURL: store.baseURL, key, modelRows, headerRows })
    const configResult = await sdk.client.config.update({ config: { provider: { [providerID]: config } } })
    if (configResult.error) {
      setStore("busy", false)
      toast.show({ variant: "error", message: `写入配置失败：${JSON.stringify(configResult.error)}` })
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    toast.show({ variant: "success", message: `已连接 ${store.name.trim()}，请选择模型` })
    dialog.replace(() => <DialogModel providerID={providerID} />)
  }

  useBindings(() => ({
    enabled: !store.busy,
    bindings: [
      { key: "tab", desc: "下一个字段", group: "对话框", cmd: () => moveFocus(1) },
      { key: "shift+tab", desc: "上一个字段", group: "对话框", cmd: () => moveFocus(-1) },
      { key: "ctrl+s", desc: "保存提供商", group: "对话框", cmd: save },
      { key: "ctrl+d", desc: "删除当前行", group: "对话框", cmd: removeActiveRow },
    ],
  }))

  onMount(() => {
    dialog.setSize("xlarge")
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>添加自定义提供商</text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>esc</text>
      </box>
      <box>
        <text fg={theme.text}>提供商 ID</text>
        <textarea
          height={3}
          focused={store.active === 0}
          initialValue={store.providerID}
          placeholder="my-gateway"
          placeholderColor={theme.textMuted}
          textColor={store.busy ? theme.textMuted : theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
          onContentChange={(value) => {
            if (typeof value !== "string") return
            setStore("providerID", value)
          }}
          onSubmit={save}
        />
        <Show when={store.errors.providerID}>
          <text fg={theme.error}>{store.errors.providerID}</text>
        </Show>
      </box>
      <box>
        <text fg={theme.text}>名称</text>
        <textarea
          height={3}
          focused={store.active === 1}
          initialValue={store.name}
          placeholder="例如：我的 API 网关"
          placeholderColor={theme.textMuted}
          textColor={store.busy ? theme.textMuted : theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
          onContentChange={(value) => {
            if (typeof value !== "string") return
            setStore("name", value)
          }}
          onSubmit={save}
        />
        <Show when={store.errors.name}>
          <text fg={theme.error}>{store.errors.name}</text>
        </Show>
      </box>
      <box>
        <text fg={theme.text}>API 地址</text>
        <textarea
          height={3}
          focused={store.active === 2}
          initialValue={store.baseURL}
          placeholder="https://api.example.com/v1"
          placeholderColor={theme.textMuted}
          textColor={store.busy ? theme.textMuted : theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
          onContentChange={(value) => {
            if (typeof value !== "string") return
            setStore("baseURL", value)
          }}
          onSubmit={save}
        />
        <Show when={store.errors.baseURL}>
          <text fg={theme.error}>{store.errors.baseURL}</text>
        </Show>
      </box>
      <box>
        <text fg={theme.text}>API key（可空，留空则使用环境变量）</text>
        <textarea
          height={3}
          focused={store.active === 3}
          initialValue={store.apiKey}
          placeholder="sk-..."
          placeholderColor={theme.textMuted}
          textColor={store.busy ? theme.textMuted : theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
          onContentChange={(value) => {
            if (typeof value !== "string") return
            setStore("apiKey", value)
          }}
          onSubmit={save}
        />
      </box>
      <box flexDirection="column">
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text}>模型</text>
          <text fg={theme.textMuted} onMouseUp={addModelRow}>+ 添加模型</text>
        </box>
        <For each={store.models}>
          {(model, i) => (
            <box flexDirection="row" gap={1}>
              <box flexDirection="column" width={30}>
                <textarea
                  height={3}
                  focused={store.active === indexOfField({ type: "model", row: i(), col: "id" })}
                  initialValue={model.id}
                  placeholder="模型 ID"
                  placeholderColor={theme.textMuted}
                  textColor={store.busy ? theme.textMuted : theme.text}
                  focusedTextColor={theme.text}
                  cursorColor={theme.text}
                  onContentChange={(value) => {
                    if (typeof value !== "string") return
                    setStore("models", i(), "id", value)
                  }}
                  onSubmit={save}
                />
                <Show when={store.errors.models?.[i()]?.id}>
                  <text fg={theme.error}>{store.errors.models?.[i()]?.id}</text>
                </Show>
              </box>
              <box flexDirection="column" width={30}>
                <textarea
                  height={3}
                  focused={store.active === indexOfField({ type: "model", row: i(), col: "name" })}
                  initialValue={model.name}
                  placeholder="显示名（可空）"
                  placeholderColor={theme.textMuted}
                  textColor={store.busy ? theme.textMuted : theme.text}
                  focusedTextColor={theme.text}
                  cursorColor={theme.text}
                  onContentChange={(value) => {
                    if (typeof value !== "string") return
                    setStore("models", i(), "name", value)
                  }}
                  onSubmit={save}
                />
                <Show when={store.errors.models?.[i()]?.name}>
                  <text fg={theme.error}>{store.errors.models?.[i()]?.name}</text>
                </Show>
              </box>
              <box flexDirection="row" alignItems="center">
                <text fg={theme.textMuted} onMouseUp={() => removeActiveRow()}>✕</text>
              </box>
            </box>
          )}
        </For>
      </box>
      <box flexDirection="column">
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text}>请求头（可选）</text>
          <text fg={theme.textMuted} onMouseUp={addHeaderRow}>+ 添加请求头</text>
        </box>
        <For each={store.headers}>
          {(header, i) => (
            <box flexDirection="row" gap={1}>
              <box flexDirection="column" width={30}>
                <textarea
                  height={3}
                  focused={store.active === indexOfField({ type: "header", row: i(), col: "key" })}
                  initialValue={header.key}
                  placeholder="Authorization"
                  placeholderColor={theme.textMuted}
                  textColor={store.busy ? theme.textMuted : theme.text}
                  focusedTextColor={theme.text}
                  cursorColor={theme.text}
                  onContentChange={(value) => {
                    if (typeof value !== "string") return
                    setStore("headers", i(), "key", value)
                  }}
                />
                <Show when={store.errors.headers?.[i()]?.key}>
                  <text fg={theme.error}>{store.errors.headers?.[i()]?.key}</text>
                </Show>
              </box>
              <box flexDirection="column" width={30}>
                <textarea
                  height={3}
                  focused={store.active === indexOfField({ type: "header", row: i(), col: "value" })}
                  initialValue={header.value}
                  placeholder="Bearer xxx"
                  placeholderColor={theme.textMuted}
                  textColor={store.busy ? theme.textMuted : theme.text}
                  focusedTextColor={theme.text}
                  cursorColor={theme.text}
                  onContentChange={(value) => {
                    if (typeof value !== "string") return
                    setStore("headers", i(), "value", value)
                  }}
                />
                <Show when={store.errors.headers?.[i()]?.value}>
                  <text fg={theme.error}>{store.errors.headers?.[i()]?.value}</text>
                </Show>
              </box>
              <box flexDirection="row" alignItems="center">
                <text fg={theme.textMuted} onMouseUp={() => removeActiveRow()}>✕</text>
              </box>
            </box>
          )}
        </For>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>
          tab / shift+tab 切换字段 · ctrl+s 保存 · ctrl+d 删除当前行
        </text>
      </box>
    </box>
  )
}
