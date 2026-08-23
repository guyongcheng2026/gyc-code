import { Database } from "@gyccode/core/database/database"
import { LayerNode } from "@gyccode/core/effect/layer-node"
import { httpClient } from "@gyccode/core/effect/app-node-platform"
import { AppNodeBuilder } from "@gyccode/core/effect/app-node-builder"
import { EventV2 } from "@gyccode/core/event"
import { Credential } from "@gyccode/core/credential"
import { PermissionSaved } from "@gyccode/core/permission/saved"
import { PtyTicket } from "@gyccode/core/pty/ticket"
import { SessionV2 } from "@gyccode/core/session"
import { SessionExecution } from "@gyccode/core/session/execution"
import { LocationServiceMap } from "@gyccode/core/location-service-map"
import { WorkflowV2 } from "@gyccode/core/workflow"
import { SessionExecutionLocal } from "@gyccode/core/session/execution/local"
import { ToolOutputStore } from "@gyccode/core/tool-output-store"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { rateLimitLayer } from "./middleware/rate-limit"
import { schemaErrorLayer } from "./middleware/schema-error"
import { PtyEnvironment } from "./pty-environment"
import { layer as locationLayer } from "./location"
import { sessionLocationLayer } from "./middleware/session-location"

const applicationServices = LayerNode.group([
  Database.node,
  EventV2.node,
  httpClient,
  ToolOutputStore.cleanupNode,
  SessionV2.node,
  PermissionSaved.node,
  PtyTicket.node,
  Credential.node,
  PtyEnvironment.node,
  LocationServiceMap.node,
  WorkflowV2.node,
])

export function createRoutes(password?: string) {
  return makeRoutes(
    password
      ? ServerAuth.Config.configLayer({ username: "gyccode", password: Option.some(password) })
      : ServerAuth.Config.layer,
  )
}

export function createEmbeddedRoutes() {
  return makeRoutes(ServerAuth.Config.configLayer({ username: "gyccode", password: Option.none() }))
}

function makeRoutes<AuthError, AuthServices>(auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>) {
  const serviceLayer = AppNodeBuilder.build(applicationServices, [[SessionExecution.node, SessionExecutionLocal.node]])

  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers),
    Layer.provide(sessionLocationLayer),
    Layer.provide(locationLayer),
    Layer.provide(authorizationLayer),
    Layer.provide(rateLimitLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(auth),
    Layer.provide(serviceLayer),
  )
}

export const routes = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })
