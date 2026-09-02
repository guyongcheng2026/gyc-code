import { Effect } from "effect"

export interface SecureStoreInterface {
  readonly get: (key: string) => Effect.Effect<string | undefined, SecureStoreError>
  readonly set: (key: string, value: string) => Effect.Effect<void, SecureStoreError>
  readonly delete: (key: string) => Effect.Effect<void, SecureStoreError>
}

export class SecureStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "SecureStoreError"
    this.cause = cause
  }
}

const isWindows = process.platform === "win32"
const isMac = process.platform === "darwin"
const isLinux = process.platform === "linux"

async function getWindowsCredential(key: string): Promise<string | undefined> {
  try {
    const { execSync } = await import("child_process")
    const cmd = `cmdkey /generic:${key} /read`
    const result = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
    if (result.includes("does not exist")) return undefined
    const match = result.match(/Password:\s*(.*)/)
    return match?.[1]?.trim() || undefined
  } catch {
    return undefined
  }
}

async function setWindowsCredential(key: string, value: string): Promise<void> {
  const { execSync } = await import("child_process")
  const cmd = `cmdkey /generic:${key} /pass:${value}`
  execSync(cmd, { stdio: "pipe" })
}

async function deleteWindowsCredential(key: string): Promise<void> {
  const { execSync } = await import("child_process")
  const cmd = `cmdkey /delete:${key}`
  execSync(cmd, { stdio: "pipe" })
}

async function getMacOSCredential(key: string): Promise<string | undefined> {
  try {
    const { execSync } = await import("child_process")
    const cmd = `security find-generic-password -s "${key}" -w 2>/dev/null`
    return execSync(cmd, { encoding: "utf-8" }).trim()
  } catch {
    return undefined
  }
}

async function setMacOSCredential(key: string, value: string): Promise<void> {
  const { execSync } = await import("child_process")
  const cmd = `security add-generic-password -s "${key}" -w "${value}" -U 2>/dev/null`
  execSync(cmd, { stdio: "pipe" })
}

async function deleteMacOSCredential(key: string): Promise<void> {
  const { execSync } = await import("child_process")
  const cmd = `security delete-generic-password -s "${key}" 2>/dev/null`
  execSync(cmd, { stdio: "pipe" })
}

async function getLinuxCredential(key: string): Promise<string | undefined> {
  try {
    const { execSync } = await import("child_process")
    const cmd = `secret-tool lookup service "${key}" 2>/dev/null`
    return execSync(cmd, { encoding: "utf-8" }).trim()
  } catch {
    return undefined
  }
}

async function setLinuxCredential(key: string, value: string): Promise<void> {
  const { execSync } = await import("child_process")
  const cmd = `echo "${value}" | secret-tool store --replace service "${key}" 2>/dev/null`
  execSync(cmd, { stdio: "pipe" })
}

async function deleteLinuxCredential(key: string): Promise<void> {
  const { execSync } = await import("child_process")
  const cmd = `secret-tool clear service "${key}" 2>/dev/null`
  execSync(cmd, { stdio: "pipe" })
}

async function get(key: string): Promise<string | undefined> {
  if (isWindows) return getWindowsCredential(key)
  if (isMac) return getMacOSCredential(key)
  if (isLinux) return getLinuxCredential(key)
  return undefined
}

async function set(key: string, value: string): Promise<void> {
  if (isWindows) await setWindowsCredential(key, value)
  else if (isMac) await setMacOSCredential(key, value)
  else if (isLinux) await setLinuxCredential(key, value)
  else throw new SecureStoreError("Unsupported platform")
}

async function del(key: string): Promise<void> {
  if (isWindows) await deleteWindowsCredential(key)
  else if (isMac) await deleteMacOSCredential(key)
  else if (isLinux) await deleteLinuxCredential(key)
}

export const SecureStore: SecureStoreInterface = {
  get: (key: string) => Effect.tryPromise(() => get(key), (e) => new SecureStoreError("Failed to get credential", e)),
  set: (key: string, value: string) => Effect.tryPromise(() => set(key, value), (e) => new SecureStoreError("Failed to set credential", e)),
  delete: (key: string) => Effect.tryPromise(() => del(key), (e) => new SecureStoreError("Failed to delete credential", e)),
}
