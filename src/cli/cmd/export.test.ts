import { describe, expect, test } from "bun:test"
import { EOL } from "os"
import { csvField, toCSV, messageRows } from "./export"

const lines = (csv: string) => csv.split(EOL)

describe("csvField（RFC 4180 转义）", () => {
  test("含逗号时用双引号包裹", () => {
    expect(csvField("a,b")).toBe('"a,b"')
  })

  test("含双引号时包裹且内部双引号写两个", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
  })

  test("含换行时包裹（LF 与 CRLF 都算）", () => {
    expect(csvField("a\nb")).toBe('"a\nb"')
    expect(csvField("a\r\nb")).toBe('"a\r\nb"')
  })

  test("不含特殊字符时原样输出，不加引号", () => {
    expect(csvField("plain")).toBe("plain")
  })

  test("空串保持空串", () => {
    expect(csvField("")).toBe("")
  })

  test("null / undefined 表示为空串（与 db.ts 的 TSV 空值习惯一致）", () => {
    expect(csvField(null)).toBe("")
    expect(csvField(undefined)).toBe("")
  })

  test("数字与布尔直接转字符串", () => {
    expect(csvField(0)).toBe("0")
    expect(csvField(-1.5)).toBe("-1.5")
    expect(csvField(true)).toBe("true")
    expect(csvField(false)).toBe("false")
  })

  test("对象按 JSON 序列化后再转义", () => {
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"')
  })

  test("含逗号的中文标题正确转义", () => {
    expect(csvField("修复,导出")).toBe('"修复,导出"')
  })
})

describe("toCSV（表头取自实际数据字段）", () => {
  test("空数组返回空串", () => {
    expect(toCSV([])).toBe("")
  })

  test("表头来自行对象的键，不是另写一份常量", () => {
    const csv = toCSV([{ b: 1, a: 2 }])
    expect(lines(csv)[0]).toBe("b,a")
  })

  test("多行的键并集按首次出现顺序展开", () => {
    const csv = toCSV([{ a: 1 }, { b: 2 }])
    expect(lines(csv)[0]).toBe("a,b")
    expect(lines(csv)[1]).toBe("1,")
    expect(lines(csv)[2]).toBe(",2")
  })

  test("每行按表头顺序补齐缺失字段（空值 -> 空串）", () => {
    const csv = toCSV([
      { id: "m1", cost: 0.5 },
      { id: "m2" },
    ])
    expect(lines(csv)).toEqual(["id,cost", "m1,0.5", "m2,"])
  })

  test("字段内的换行不会破坏记录边界", () => {
    const csv = toCSV([{ text: "第一行\n第二行" }])
    expect(lines(csv)).toEqual(["text", '"第一行\n第二行"'])
  })
})

describe("messageRows（CSV 列取自真实消息字段）", () => {
  const assistant = {
    id: "msg_a",
    sessionID: "ses_1",
    role: "assistant",
    agent: "build",
    summary: false,
    time: { created: 1700000000000, completed: 1700000001000 },
    parentID: "msg_u",
    modelID: "claude-sonnet-4",
    providerID: "anthropic",
    mode: "build",
    cost: 0.1234,
    tokens: { total: 30, input: 10, output: 20, reasoning: 0, cache: { read: 5, write: 1 } },
    finish: "stop",
  }
  const user = {
    id: "msg_u",
    sessionID: "ses_1",
    role: "user",
    agent: "build",
    time: { created: 1700000000000 },
    model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
  }

  test("助手消息的用量字段被展开成独立列", () => {
    const [row] = messageRows([{ info: assistant, parts: [] }] as never)
    expect(row!.role).toBe("assistant")
    expect(row!.cost).toBe(0.1234)
    expect(row!.tokensInput).toBe(10)
    expect(row!.tokensOutput).toBe(20)
    expect(row!.tokensCacheRead).toBe(5)
    expect(row!.tokensCacheWrite).toBe(1)
    expect(row!.modelID).toBe("claude-sonnet-4")
    expect(row!.providerID).toBe("anthropic")
  })

  test("用户消息没有用量字段时留空，不编造 0", () => {
    const [row] = messageRows([{ info: user, parts: [] }] as never)
    expect(row!.role).toBe("user")
    expect(row!.cost).toBe("")
    expect(row!.modelID).toBe("claude-sonnet-4")
    expect(row!.parentID).toBe("")
  })

  test("文本部件统计字符数与部件总数", () => {
    const [row] = messageRows([
      {
        info: user,
        parts: [
          { id: "p1", type: "text", text: "导出 CSV" },
          { id: "p2", type: "text", text: "并转义" },
        ],
      },
    ] as never)
    expect(row!.parts).toBe(2)
    expect(row!.textChars).toBe(9) // 6 + 3：中文一字一 UTF-16 码元
  })

  test("toCSV(messageRows(...)) 的表头由实际列推出", () => {
    const csv = toCSV(messageRows([{ info: assistant, parts: [] }] as never))
    const header = lines(csv)[0]!
    expect(header.split(",")).toContain("tokensCacheWrite")
    expect(header.split(",")).toContain("textChars")
    expect(lines(csv)).toHaveLength(2)
  })
})
