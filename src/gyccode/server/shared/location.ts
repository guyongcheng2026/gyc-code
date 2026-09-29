import { Location } from "@gyccode/core/location"
import { LocationServiceMap } from "@gyccode/core/location-services"
import { AbsolutePath } from "@gyccode/core/schema"
import { WorkspaceV2 } from "@gyccode/core/workspace"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { guardDirectory } from "./location-guard"

export type LocationServices = Layer.Success<ReturnType<(typeof LocationServiceMap.Service)["get"]>>

export class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware, { provides: LocationServices }>()(
  "@gyccode/HttpApiLocation",
) {}

export function response<A, E, R>(data: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const location = yield* Location.Service
    return {
      location: new Location.Info({
        directory: location.directory,
        workspaceID: location.workspaceID,
        project: location.project,
      }),
      data: yield* data,
    }
  })
}

/**
 * 目录白名单校验：请求方指定的 directory 必须落在 GYCCODE_SERVER_ROOTS 之内，
 * 否则可被用来把项目根指向任意绝对路径。详见 location-guard.ts。
 */
function ref(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  const workspaceID = query.get("location[workspace]") || request.headers["x-gyccode-workspace"]
  const directory =
    query.get("location[directory]") ||
    (request.headers["x-gyccode-directory"] ? decode(request.headers["x-gyccode-directory"] as string) : process.cwd())
  return Location.Ref.make({
    directory: AbsolutePath.make(guardDirectory(directory)),
    workspaceID: workspaceID ? WorkspaceV2.ID.make(workspaceID) : undefined,
  })
}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

export const layer = Layer.effect(
  LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return LocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* effect.pipe(Effect.provide(locations.get(ref(request))))
      }),
    )
  }),
)
