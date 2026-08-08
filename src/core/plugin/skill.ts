/// <reference path="../../gyccode/markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeGyccodeContent from "./skill/customize-gyccode.md" with { type: "text" }

export const CustomizeGyccodeContent = customizeGyccodeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-gyccode",
            description:
              "Use ONLY when the user is editing or creating gyccode's own configuration: gyccode.json, gyccode.jsonc, files under .gyccode/, or files under ~/.config/gyccode/. Also use when creating or fixing gyccode agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring gyccode itself.",
            location: AbsolutePath.make("/builtin/customize-gyccode.md"),
            content: CustomizeGyccodeContent,
          }),
        }),
      )
    })
  }),
})
