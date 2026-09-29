// rpc.ts 回归测试：覆盖 P0 级修复
//  1. pending 超时清理（worker 存活但 handler 永不返回时不再无界泄漏）
//  2. 畸形 JSON 消息不破坏消息通道
//  3. never 类型擦除后事件分发仍能还原具体类型
import { describe, expect, it } from "bun:test"
import { client, type Definition } from "./rpc"

type Def = {
  echo: (input: { text: string }) => Promise<{ out: string }>
  hang: () => Promise<never>
}

/** 构造一个可手动推消息的假 worker target。 */
function fakeTarget() {
  const sent: string[] = []
  const listeners: ((data: string) => void)[] = []
  return {
    sent,
    push(data: string) {
      for (const fn of [...listeners]) fn(data)
    },
    target: {
      postMessage: (data: string) => {
        sent.push(data)
      },
      on(_event: "message", fn: (data: string) => void) {
        listeners.push(fn)
      },
    },
  }
}

/** 取出最后一次发出的请求载荷。 */
function lastRequest(sent: string[]): { id: number; method: string } {
  const last = sent[sent.length - 1]
  if (last === undefined) throw new Error("no message was sent")
  return JSON.parse(last) as { id: number; method: string }
}

describe("rpc client", () => {
  it("畸形 JSON 不破坏通道，后续合法消息仍可处理", async () => {
    const { target, push, sent } = fakeTarget()
    const rpc = client<Def>(target as never, { timeoutMs: 1000 })

    push("{ this is not json")
    const promise = rpc.call("echo", { text: "hi" })
    const request = lastRequest(sent)
    push(JSON.stringify({ type: "rpc.result", id: request.id, result: { out: "hi" } }))

    expect(await promise).toEqual({ out: "hi" })
    rpc.dispose(new Error("test done"))
  })

  it("handler 永不返回时超时 reject，pending 归零", async () => {
    const { target } = fakeTarget()
    const rpc = client<Def>(target as never, { timeoutMs: 60 })

    const promise = rpc.call("hang", undefined as never)
    expect(rpc.pendingCount()).toBe(1)

    await expect(promise).rejects.toThrow(/timed out/)
    // 超时后条目必须已清理，否则就是无界泄漏
    expect(rpc.pendingCount()).toBe(0)
    rpc.dispose(new Error("test done"))
  })

  it("dispose 清空 pending 与定时器", async () => {
    const { target } = fakeTarget()
    const rpc = client<Def>(target as never, { timeoutMs: 60_000 })

    const promise = rpc.call("hang", undefined as never)
    expect(rpc.pendingCount()).toBe(1)
    rpc.dispose(new Error("worker exited"))

    await expect(promise).rejects.toThrow("worker exited")
    expect(rpc.pendingCount()).toBe(0)
  })

  it("事件订阅能按具体类型收到负载，退订后不再触发", () => {
    const { target, push } = fakeTarget()
    const rpc = client<Def>(target as never, { timeoutMs: 1000 })

    const received: number[] = []
    const off = rpc.on<number>("tick", (n) => received.push(n))

    push(JSON.stringify({ type: "rpc.event", event: "tick", data: 42 }))
    expect(received).toEqual([42])

    off()
    push(JSON.stringify({ type: "rpc.event", event: "tick", data: 43 }))
    expect(received).toEqual([42])

    rpc.dispose(new Error("test done"))
  })

  it("服务端回传 error 字段时 reject 而非 resolve", async () => {
    const { target, push, sent } = fakeTarget()
    const rpc = client<Def>(target as never, { timeoutMs: 1000 })

    const promise = rpc.call("echo", { text: "boom" })
    const request = lastRequest(sent)
    push(JSON.stringify({ type: "rpc.result", id: request.id, error: "handler failed" }))

    await expect(promise).rejects.toThrow("handler failed")
    expect(rpc.pendingCount()).toBe(0)
    rpc.dispose(new Error("test done"))
  })
})

describe("Definition 类型", () => {
  it("client 的泛型约束可被具体签名满足", () => {
    // 编译期断言：具体签名的 handler 仍可作为 Definition 使用
    const def: Definition = {
      echo: async (input: { text: string }) => ({ out: input.text }),
    }
    expect(typeof def.echo).toBe("function")
  })
})
