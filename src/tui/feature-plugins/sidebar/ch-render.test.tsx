import { test, expect } from "bun:test"
import { testRender } from "@opentui/solid"
import { Show } from "solid-js"

test("CH text renders with correct format and color logic", async () => {
  const chRate = { actual: 87.65, theory: 90 }
  const setup = await testRender(() => (
    <box>
      <Show when={chRate}>
        {(r) => (
          <text>{r().actual >= r().theory - 5 ? "ok" : "warn"} CH {r().actual.toFixed(1)}%</text>
        )}
      </Show>
    </box>
  ))
  await setup.flush()
  const frame = setup.captureCharFrame()
  expect(frame).toContain("CH 87.7%")
})
