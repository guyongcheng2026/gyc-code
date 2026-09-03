import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useSync } from "../context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@gyccode/protocol/v2"
import { DialogModel } from "./dialog-model"
import { useToast } from "../ui/toast"
import { isConsoleManagedProvider } from "../util/provider-origin"
import { useConnected } from "./use-connected"
import { useBindings } from "../keymap"
import { useClipboard } from "../context/clipboard"
import { DialogCustomProvider } from "./dialog-custom-provider"

function normalizeApiKey(raw: string, providerID: string) {
  let value = raw.trim()
  value = value.replace(new RegExp(`^${providerID}\\s*(?:zen:)?\\s*:?\\s*`, "i"), "")
  if (/^zen:/i.test(value)) value = value.replace(/^zen:/i, "")
  return value
}
const PROVIDER_PRIORITY: Record<string, number> = {
  gyccode: 0,
  "gyccode-go": 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

const CUSTOM_PROVIDER_OPTION_VALUE = "__gyccode_custom_provider__"
const CUSTOM_PROVIDER_WIZARD_VALUE = "__gyccode_custom_provider_wizard__"

/**
 * 自定义供应商 6 步向导（对标 mimo-code TUI 流程）
 * 支持任意 OpenAI 兼容供应商，无需在 models.dev 目录中注册
 */
async function runCustomProviderWizard(opts: {
  dialog: ReturnType<typeof useDialog>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
}) {
  const { dialog, sdk, sync, toast } = opts

  function step(n: number, total: number, title: string, placeholder?: string, value?: string) {
    return DialogPrompt.show(dialog, `${title} (${n}/${total})`, { placeholder, value })
  }

  const providerIDRaw = await step(1, 6, "供应商 ID", "例如 zhipu")
  if (providerIDRaw === null) return
  const providerID = providerIDRaw.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-")
  if (!providerID) return

  const nameRaw = await step(2, 6, "显示名称", "例如 智谱 AI", providerID)
  if (nameRaw === null) return
  const name = nameRaw.trim() || providerID

  const baseURLRaw = await step(3, 6, "API 地址", "https://open.bigmodel.cn/api/paas/v4")
  if (baseURLRaw === null) return
  const baseURL = baseURLRaw.trim()
  if (!baseURL) return

  const apiKeyRaw = await step(4, 6, "API Key", "sk-...")
  if (apiKeyRaw === null) return
  const apiKey = apiKeyRaw.trim()
  if (!apiKey) return

  const modelIDRaw = await step(5, 6, "模型 ID", "例如 glm-4-flash")
  if (modelIDRaw === null) return
  const modelID = modelIDRaw.trim()
  if (!modelID) return

  const modelNameRaw = await step(6, 6, "模型名称", "例如 GLM-4 Flash", modelID)
  if (modelNameRaw === null) return
  const modelName = modelNameRaw.trim() || modelID

  // 构建配置（与 mimo-code 对齐：npm 固定为 @ai-sdk/openai-compatible）
  const envKey = `${providerID.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`
  const config = {
    name,
    npm: "@ai-sdk/openai-compatible",
    env: [envKey],
    options: {
      baseURL,
      setCacheKey: true,
    },
    models: {
      [modelID]: {
        name: modelName,
      },
    },
  }

  // 写入配置
  const configResult = await sdk.client.config.update({
    config: { provider: { [providerID]: config } },
  })
  if (configResult.error) {
    toast.show({ variant: "error", message: `写入配置失败：${JSON.stringify(configResult.error)}` })
    return
  }

  // 保存 API Key
  const authResult = await sdk.client.auth.set({
    providerID,
    auth: { type: "api", key: apiKey },
  })
  if (authResult.error) {
    toast.show({ variant: "error", message: `保存凭据失败：${JSON.stringify(authResult.error)}` })
    return
  }

  // 重新初始化
  await sdk.client.instance.dispose()
  await sync.bootstrap()
  toast.show({ variant: "success", message: `已连接 ${name} · ${modelID}` })
  dialog.replace(() => <DialogModel providerID={providerID} />)
}


type ProviderOptionBase = {
  title: string
  value: string
  description?: string
  category: string
}

type ProviderOption =
  | (ProviderOptionBase & {
      type: "provider"
      providerID: string
    })
  | (ProviderOptionBase & {
      type: "custom"
    })
  | (ProviderOptionBase & {
      type: "wizard"
    })

export function providerOptions(list: { id: string; name: string }[]): ProviderOption[] {
  return [
    ...pipe(
      list,
      sortBy(
        (x) => PROVIDER_PRIORITY[x.id] ?? 99,
        (x) => x.name.toLowerCase(),
        (x) => x.id,
      ),
      map((provider) => ({
        type: "provider" as const,
        title: provider.name,
        value: provider.id,
        providerID: provider.id,
        description: {
          gyccode: "(Recommended)",
          anthropic: "(API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
          "gyccode-go": "人人可用的低成本订阅",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "热门" : "提供商",
      })),
    ),
    {
      type: "custom",
      title: "其他（目录内）",
      value: CUSTOM_PROVIDER_OPTION_VALUE,
      description: "搜索目录中的提供商与 LLM",
      category: "提供商",
    },
    {
      type: "wizard",
      title: "+ 添加自定义供应商",
      value: CUSTOM_PROVIDER_WIZARD_VALUE,
      description: "任意 OpenAI 兼容 API",
      category: "提供商",
    } as const,
  ]
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const onboarded = useConnected()

  const options = createMemo(() => {
    return pipe(
      providerOptions(sync.data.provider_next.all),
      map((provider) => {
        if (provider.type === "custom") {
          return {
            title: provider.title,
            value: provider.value,
            description: provider.description,
            category: provider.category,
            async onSelect() {
              return dialog.replace(() => <DialogCustomProvider />)
            },
          }
        }

        if (provider.type === "wizard") {
          return {
            title: provider.title,
            value: provider.value,
            description: provider.description,
            category: provider.category,
            async onSelect() {
              return runCustomProviderWizard({ dialog, sdk, sync, toast })
            },
          }
        }

        const providerID = provider.providerID
        const consoleManaged = isConsoleManagedProvider(sync.data.console_state.consoleManagedProviders, providerID)
        const connected = sync.data.provider_next.connected.includes(providerID)

        return {
          title: provider.title,
          value: provider.value,
          description: provider.description,
          footer: consoleManaged ? sync.data.console_state.activeOrgName : undefined,
          category: provider.category,
          gutter: connected && onboarded() ? () => <text fg={theme.success}>✓</text> : undefined,
          async onSelect() {
            if (consoleManaged) return

            const methods = sync.data.provider_auth[providerID] ?? [
              {
                type: "api",
                label: "API key",
              },
            ]
            let index: number | null = 0
            if (methods.length > 1) {
              index = await new Promise<number | null>((resolve) => {
                dialog.replace(
                  () => (
                    <DialogSelect
                      title="选择认证方式"
                      options={methods.map((x, index) => ({
                        title: x.label,
                        value: index,
                      }))}
                      onSelect={(option) => resolve(option.value)}
                    />
                  ),
                  () => resolve(null),
                )
              })
            }
            if (index == null) return
            const method = methods[index]
            if (method.type === "oauth") {
              let inputs: Record<string, string> | undefined
              if (method.prompts?.length) {
                const value = await PromptsMethod({
                  dialog,
                  prompts: method.prompts,
                })
                if (!value) return
                inputs = value
              }

              const result = await sdk.client.provider.oauth.authorize({
                providerID,
                method: index,
                inputs,
              })
              if (result.error) {
                toast.show({
                  variant: "error",
                  message: JSON.stringify(result.error),
                })
                dialog.clear()
                return
              }
              if (result.data?.method === "code") {
                dialog.replace(() => (
                  <CodeMethod providerID={providerID} title={method.label} index={index} authorization={result.data!} />
                ))
              }
              if (result.data?.method === "auto") {
                dialog.replace(() => (
                  <AutoMethod providerID={providerID} title={method.label} index={index} authorization={result.data!} />
                ))
              }
            }
            if (method.type === "api") {
              let metadata: Record<string, string> | undefined
              if (method.prompts?.length) {
                const value = await PromptsMethod({ dialog, prompts: method.prompts })
                if (!value) return
                metadata = value
              }
              return dialog.replace(() => (
                <ApiMethod providerID={providerID} title={method.label} metadata={metadata} />
              ))
            }
          },
        }
      }),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="连接提供商" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const clipboard = useClipboard()

  useBindings(() => ({
    bindings: [
      {
        key: "c",
        desc: "复制服务商代码",
        group: "Dialog",
        cmd: () => {
          const code =
            props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
          clipboard
            .write?.(code)
            .then(() => toast.show({ message: "已复制到剪贴板", variant: "info" }))
            .catch(toast.error)
        },
      },
    ],
  }))

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      toast.show({
        variant: "error",
        message:
          "name" in result.error && result.error.name === "ProviderAuthOauthCallbackFailed"
            ? "OAuth 授权失败。请重试 /connect。"
            : JSON.stringify(result.error),
      })
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>正在等待授权...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="授权代码"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>无效代码</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
  metadata?: Record<string, string>
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={() =>
        ({
          gyccode: (
            <box gap={1}>
              <text fg={theme.textMuted}>
                GycCode 云模型服务：一个 API Key 即可以优惠价格访问多款主流编码模型。
              </text>
              <text fg={theme.text}>前往官方网站获取 API Key</text>
            </box>
          ),
          "gyccode-go": (
            <box gap={1}>
              <text fg={theme.textMuted}>
                GycCode 云模型订阅（月付），稳定访问多款主流开源编码模型，并提供宽裕的使用额度。
              </text>
              <text fg={theme.text}>前往官方网站启用订阅</text>
            </box>
          ),
        })[props.providerID] ?? undefined
      }
      onConfirm={async (raw) => {
        const value = normalizeApiKey(raw, props.providerID)
        if (!value) return
        const setResult = await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
            ...(props.metadata ? { metadata: props.metadata } : {}),
          },
        })
        if (setResult.error) {
          toast.show({
            variant: "error",
            message: `保存凭据失败：${props.providerID} ${JSON.stringify(setResult.error)}`,
          })
          return
        }
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}

interface PromptsMethodProps {
  dialog: ReturnType<typeof useDialog>
  prompts: NonNullable<ProviderAuthMethod["prompts"]>[number][]
}
async function PromptsMethod(props: PromptsMethodProps) {
  const inputs: Record<string, string> = {}
  for (const prompt of props.prompts) {
    if (prompt.when) {
      const value = inputs[prompt.when.key]
      if (value === undefined) continue
      const matches = prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
      if (!matches) continue
    }

    if (prompt.type === "select") {
      const value = await new Promise<string | null>((resolve) => {
        props.dialog.replace(
          () => (
            <DialogSelect
              title={prompt.message}
              options={prompt.options.map((x) => ({
                title: x.label,
                value: x.value,
                description: x.hint,
              }))}
              onSelect={(option) => resolve(option.value)}
            />
          ),
          () => resolve(null),
        )
      })
      if (value === null) return null
      inputs[prompt.key] = value
      continue
    }

    const value = await new Promise<string | null>((resolve) => {
      props.dialog.replace(
        () => (
          <DialogPrompt title={prompt.message} placeholder={prompt.placeholder} onConfirm={(value) => resolve(value)} />
        ),
        () => resolve(null),
      )
    })
    if (value === null) return null
    inputs[prompt.key] = value
  }
  return inputs
}
