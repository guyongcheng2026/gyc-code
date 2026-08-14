import { Bonjour } from "bonjour-service"

let bonjour: Bonjour | undefined
let currentPort: number | undefined

export function publish(port: number, domain?: string) {
  if (currentPort === port) return
  if (bonjour) unpublish()

  try {
    const host = domain ?? "gyccode.local"
    const name = `gyccode-${port}`
    bonjour = new Bonjour()
    const service = bonjour.publish({
      name,
      type: "http",
      host,
      port,
      txt: { path: "/" },
    })

    service.on("error", (err) => {
      console.error("[mdns] bonjour service error:", err)
    })

    currentPort = port
  } catch {
    if (bonjour) {
      try {
        bonjour.destroy()
      } catch {
        // Best-effort teardown after a failed publish; nothing left to do.
      }
    }
    bonjour = undefined
    currentPort = undefined
  }
}

export function unpublish() {
  if (bonjour) {
    try {
      bonjour.unpublishAll()
      bonjour.destroy()
    } catch {
      // Best-effort teardown; failure is logged nowhere critical and the
      // service is dropped from tracking regardless.
    }
    bonjour = undefined
    currentPort = undefined
  }
}

export * as MDNS from "./mdns"
