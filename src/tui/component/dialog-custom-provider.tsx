import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { filter, map, pipe, sortBy } from "remeda"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { DialogSelect } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogModel } from "./dialog-model"

type Props = {
  initialProviderID?: string
}

// 参照 opencode 的「提供商 + LLM」两步连接：选定目录内提供商与模型后，
// 写入 { name, models } 增量配置（API 地址与模型能力由服务端从模型目录自动补全），
// 并将凭据落库（环境变量已有则直接采用，否则提示输入），确保提供商在
// enabled_providers 白名单之外也能被激活。
export function DialogCustomProvider(props: Props) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const [providerID, setProviderID] = createSignal(props.initialProviderID ?? "")
  const [busy, setBusy] = createSignal(false)

  const catalogProvider = createMemo(() =>
    sync.data.provider_next.all.find((provider) => provider.id === providerID()),
  )

  const providerOptions = createMemo(() =>
    pipe(
      sync.data.provider_next.all,
      sortBy(
        (provider) => provider.name.toLowerCase(),
        (provider) => provider.id,
      ),
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        description: provider.id,
        footer: `${Object.keys(provider.models).length} 个模型`,
      })),
    ),
  )

  const modelOptions = createMemo(() => {
    const provider = catalogProvider()
    if (!provider) return []
    return pipe(
      Object.entries(provider.models),
      filter(([_, info]) => info.status !== "deprecated"),
      sortBy(([id, info]) => (info.name ?? id).toLowerCase()),
      map(([id, info]) => ({
        title: info.name ?? id,
        value: id,
        description: info.name && info.name !== id ? id : undefined,
      })),
    )
  })

  function envCredential(provider: { env: string[] }) {
    return provider.env.map((name) => process.env[name]).find(Boolean)
  }

  function supportsApiKey(providerID: string) {
    const methods = sync.data.provider_auth[providerID]
    if (!methods || methods.length === 0) return true
    return methods.some((method) => method.type === "api")
  }

  async function finishConnect(modelID: string, apiKey?: string) {
    const provider = catalogProvider()
    if (!provider) return
    if (apiKey) {
      const authResult = await sdk.client.auth.set({ providerID: provider.id, auth: { type: "api", key: apiKey } })
      if (authResult.error) {
        toast.show({ variant: "error", message: `保存凭据失败：${JSON.stringify(authResult.error)}` })
        return
      }
    }
    const configResult = await sdk.client.config.update({
      config: { provider: { [provider.id]: { name: provider.name, models: { [modelID]: {} } } } },
    })
    if (configResult.error) {
      toast.show({ variant: "error", message: `写入配置失败：${JSON.stringify(configResult.error)}` })
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    toast.show({ variant: "success", message: `已连接 ${provider.name} · ${modelID}` })
    dialog.replace(() => <DialogModel providerID={provider.id} />)
  }

  function onModelSelected(modelID: string) {
    const provider = catalogProvider()
    if (!provider || busy()) return
    const connected = sync.data.provider_next.connected.includes(provider.id)
    const credential = envCredential(provider)
    if (connected || credential) {
      setBusy(true)
      void finishConnect(modelID, credential).finally(() => setBusy(false))
      return
    }
    if (!supportsApiKey(provider.id)) {
      toast.show({
        variant: "warning",
        message: `${provider.name} 需要 OAuth 授权，请在提供商列表中选择它完成认证`,
      })
      return
    }
    dialog.replace(() => (
      <DialogPrompt
        title={`输入 ${provider.name} 的 API Key`}
        placeholder={provider.env[0] ?? "API key"}
        onConfirm={(value) => {
          if (!value) return
          setBusy(true)
          void finishConnect(modelID, value).finally(() => setBusy(false))
        }}
      />
    ))
  }

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <Show
      when={catalogProvider()}
      fallback={
        <DialogSelect
          title="选择提供商"
          placeholder="输入提供商名称或 ID"
          options={providerOptions()}
          onSelect={(option) => setProviderID(option.value)}
          footer={
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.text }}>两步完成连接</span>
              {" · 目录外网关请编辑配置文件的 provider 段"}
            </text>
          }
        />
      }
    >
      <DialogSelect
        title={`选择 LLM · ${catalogProvider()?.name ?? ""}`}
        placeholder="输入模型 ID 或名称"
        options={modelOptions()}
        onSelect={(option) => onModelSelected(option.value)}
        footer={
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            回车连接该模型
          </text>
        }
      />
    </Show>
  )
}
