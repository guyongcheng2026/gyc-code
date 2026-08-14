import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer, Ref, Result } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner, ExitCode } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "./cross-spawn-spawner"

// 测试自行以 make 构建实例以控制并发上限，全局默认值由 afterAll 复原。
const spawnerLayer = Layer.effect(ChildProcessSpawner, CrossSpawnSpawner.make).pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
)

type Spawner = ChildProcessSpawner["Service"]
const withSpawner = <A, E, R>(use: (spawner: Spawner) => Effect.Effect<A, E, R>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner
        return yield* use(spawner)
      }),
    ).pipe(Effect.provide(spawnerLayer)) as Effect.Effect<A, E>,
  )

// 注意：bun test 在 Windows 上与 powershell.exe 不兼容（子进程悬挂、exit 码为 null），
// 故 sleep 改用运行时自带可执行（process.execPath），其在 bun test 下行为稳定。
const sleepCmd = (ms: number) =>
  process.platform === "win32"
    ? [process.execPath, "-e", `setTimeout(()=>{},${ms})`]
    : ["sleep", String(ms / 1000)]

const run = (spawner: Spawner, cmd: string[]) =>
  Effect.gen(function* () {
    const handle = yield* spawner.spawn(ChildProcess.make(cmd[0], cmd.slice(1), { stdin: "ignore" }))
    const code = yield* handle.exitCode
    expect(code).toBe(ExitCode(0))
  })

describe("spawn concurrency cap", () => {
  beforeAll(() => {
    CrossSpawnSpawner.setMaxConcurrentProcesses(2)
  })
  afterAll(() => {
    CrossSpawnSpawner.setMaxConcurrentProcesses(CrossSpawnSpawner.DEFAULT_MAX_CONCURRENT_PROCESSES)
  })

  it("caps the number of concurrently running processes (permit held until exit)", async () => {
    await withSpawner((spawner) =>
      Effect.gen(function* () {
        const running = yield* Ref.make(0)
        const peak = yield* Ref.make(0)

        const task = (ms: number) =>
          Effect.gen(function* () {
            // 并发上限在 spawn 内部生效：spawn 返回后进程方在运行，自彼时起计数。
            const handle = yield* spawner.spawn(
              ChildProcess.make(sleepCmd(ms)[0], sleepCmd(ms).slice(1), { stdin: "ignore" }),
            )
            const current = yield* Ref.updateAndGet(running, (n) => n + 1)
            yield* Ref.update(peak, (p) => Math.max(p, current))
            const code = yield* handle.exitCode
            expect(code).toBe(ExitCode(0))
            yield* Ref.update(running, (n) => n - 1)
          })

        // 4 个并发 spawn 对上限 2：同时运行者至多 2 个。
        yield* Effect.all([task(600), task(600), task(600), task(600)], { concurrency: "unbounded" })

        expect(yield* Ref.get(peak)).toBeLessThanOrEqual(2)
        expect(yield* Ref.get(running)).toBe(0)
      }),
    )
  })

  it("queues excess spawns until a permit frees and later spawns still work", async () => {
    await withSpawner((spawner) =>
      Effect.gen(function* () {
        // 第一波占满 2 个名额。
        const wave = [sleepCmd(400), sleepCmd(400)]
        yield* Effect.all(wave.map((cmd) => run(spawner, cmd)), { concurrency: "unbounded" })

        // 波次平息后名额须完全恢复，再起一波仍能双开。
        const running = yield* Ref.make(0)
        const peak = yield* Ref.make(0)
        const task = () =>
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(
              ChildProcess.make(sleepCmd(300)[0], sleepCmd(300).slice(1), { stdin: "ignore" }),
            )
            const current = yield* Ref.updateAndGet(running, (n) => n + 1)
            yield* Ref.update(peak, (p) => Math.max(p, current))
            yield* handle.exitCode
            yield* Ref.update(running, (n) => n - 1)
          })
        yield* Effect.all([task(), task()], { concurrency: "unbounded" })
        // 两者并行，上限未被侵蚀。
        expect(yield* Ref.get(peak)).toBe(2)
        expect(yield* Ref.get(running)).toBe(0)
      }),
    )
  })

  it("releases the permit when a spawn fails before launch (no process starts)", async () => {
    await withSpawner((spawner) =>
      Effect.gen(function* () {
        // 以不存在的 cwd 构造 spawn 前失败（cwd() 内 fs.access 报错）。
        // 该失败发生于 permit 获取之后、进程启动之前。
        const result = yield* Effect.result(
          Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(
                ChildProcess.make("whatever.exe", [], {
                  cwd: "Z:\\gyccode-definitely-not-exist-xyz",
                  stdin: "ignore",
                }),
              )
              yield* handle.exitCode
            }),
          ),
        )
        expect(Result.isFailure(result)).toBe(true)

        // 失败 spawn 不得耗尽 permit：正常 spawn 仍可运行。
        yield* run(spawner, sleepCmd(100))
      }),
    )
  })
})

describe("spawn cap configuration", () => {
  afterAll(() => {
    CrossSpawnSpawner.setMaxConcurrentProcesses(CrossSpawnSpawner.DEFAULT_MAX_CONCURRENT_PROCESSES)
  })

  it("exposes a sensible default", () => {
    expect(CrossSpawnSpawner.DEFAULT_MAX_CONCURRENT_PROCESSES).toBe(8)
  })

  it("rejects invalid limits", () => {
    expect(() => CrossSpawnSpawner.setMaxConcurrentProcesses(0)).toThrow(RangeError)
    expect(() => CrossSpawnSpawner.setMaxConcurrentProcesses(-1)).toThrow(RangeError)
    expect(() => CrossSpawnSpawner.setMaxConcurrentProcesses(1.5)).toThrow(RangeError)
  })
})



