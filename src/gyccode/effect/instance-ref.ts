import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@gyccode/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~gyccode/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~gyccode/WorkspaceRef", {
  defaultValue: () => undefined,
})
