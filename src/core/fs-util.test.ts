// FSUtil.contains 回归测试（等保三级 · 访问控制 · 路径穿越防护）
//
// contains 是文件路由的**唯一防穿越闸门**：file.ts:71 的 FSUtil.contains
// 与 file.ts:73 的 FSUtil.resolve 双重校验。此函数一旦判定失效，攻击者即可用
// ../ 路径穿越读取项目外任意文件。属于全盘失守级的高危纯函数。
import { describe, expect, test } from "bun:test"
import { FSUtil } from "./fs-util"

const SEP = "\\" // Windows 路径分隔符，Windows 平台下运行

describe("FSUtil.contains — 正例（在父目录内）", () => {
  test("父目录完全相同", () => {
    expect(FSUtil.contains("C:\\project", "C:\\project")).toBe(true)
  })

  test("直接子目录", () => {
    expect(FSUtil.contains("C:\\project", "C:\\project\\src")).toBe(true)
  })

  test("深层嵌套子目录", () => {
    expect(FSUtil.contains("C:\\project", "C:\\project\\src\\utils\\helper.ts")).toBe(true)
  })

  test("文件名相同但扩展名不同", () => {
    expect(FSUtil.contains("C:\\project\\src", "C:\\project\\src\\index.ts")).toBe(true)
    expect(FSUtil.contains("C:\\project\\src", "C:\\project\\src\\index.js")).toBe(true)
  })

  test("同级目录不包含", () => {
    expect(FSUtil.contains("C:\\project\\src", "C:\\project\\tests")).toBe(false)
  })

  test("大小写不敏感（Windows 路径语义）", () => {
    expect(FSUtil.contains("c:\\project", "C:\\PROJECT\\SRC")).toBe(true)
  })
})

describe("FSUtil.contains — 反例（穿越尝试）", () => {
  test("直接的 .. 穿越", () => {
    expect(FSUtil.contains("C:\\project\\src", "C:\\project\\src\\..\\..\\windows\\system32")).toBe(false)
  })

  test("单层 .. 尝试访问父目录", () => {
    expect(FSUtil.contains("C:\\project\\src", "C:\\project\\src\\..\\config.json")).toBe(false)
  })

  test("多层 .. 穿越多级父目录", () => {
    expect(FSUtil.contains("C:\\project", "C:\\project\\src\\..\\..\\..\\windows")).toBe(false)
  })

  test("混合 .. 和正常路径片段", () => {
    expect(FSUtil.contains("C:\\project\\src", "C:\\project\\src\\utils\\..\\..\\..\\etc\\passwd")).toBe(false)
  })

  test("绝对路径的 .. 不能穿越", () => {
    expect(FSUtil.contains("C:\\project\\src", "C:\\..\\..\\windows")).toBe(false)
  })

  test("硬链接/软链路径不穿越（父目录一致时由 realpath 处理，contains 只做路径语义）", () => {
    expect(FSUtil.contains("C:\\project", "C:\\project\\symlink\\..\\..\\etc")).toBe(false)
  })
})

describe("FSUtil.contains — 边界情况", () => {
  test("相对路径的父目录不能包含绝对路径的子路径", () => {
    expect(FSUtil.contains("project", "C:\\project\\src")).toBe(false)
  })

  test("空字符串父目录按相对路径语义包含相对子路径（path.relative 语义）", () => {
    // path.relative("", "src") = "src"，非绝对、非 ".."、非 "..\" 开头 → 返回 true
    // 这是 path.relative 的标准语义：空父目录视为当前工作目录
    expect(FSUtil.contains("", "src")).toBe(true)
  })

  test("父目录为根路径时的保护", () => {
    expect(FSUtil.contains("C:\\", "C:\\Windows\\System32")).toBe(true)
    expect(FSUtil.contains("C:\\", "C:\\project")).toBe(true)
    // 但 C:\project 不能包含 C:\Windows
    expect(FSUtil.contains("C:\\project", "C:\\Windows")).toBe(false)
  })
})

describe("FSUtil.resolve — 规范化与存在性", () => {
  test("解析相对路径到绝对路径", () => {
    const resolved = FSUtil.resolve("src")
    expect(resolved).toMatch(/^[A-Za-z]:\\.*src$/)
  })

  test("规范化分隔符（正斜杠 → 反斜杠）", () => {
    const resolved = FSUtil.resolve("src/utils/helper.ts")
    expect(resolved).not.toContain("/")
    expect(resolved).toContain("\\")
  })

  test("存在的路径返回 realpath（解析软链接）", () => {
    const resolved = FSUtil.resolve("src")
    // realpath 不会改变真实存在路径
    expect(resolved).toMatch(/^[A-Za-z]:\\.*src$/)
  })

  test("不存在的路径返回规范化后的绝对路径（不抛异常）", () => {
    const resolved = FSUtil.resolve("this/path/does/not/exist/at/all")
    expect(resolved).toMatch(/^[A-Za-z]:\\.*this\\path\\does\\not\\exist\\at\\all$/)
  })
})