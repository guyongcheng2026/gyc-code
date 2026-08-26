export * as ConfigShellEnforcement from "./shell-enforcement"

import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigV2.ShellEnforcement")({
  block_external_paths: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Reject bash commands whose arguments reference paths outside the working directory and allow_paths instead of only warning (default: false)",
  }),
  allow_paths: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description: "Additional directories permitted when block_external_paths is enabled",
  }),
}) {}
