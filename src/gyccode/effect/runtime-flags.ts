import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("GYCCODE_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export class Service extends ConfigService.Service<Service>()("@gyccode/RuntimeFlags", {
  autoShare: bool("GYCCODE_AUTO_SHARE"),
  pure: bool("GYCCODE_PURE"),
  disableDefaultPlugins: bool("GYCCODE_DISABLE_DEFAULT_PLUGINS"),
  disableEmbeddedWebUi: bool("GYCCODE_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("GYCCODE_DISABLE_EXTERNAL_SKILLS"),
  disableComposeSkills: bool("GYCCODE_DISABLE_COMPOSE_SKILLS"),
  disableLspDownload: bool("GYCCODE_DISABLE_LSP_DOWNLOAD"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("GYCCODE_DISABLE_CLAUDE_CODE"),
    direct: bool("GYCCODE_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("GYCCODE_DISABLE_CLAUDE_CODE"),
    direct: bool("GYCCODE_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableCodexSkills: bool("GYCCODE_DISABLE_CODEX_SKILLS"),
  disableOpenCodeSkills: bool("GYCCODE_DISABLE_OPENCODE_SKILLS"),
  disableAutocompact: bool("GYCCODE_DISABLE_AUTOCOMPACT"),
  disableModelsFetch: bool("GYCCODE_DISABLE_MODELS_FETCH"),
  disableProjectConfig: bool("GYCCODE_DISABLE_PROJECT_CONFIG"),
  disableGit: bool("GYCCODE_DISABLE_GIT"),
  disableShare: bool("GYCCODE_DISABLE_SHARE"),
  disableMouse: bool("GYCCODE_DISABLE_MOUSE"),
  disableTerminalTitle: bool("GYCCODE_DISABLE_TERMINAL_TITLE"),
  disablePrune: bool("GYCCODE_DISABLE_PRUNE"),
  disableAutoupdate: bool("GYCCODE_DISABLE_AUTOUPDATE"),
  enableDebugWorkspace: bool("GYCCODE_ENABLE_DEBUG_WORKSPACE"),
  enableExa: Config.all({
    experimental,
    enabled: bool("GYCCODE_ENABLE_EXA"),
    legacy: bool("GYCCODE_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("GYCCODE_ENABLE_PARALLEL"),
    legacy: bool("GYCCODE_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("GYCCODE_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("GYCCODE_ENABLE_QUESTION_TOOL"),
  experimentalReferences: enabledByExperimental("GYCCODE_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: enabledByExperimental("GYCCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalLspTy: bool("GYCCODE_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("GYCCODE_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("GYCCODE_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("GYCCODE_EXPERIMENTAL_PLAN_MODE"),
  experimentalCodeMode: enabledByExperimental("GYCCODE_EXPERIMENTAL_CODE_MODE"),
  experimentalEventSystem: enabledByExperimental("GYCCODE_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("GYCCODE_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("GYCCODE_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("GYCCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("GYCCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("GYCCODE_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("GYCCODE_EXPERIMENTAL_WEBSOCKETS"),
  client: Config.string("GYCCODE_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const node = LayerNode.make({ service: Service, layer: Service.layer.pipe(Layer.orDie), deps: [] })

export * as RuntimeFlags from "./runtime-flags"
import { LayerNode } from "@gyccode/core/effect/layer-node"
