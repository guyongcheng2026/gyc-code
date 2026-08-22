declare global {
  const GYCCODE_VERSION: string
  const GYCCODE_CHANNEL: string
}

export const InstallationVersion = typeof GYCCODE_VERSION === "string" ? GYCCODE_VERSION : "0.0.1"
export const InstallationChannel = typeof GYCCODE_CHANNEL === "string" ? GYCCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
