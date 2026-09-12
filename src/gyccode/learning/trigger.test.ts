// 工具迭代触发判定单测：纯内存计数 + 复习闸门。
// 本模块不读时钟、不碰文件系统，所以全部断言都是确定性的。
import { describe, expect, it } from "bun:test"
import { createTrigger, DEFAULT_TRIGGER_CONFIG, type Trigger } from "./trigger"

/** 连续累加 n 次，每次加 1。 */
function addOnes(trigger: Trigger, times: number): void {
  for (let index = 0; index < times; index += 1) trigger.addToolIterations(1)
}

describe("learning/trigger 默认配置", () => {
  it("DEFAULT_TRIGGER_CONFIG.nudgeInterval 为 10", () => {
    expect(DEFAULT_TRIGGER_CONFIG.nudgeInterval).toBe(10)
  })

  it("不传配置时按默认间隔判定", () => {
    const trigger = createTrigger()
    addOnes(trigger, DEFAULT_TRIGGER_CONFIG.nudgeInterval - 1)
    expect(trigger.shouldReview()).toBe(false)
    trigger.addToolIterations(1)
    expect(trigger.shouldReview()).toBe(true)
  })
})

describe("learning/trigger 触发判定", () => {
  it("累计 9 次不触发，第 10 次才触发", () => {
    const trigger = createTrigger()
    for (let index = 1; index <= 9; index += 1) {
      trigger.addToolIterations(1)
      expect(trigger.shouldReview()).toBe(false)
    }
    trigger.addToolIterations(1)
    expect(trigger.shouldReview()).toBe(true)
  })

  it("自定义 nudgeInterval 生效", () => {
    const trigger = createTrigger({ nudgeInterval: 3 })
    addOnes(trigger, 2)
    expect(trigger.shouldReview()).toBe(false)
    trigger.addToolIterations(1)
    expect(trigger.shouldReview()).toBe(true)
  })

  it("toolIterations() 反映累计值", () => {
    const trigger = createTrigger()
    expect(trigger.toolIterations()).toBe(0)
    trigger.addToolIterations(3)
    trigger.addToolIterations(4)
    expect(trigger.toolIterations()).toBe(7)
  })

  it("shouldReview() 是纯查询，连续调用结果一致且不改状态", () => {
    const trigger = createTrigger()
    addOnes(trigger, 10)
    expect(trigger.shouldReview()).toBe(true)
    expect(trigger.shouldReview()).toBe(true)
    expect(trigger.shouldReview()).toBe(true)
    expect(trigger.toolIterations()).toBe(10)
  })

  it("未达阈值时 shouldReview() 连续查询同样稳定为假", () => {
    const trigger = createTrigger()
    addOnes(trigger, 9)
    for (let index = 0; index < 3; index += 1) expect(trigger.shouldReview()).toBe(false)
    expect(trigger.toolIterations()).toBe(9)
  })

  it("markReviewed() 后恒为假，继续累加也不再触发", () => {
    const trigger = createTrigger()
    addOnes(trigger, 10)
    trigger.markReviewed()
    expect(trigger.shouldReview()).toBe(false)

    trigger.addToolIterations(5)
    expect(trigger.toolIterations()).toBe(15)
    expect(trigger.shouldReview()).toBe(false)
    trigger.markReviewed()
    expect(trigger.shouldReview()).toBe(false)
  })

  it("reset() 清零累计值与已复习标记，之后可重新触发", () => {
    const trigger = createTrigger()
    addOnes(trigger, 12)
    trigger.markReviewed()

    trigger.reset()
    expect(trigger.toolIterations()).toBe(0)
    expect(trigger.shouldReview()).toBe(false)

    addOnes(trigger, 9)
    expect(trigger.shouldReview()).toBe(false)
    trigger.addToolIterations(1)
    expect(trigger.shouldReview()).toBe(true)
  })

  it("addToolIterations(0) 与负数、NaN 一律被忽略", () => {
    const trigger = createTrigger({ nudgeInterval: 5 })
    trigger.addToolIterations(0)
    trigger.addToolIterations(-1)
    trigger.addToolIterations(-100)
    trigger.addToolIterations(Number.NaN)
    expect(trigger.toolIterations()).toBe(0)
    expect(trigger.shouldReview()).toBe(false)

    trigger.addToolIterations(4)
    expect(trigger.shouldReview()).toBe(false)
    trigger.addToolIterations(0)
    expect(trigger.shouldReview()).toBe(false)
    trigger.addToolIterations(1)
    expect(trigger.shouldReview()).toBe(true)
  })

  it("忽略非法输入不影响正常计数的叠加", () => {
    const trigger = createTrigger({ nudgeInterval: 6 })
    trigger.addToolIterations(3)
    trigger.addToolIterations(0)
    trigger.addToolIterations(3)
    expect(trigger.toolIterations()).toBe(6)
    expect(trigger.shouldReview()).toBe(true)
  })

  it("markReviewed() 不改变累计值，reset() 才把两者都清零", () => {
    const trigger = createTrigger()
    addOnes(trigger, 10)
    trigger.markReviewed()
    expect(trigger.toolIterations()).toBe(10)
    expect(trigger.shouldReview()).toBe(false)

    trigger.reset()
    expect(trigger.toolIterations()).toBe(0)
  })
})
