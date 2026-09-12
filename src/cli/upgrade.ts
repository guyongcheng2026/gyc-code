import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@gyccode/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@gyccode/core/installation/version"
import { GlobalBus } from "@/bus/global"

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.GYCCODE_DISABLE_AUTOUPDATE) return
  const method = await Installation.method()
  // 离线或 CDN 不可达时获取最新版本失败，静默跳过自动更新
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return

  if (Flag.GYCCODE_ALWAYS_NOTIFY_UPDATE) {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: latest },
      },
    })
    return
  }

  if (InstallationVersion === latest) return

  const kind = Installation.getReleaseType(InstallationVersion, latest)

  if (config.autoupdate === "notify" || kind !== "patch") {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: latest },
      },
    })
    return
  }

  if (method === "unknown") return
  await Installation.upgrade(method, latest)
    .then(() =>
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: latest },
        },
      }),
    )
    // 升级失败不影响当前会话（下次启动会再次尝试），忽略
    .catch(() => {})
}
