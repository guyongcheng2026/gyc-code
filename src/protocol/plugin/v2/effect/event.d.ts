import type { Event as SDKEvent } from "@gyccode/protocol/v2/types.gen";
import type { Stream } from "effect";
export type EventMap = {
    [Item in SDKEvent as Item["type"]]: Item;
};
export interface Event {
    subscribe<Type extends keyof EventMap>(type: Type): Stream.Stream<EventMap[Type]>;
}
