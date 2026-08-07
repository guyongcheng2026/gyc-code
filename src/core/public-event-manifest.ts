export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@gyccode/schema/event"
import { EventManifest } from "@gyccode/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
