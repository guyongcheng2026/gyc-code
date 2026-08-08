import { LayerNode } from "@gyccode/core/effect/layer-node"
import path from "path"
import { serviceUse } from "@gyccode/core/effect/service-use"
import { Global } from "@gyccode/core/global"
import { Effect, Layer, Context, Option, Schema } from "effect"
import { FSUtil } from "@gyccode/core/fs-util"
import { EffectFlock } from "@gyccode/core/util/effect-flock"

export const Tokens = Schema.Struct({
  accessToken: Schema.mutableKey(Schema.String),
  refreshToken: Schema.mutableKey(Schema.optional(Schema.String)),
  expiresAt: Schema.mutableKey(Schema.optional(Schema.Number)),
  scope: Schema.mutableKey(Schema.optional(Schema.String)),
})
export type Tokens = Schema.Schema.Type<typeof Tokens>

// OAuth token type alias for external consumers
export type OAuthTokenState = Tokens

export function isTokenExpired(token: OAuthTokenState): boolean {
  if (!token.expiresAt) return false
  return Date.now() > token.expiresAt - 60_000 // 1 minute buffer
}

export function shouldRefreshToken(token: OAuthTokenState): boolean {
  if (!token.refreshToken) return false
  if (!token.expiresAt) return false
  return Date.now() > token.expiresAt - 300_000 // 5 minute buffer
}

export interface TokenRefreshResult {
  accessToken: string
  refreshToken?: string
  expiresIn: number  // seconds
}

export class TokenRefreshError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = "TokenRefreshError"
  }
}

export async function refreshAccessToken(
  token: OAuthTokenState,
  tokenEndpoint: string,
  clientId: string,
): Promise<TokenRefreshResult> {
  if (!token.refreshToken) {
    throw new TokenRefreshError("No refresh token available", undefined, "no_refresh_token")
  }

  let response: Response
  try {
    response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: token.refreshToken,
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new TokenRefreshError(`Token refresh network failure: ${message}`, undefined, "network_error")
  }

  if (!response.ok) {
    const description = await refreshErrorDescription(response)
    if (response.status === 400 && description.includes("invalid_grant")) {
      throw new TokenRefreshError(`Invalid refresh token: ${description}`, response.status, "invalid_grant")
    }
    throw new TokenRefreshError(`Token refresh failed: ${description}`, response.status, "http_error")
  }

  const body = (await response.json()) as Record<string, unknown>
  if (typeof body.access_token !== "string") {
    throw new TokenRefreshError("Token refresh response missing access_token", response.status, "invalid_response")
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : token.refreshToken,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
  }
}

async function refreshErrorDescription(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Record<string, unknown>
    const parts: string[] = []
    if (typeof body.error === "string") parts.push(body.error)
    if (typeof body.error_description === "string") parts.push(body.error_description)
    if (parts.length) return parts.join(": ")
  } catch {}
  return response.statusText || `HTTP ${response.status}`
}

export const ClientInfo = Schema.Struct({
  clientId: Schema.mutableKey(Schema.String),
  clientSecret: Schema.mutableKey(Schema.optional(Schema.String)),
  clientIdIssuedAt: Schema.mutableKey(Schema.optional(Schema.Number)),
  clientSecretExpiresAt: Schema.mutableKey(Schema.optional(Schema.Number)),
})
export type ClientInfo = Schema.Schema.Type<typeof ClientInfo>

export const Entry = Schema.Struct({
  tokens: Schema.mutableKey(Schema.optional(Tokens)),
  clientInfo: Schema.mutableKey(Schema.optional(ClientInfo)),
  codeVerifier: Schema.mutableKey(Schema.optional(Schema.String)),
  oauthState: Schema.mutableKey(Schema.optional(Schema.String)),
  serverUrl: Schema.mutableKey(Schema.optional(Schema.String)),
})
export type Entry = Schema.Schema.Type<typeof Entry>

const decodeAuthData = Schema.decodeUnknownOption(Schema.Record(Schema.String, Entry))
type AuthData = Record<string, Entry>

const filepath = path.join(Global.Path.data, "mcp-auth.json")
const lockKey = `mcp-auth:${filepath}`

export interface Interface {
  readonly all: () => Effect.Effect<Record<string, Entry>>
  readonly get: (mcpName: string) => Effect.Effect<Entry | undefined>
  readonly getForUrl: (mcpName: string, serverUrl: string) => Effect.Effect<Entry | undefined>
  readonly set: (mcpName: string, entry: Entry, serverUrl?: string) => Effect.Effect<void>
  readonly remove: (mcpName: string) => Effect.Effect<void>
  readonly updateTokens: (mcpName: string, tokens: Tokens, serverUrl?: string) => Effect.Effect<void>
  readonly updateClientInfo: (mcpName: string, clientInfo: ClientInfo, serverUrl?: string) => Effect.Effect<void>
  readonly updateCodeVerifier: (mcpName: string, codeVerifier: string) => Effect.Effect<void>
  readonly clearCodeVerifier: (mcpName: string) => Effect.Effect<void>
  readonly updateOAuthState: (mcpName: string, oauthState: string) => Effect.Effect<void>
  readonly getOAuthState: (mcpName: string) => Effect.Effect<string | undefined>
  readonly clearOAuthState: (mcpName: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/McpAuth") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const flock = yield* EffectFlock.Service

    const read = Effect.fn("McpAuth.read")(function* () {
      return yield* fs.readJson(filepath).pipe(
        Effect.map((data): AuthData => Option.getOrElse(decodeAuthData(data), () => ({}) as AuthData) as AuthData),
        Effect.catch(() => Effect.succeed({} as AuthData)),
      )
    })

    const all = Effect.fn("McpAuth.all")(function* () {
      return yield* read().pipe(flock.withLock(lockKey), Effect.orDie)
    })

    const mutate = Effect.fn("McpAuth.mutate")(function* (update: (data: AuthData) => AuthData | undefined) {
      yield* Effect.gen(function* () {
        const next = update(yield* read())
        if (!next) return
        yield* fs.writeJson(filepath, next, 0o600).pipe(Effect.orDie)
      }).pipe(flock.withLock(lockKey), Effect.orDie)
    })

    const get = Effect.fn("McpAuth.get")(function* (mcpName: string) {
      const data = yield* all()
      return data[mcpName]
    })

    const getForUrl = Effect.fn("McpAuth.getForUrl")(function* (mcpName: string, serverUrl: string) {
      const entry = yield* get(mcpName)
      if (!entry) return undefined
      if (!entry.serverUrl) return undefined
      if (entry.serverUrl !== serverUrl) return undefined
      return entry
    })

    const set = Effect.fn("McpAuth.set")(function* (mcpName: string, entry: Entry, serverUrl?: string) {
      yield* mutate((data) => ({
        ...data,
        [mcpName]: serverUrl ? { ...entry, serverUrl } : entry,
      }))
    })

    const remove = Effect.fn("McpAuth.remove")(function* (mcpName: string) {
      yield* mutate((data) => {
        const next = { ...data }
        delete next[mcpName]
        return next
      })
    })

    const updateField = <K extends keyof Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string, value: NonNullable<Entry[K]>, serverUrl?: string) {
        yield* mutate((data) => {
          const entry = data[mcpName] ?? {}
          entry[field] = value
          if (serverUrl) entry.serverUrl = serverUrl
          return { ...data, [mcpName]: entry }
        })
      })

    const clearField = (field: keyof Entry, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string) {
        yield* mutate((data) => {
          const entry = data[mcpName]
          if (!entry) return undefined
          delete entry[field]
          return { ...data, [mcpName]: entry }
        })
      })

    const updateTokens = updateField("tokens", "updateTokens")
    const updateClientInfo = updateField("clientInfo", "updateClientInfo")
    const updateCodeVerifier = updateField("codeVerifier", "updateCodeVerifier")
    const updateOAuthState = updateField("oauthState", "updateOAuthState")
    const clearCodeVerifier = clearField("codeVerifier", "clearCodeVerifier")
    const clearOAuthState = clearField("oauthState", "clearOAuthState")

    const getOAuthState = Effect.fn("McpAuth.getOAuthState")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      return entry?.oauthState
    })

    return Service.of({
      all,
      get,
      getForUrl,
      set,
      remove,
      updateTokens,
      updateClientInfo,
      updateCodeVerifier,
      clearCodeVerifier,
      updateOAuthState,
      getOAuthState,
      clearOAuthState,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, EffectFlock.node] })

export * as McpAuth from "./auth"
