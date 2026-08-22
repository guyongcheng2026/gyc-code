import type { IntegrationDraft, IntegrationMethodRegistration } from "../effect/integration.js";
import type { CredentialValue } from "@gyccode/protocol/v2/types.gen";
import type { Hooks } from "./registration.js";
export type { IntegrationDraft, IntegrationMethodRegistration };
export interface IntegrationHooks extends Hooks<{
    transform: IntegrationDraft;
}> {
    readonly connection: {
        readonly active: (integrationID: string) => Promise<import("@gyccode/protocol/v2/types.gen").ConnectionInfo | undefined>;
        readonly resolve: (connection: import("@gyccode/protocol/v2/types.gen").ConnectionInfo) => Promise<CredentialValue | undefined>;
    };
}
