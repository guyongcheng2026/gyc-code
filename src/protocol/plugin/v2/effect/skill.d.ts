import type { SkillV2Source } from "@gyccode/protocol/v2/types.gen";
import type { Hooks } from "./registration.js";
export interface SkillDraft {
    source(source: SkillV2Source): void;
    list(): readonly SkillV2Source[];
}
export type SkillHooks = Hooks<{
    transform: SkillDraft;
}>;
