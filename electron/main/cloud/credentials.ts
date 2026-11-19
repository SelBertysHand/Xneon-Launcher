export type CloudCredentials = {
  googleDrive: { clientId: string; clientSecret: string }
  dropbox: { clientId: string }
  yandex: { clientId: string }
  onedrive: { clientId: string }
  elyby: { clientId: string; clientSecret: string; deviceClientId: string }
  xnskins: { clientId: string; clientSecret: string }
  microsoft: { clientId: string }
  microsoftDevice: { clientId: string }
}

const EMPTY: CloudCredentials = {
  googleDrive: { clientId: "", clientSecret: "" },
  dropbox: { clientId: "" },
  yandex: { clientId: "" },
  onedrive: { clientId: "" },
  elyby: { clientId: "", clientSecret: "", deviceClientId: "" },
  xnskins: { clientId: "", clientSecret: "" },
  microsoft: { clientId: "" },
  microsoftDevice: { clientId: "" },
}

let cached: CloudCredentials | null = null

export function getCloudCredentials(): CloudCredentials {
  if (cached) return cached
  try {
    const generated = require("./credentials.generated") as { cloudCredentials?: CloudCredentials }
    if (generated?.cloudCredentials) cached = generated.cloudCredentials
  } catch {
    /* credentials.generated.ts не создан — используем пустые значения */
  }
  if (!cached) cached = EMPTY
  return cached
}

/** Public Microsoft client id used by the official Minecraft launcher device-code flow. */
export const DEFAULT_MICROSOFT_DEVICE_CLIENT_ID = "00000000402b5328"

export function resolveMicrosoftDeviceClientId(configured?: string | null): string {
  return configured?.trim() || DEFAULT_MICROSOFT_DEVICE_CLIENT_ID
}
