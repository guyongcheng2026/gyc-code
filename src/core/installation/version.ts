declare global {
  const GYCCODE_VERSION: string
  const GYCCODE_CHANNEL: string
}

export const InstallationVersion = typeof GYCCODE_VERSION === "string" ? GYCCODE_VERSION : "1.0.0"
export const InstallationChannel = typeof GYCCODE_CHANNEL === "string" ? GYCCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
