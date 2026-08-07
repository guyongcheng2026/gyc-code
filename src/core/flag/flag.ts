import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["GYCCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["GYCCODE_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("GYCCODE_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  GYCCODE_AUTO_HEAP_SNAPSHOT: truthy("GYCCODE_AUTO_HEAP_SNAPSHOT"),
  GYCCODE_GIT_BASH_PATH: process.env["GYCCODE_GIT_BASH_PATH"],
  GYCCODE_CONFIG: process.env["GYCCODE_CONFIG"],
  GYCCODE_CONFIG_CONTENT: process.env["GYCCODE_CONFIG_CONTENT"],
  GYCCODE_DISABLE_AUTOUPDATE: truthy("GYCCODE_DISABLE_AUTOUPDATE"),
  GYCCODE_ALWAYS_NOTIFY_UPDATE: truthy("GYCCODE_ALWAYS_NOTIFY_UPDATE"),
  GYCCODE_DISABLE_PRUNE: truthy("GYCCODE_DISABLE_PRUNE"),
  GYCCODE_DISABLE_TERMINAL_TITLE: truthy("GYCCODE_DISABLE_TERMINAL_TITLE"),
  GYCCODE_SHOW_TTFD: truthy("GYCCODE_SHOW_TTFD"),
  GYCCODE_DISABLE_AUTOCOMPACT: truthy("GYCCODE_DISABLE_AUTOCOMPACT"),
  GYCCODE_DISABLE_MODELS_FETCH: truthy("GYCCODE_DISABLE_MODELS_FETCH"),
  GYCCODE_DISABLE_MOUSE: truthy("GYCCODE_DISABLE_MOUSE"),
  GYCCODE_FAKE_VCS: process.env["GYCCODE_FAKE_VCS"],
  GYCCODE_SERVER_PASSWORD: process.env["GYCCODE_SERVER_PASSWORD"],
  GYCCODE_SERVER_USERNAME: process.env["GYCCODE_SERVER_USERNAME"],
  GYCCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("GYCCODE_DISABLE_FFF"),

  // Experimental
  GYCCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("GYCCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  GYCCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("GYCCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  GYCCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("GYCCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  GYCCODE_MODELS_URL: process.env["GYCCODE_MODELS_URL"],
  GYCCODE_MODELS_PATH: process.env["GYCCODE_MODELS_PATH"],
  GYCCODE_DB: process.env["GYCCODE_DB"],

  GYCCODE_WORKSPACE_ID: process.env["GYCCODE_WORKSPACE_ID"],
  GYCCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("GYCCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get GYCCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("GYCCODE_DISABLE_PROJECT_CONFIG")
  },
  get GYCCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("GYCCODE_EXPERIMENTAL_REFERENCES")
  },
  get GYCCODE_TUI_CONFIG() {
    return process.env["GYCCODE_TUI_CONFIG"]
  },
  get GYCCODE_CONFIG_DIR() {
    return process.env["GYCCODE_CONFIG_DIR"]
  },
  get GYCCODE_PURE() {
    return truthy("GYCCODE_PURE")
  },
  get GYCCODE_PERMISSION() {
    return process.env["GYCCODE_PERMISSION"]
  },
  get GYCCODE_PLUGIN_META_FILE() {
    return process.env["GYCCODE_PLUGIN_META_FILE"]
  },
  get GYCCODE_CLIENT() {
    return process.env["GYCCODE_CLIENT"] ?? "cli"
  },
}
