import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { LayerNode } from "@gyccode/core/effect/layer-node"
import { CrossSpawnSpawner } from "@gyccode/core/cross-spawn-spawner"
import { runHook, parseHookOutput } from "./executor"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const spawnerLayer = LayerNode.compile(CrossSpawnSpawner.node)
const shell = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "/bin/sh"

describe("parseHookOutput", () => {
  test("合法 JSON 对象 → 解析为结构化输出", () => {
    expect(parseHookOutput('{"decision":"deny","message":"blocked"}')).toEqual({
      decision: "deny",
      message: "blocked",
    })
  })

  test("非法 JSON / 数组 / 标量 / 空 → undefined", () => {
    expect(parseHookOutput("not json")).toBeUndefined()
    expect(parseHookOutput("[1,2]")).toBeUndefined()
    expect(parseHookOutput('"str"')).toBeUndefined()
    expect(parseHookOutput("  \n ")).toBeUndefined()
  })
})

describe("runHook", () => {
  const run = (hook: Parameters<typeof runHook>[1], input: Parameters<typeof runHook>[2]) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      return yield* runHook(spawner, hook, input, shell)
    }).pipe(Effect.provide(spawnerLayer))

  test("spawn 命令、经 stdin 传 JSON、解析 deny 决策", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gyc-hook-"))
    const script = join(dir, "hook.js")
    writeFileSync(
      script,
      `let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const i=JSON.parse(d);console.log(JSON.stringify({decision:"deny",message:"blocked "+i.tool_name}))})`,
    )
    const command = `"${process.execPath}" "${script}"`

    const outcome = await Effect.runPromise(
      run(
        { event: "PreToolUse", command },
        { hook_event_name: "PreToolUse", session_id: "s1", cwd: process.cwd(), tool_name: "read", tool_input: { a: 1 } },
      ),
    )

    expect(outcome.exitCode).toBe(0)
    expect(outcome.output?.decision).toBe("deny")
    expect(outcome.output?.message).toBe("blocked read")
    expect(outcome.error).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })

  test("超时：强杀进程并落 error，不抛 defect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gyc-hook-"))
    const script = join(dir, "hook.js")
    writeFileSync(script, `setTimeout(()=>{},10000)`)
    const command = `"${process.execPath}" "${script}"`

    const outcome = await Effect.runPromise(
      run(
        { event: "PostToolUse", command, timeout: 500 },
        { hook_event_name: "PostToolUse", session_id: "s1", cwd: process.cwd(), tool_name: "read" },
      ),
    )

    expect(outcome.exitCode).toBeNull()
    expect(outcome.output).toBeUndefined()
    expect(outcome.error).toContain("timed out")
    rmSync(dir, { recursive: true, force: true })
  })

  test("非 JSON stdout：无结构化决策但不报错", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gyc-hook-"))
    const script = join(dir, "hook.js")
    writeFileSync(script, `console.log("just a log line")`)
    const command = `"${process.execPath}" "${script}"`

    const outcome = await Effect.runPromise(
      run(
        { event: "PreToolUse", command },
        { hook_event_name: "PreToolUse", session_id: "s1", cwd: process.cwd(), tool_name: "read" },
      ),
    )

    expect(outcome.exitCode).toBe(0)
    expect(outcome.output).toBeUndefined()
    expect(outcome.stdout).toContain("just a log line")
    expect(outcome.error).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})
