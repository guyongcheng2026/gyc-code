import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * 长会话 / 超长会话崩溃（`Failed to create TextBuffer`）的回归闸门。
 *
 * opentui 0.5.6 的原生句柄表上限 65,535，`<markdown>` / `<code>` / `<diff>` 内部
 * 按行创建 text_buffer。`src/tui/util/handle-budget.ts` 提供了预算闸门，
 * `src/tui/component/limited-content.tsx` 提供了行数/字节折叠 + 预算降级的统一入口。
 *
 * 之前只有 3 处渲染点接了 LimitedContent，而 `<code>`（Write 工具写出的文件内容）、
 * apply_patch 的逐文件 `<diff>`、diff-viewer 面板、权限审批弹窗这 4 条路径是直连的
 * —— 一次写大文件或一次改几十个文件就能单独吃光句柄表，表现为「打开会话即退出」。
 *
 * 这里锁的是**接线关系**而非运行时行为：opentui 的真实渲染需要原生终端，
 * 纯 bun test 里起不来。用源码文本断言是本仓既有做法（见 read-sensitive.test.ts）。
 */

// 本文件位于 src/tui/routes/session/ 下，仓库根需上溯三级。
const SRC = path.join(import.meta.dir, "..", "..", "..")

const read = (relative: string) => readFileSync(path.join(SRC, relative), "utf8")

describe("所有富渲染点都必须过 LimitedContent 闸门", () => {
  // 每个渲染点：文件 → <markdown>/<code>/<diff> 出现的行号
  const richPoints: { file: string; tag: "markdown" | "code" | "diff" }[] = [
    { file: "tui/routes/session/index.tsx", tag: "markdown" },
    { file: "tui/routes/session/index.tsx", tag: "code" },
    { file: "tui/routes/session/index.tsx", tag: "diff" },
    { file: "tui/feature-plugins/system/diff-viewer.tsx", tag: "diff" },
    { file: "tui/routes/session/permission.tsx", tag: "diff" },
  ]

  for (const { file, tag } of richPoints) {
    test(`${file} 的 <${tag}> 在 LimitedContent 的 rich 分支内`, () => {
      const source = read(file)
      const lines = source.split("\n")
      const hits: number[] = []
      lines.forEach((line, index) => {
        // 只统计真正的 JSX 开标签：注释里的 "<diff" 与字符串里的不算
        if (line.trimStart().startsWith("{")) return
        if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return
        if (new RegExp(`<${tag}(\\s|$|/|>)`).test(line)) hits.push(index)
      })
      expect(hits.length).toBeGreaterThan(0)

      for (const hit of hits) {
        // 从该行往上找最近的 LimitedContent 开标签；rich 分支必须由它包裹。
        let depth = 0
        let guarded = false
        for (let i = hit; i >= 0 && i > hit - 80; i--) {
          const line = lines[i]!
          if (/<LimitedContent/.test(line)) {
            // LimitedContent 之后的行都在其作用域内，直到出现同级闭合。
            // 这里用粗粒度判断：从 LimitedContent 行到该 tag 行之间不得出现
            // 另一个块的闭合——简化为：LimitedContent 行必须在该 tag 行之前 80 行内。
            guarded = true
            depth++
            break
          }
        }
        expect(
          guarded,
          `${file}:${hit + 1} 的 <${tag}> 未被 LimitedContent 包裹——` +
            `这条渲染路径会绕过句柄预算，长会话下可能直接撞上 opentui 句柄上限`,
        ).toBe(true)
      }
    })
  }
})

describe("LimitedContent 接线完整性", () => {
  test("Write 工具把写出的内容也送进闸门（<code> 此前是直连的）", () => {
    const source = read("tui/routes/session/index.tsx")
    const writeStart = source.indexOf("function Write(props: ToolProps)")
    expect(writeStart).toBeGreaterThan(-1)
    const body = source.slice(writeStart, writeStart + 2200)
    expect(body).toContain("<LimitedContent")
    // 折叠提示必须让用户看见降级发生，不做静默截断
    expect(read("tui/component/limited-content.tsx")).toContain("已折叠")
  })

  test("apply_patch 的逐文件 diff 走闸门（一次改 N 个文件 = N 份 diff 并存）", () => {
    const source = read("tui/routes/session/index.tsx")
    const patchStart = source.indexOf("function ApplyPatch(props: ToolProps)")
    expect(patchStart).toBeGreaterThan(-1)
    const body = source.slice(patchStart, patchStart + 3000)
    expect(body).toContain("<LimitedContent")
  })

  test("diff-viewer 面板为每个文件的 patch 提供列宽（否则折行估算退化到默认 80）", () => {
    const source = read("tui/feature-plugins/system/diff-viewer.tsx")
    expect(source).toContain("cols={patchPaneWidth()}")
  })

  test("权限审批弹窗的 diff 也过闸门（模态界面停留时间长，风险更高）", () => {
    const source = read("tui/routes/session/permission.tsx")
    expect(source).toContain("cols={dimensions().width}")
    expect(source).toContain("<LimitedContent")
  })
})

describe("句柄预算闸门本身的前提", () => {
  test("budget 是保守估算 + 进程内累计，而不是读 opentui 真实句柄数", () => {
    const source = read("tui/util/handle-budget.ts")
    // 注释里已写明这个取舍，锁住它避免有人后来改成读真实值却没实现
    expect(source).toContain("保守估算")
    expect(source).toContain("NATIVE_HANDLE_LIMIT")
    // 常驻 renderable 必须有预留，否则 prompt 输入框本身就可能把预算占满
    expect(source).toContain("RESERVED_HANDLES")
  })

  test("预算耗尽时全局降级为纯文本，而不是撞上限崩溃", () => {
    const source = read("tui/component/limited-content.tsx")
    expect(source).toContain("fallback")
    // 必须真的占用预算：此前只用 fits() 纯查询，used() 恒 0，
    // 多条内容各自都判定装得下，累计起来照样能撞 65,535 的原生上限。
    expect(source).toContain("globalHandleBudget.reserve")
    // 卸载/换文本时归还，否则占用只增不减，降级会来得越来越早
    expect(source).toContain("globalHandleBudget.release")
  })

  test("安全模式降级通道仍然存在（原生崩溃后的最后兜底）", () => {
    const source = read("tui/fallback/safe-mode.ts")
    expect(source).toContain("runFallbackSafeMode")
    // 一次性降级护栏，防止「崩溃→降级→再崩」循环
    expect(source).toContain("claimFallbackOnce")
  })
})
