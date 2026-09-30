import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { detectUnpricedModels } from "./stats"

const run = (keys: string[], priced: Record<string, boolean | undefined>) =>
  Effect.runSync(
    detectUnpricedModels(keys, (providerID, modelID) => {
      const key = `${providerID}/${modelID}`
      if (!(key in priced)) return Effect.succeed(undefined)
      return Effect.succeed({ priced: priced[key] })
    }),
  )

describe("detectUnpricedModels（每任务成本 P0：无价模型必须被点名）", () => {
  test("priced=false 的模型被列出，并按会话数降序", () => {
    const out = run(["selfhost/a", "selfhost/a", "selfhost/a", "selfhost/b", "openai/c"], {
      "selfhost/a": false,
      "selfhost/b": false,
      "openai/c": true,
    })
    expect(out).toEqual([
      { model: "selfhost/a", sessions: 3 },
      { model: "selfhost/b", sessions: 1 },
    ])
  })

  test("全部有价时返回空数组，不产生告警", () => {
    expect(run(["openai/a", "openai/b"], { "openai/a": true, "openai/b": true })).toEqual([])
  })

  test("priced 未定义（老数据/目录缺字段）不算无价", () => {
    expect(run(["openai/a"], { "openai/a": undefined })).toEqual([])
  })

  test("查不到模型（undefined）视为下线/改名，不混进无价告警", () => {
    expect(run(["retired/a"], {})).toEqual([])
  })

  test("无会话时返回空数组", () => {
    expect(run([], {})).toEqual([])
  })

  test("modelKey 里的额外斜杠不截断 modelID（models.dev 存在 vendor 前缀模型）", () => {
    const out = Effect.runSync(
      detectUnpricedModels(["openrouter/meta-llama/llama-3"], (providerID, modelID) =>
        Effect.succeed({ priced: providerID === "openrouter" && modelID === "meta-llama/llama-3" ? false : true }),
      ),
    )
    expect(out).toEqual([{ model: "openrouter/meta-llama/llama-3", sessions: 1 }])
  })
})
