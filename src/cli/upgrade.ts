import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@gyccode/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@gyccode/core/installation/version"
import { GlobalBus } from "@/bus/global"
import { logWarn } from "@core/observability/log-error"
import { errorMessage } from "@/util/error"

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.GYCCODE_DISABLE_AUTOUPDATE) return
  const method = await Installation.method()
  // 离线或 CDN 不可达时获取最新版本失败，按「无更新」处理（下方 !latest 直接返回）
  const latest = await Installation.latest(method).catch((error: unknown) => {
    // 必须留痕：Installation.latest 是 Effect.orDie，除网络不可达外，上游 schema
    // 漂移同样会走到这里——静默吞掉会让「自动更新长期不工作」完全不可见。
    logWarn("cli.upgrade", "获取最新版本失败，按无更新处理", {
      op: "installation.latest",
      method,
      error: errorMessage(error),
    })
  })
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
    // 升级失败不影响当前会话（下次启动会再次尝试），但必须留痕
    .catch((error: unknown) => {
      logWarn("cli.upgrade", "自动升级失败，保持当前版本", {
        op: "installation.upgrade",
        method,
        target: latest,
        error: errorMessage(error),
      })
    })
}
