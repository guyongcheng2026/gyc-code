import { describe, expect, test } from "bun:test"
import { match } from "./wildcard"

describe("wildcard.match", () => {
  describe("P0-6: ** double-star must not allow single * to cross directories", () => {
    test("single * matches files in same directory only", () => {
      expect(match("src/foo.ts", "src/*.ts")).toBe(true)
      expect(match("src/sub/foo.ts", "src/*.ts")).toBe(false)
    })

    test("** matches across directories", () => {
      expect(match("src/foo.ts", "src/**")).toBe(true)
      expect(match("src/sub/foo.ts", "src/**")).toBe(true)
      expect(match("src/sub/deep/foo.ts", "src/**")).toBe(true)
    })

    test("** alone matches anything", () => {
      expect(match("a", "**")).toBe(true)
      expect(match("a/b/c", "**")).toBe(true)
      expect(match("a/b/c.txt", "**")).toBe(true)
    })

    test("pattern * alone matches one path segment", () => {
      expect(match("foo", "*")).toBe(true)
      expect(match("foo/bar", "*")).toBe(false)
    })

    test("**/secrets/** matches secrets at any depth including root", () => {
      expect(match("secrets/foo", "**/secrets/**")).toBe(true)
      expect(match("a/b/secrets/c.txt", "**/secrets/**")).toBe(true)
    })

    test("**/foo/** does not match sibling paths", () => {
      expect(match("foo/bar", "**/foo/**")).toBe(true)
      expect(match("x/foo/y", "**/foo/**")).toBe(true)
      expect(match("fooz/bar", "**/foo/**")).toBe(false)
    })
  })

  describe("regression: existing valid patterns", () => {
    test("file extension matching", () => {
      expect(match("foo.ts", "*.ts")).toBe(true)
      expect(match("foo.tsx", "*.ts")).toBe(false)
    })

    test("? single char wildcard", () => {
      expect(match("foo.ts", "fo?.ts")).toBe(true)
      expect(match("fop.ts", "fo?.ts")).toBe(true)
      expect(match("fooxs", "fo?.ts")).toBe(false)
    })

    test("backslash normalized to slash", () => {
      expect(match("src\\foo.ts", "src/foo.ts")).toBe(true)
    })

    test("trailing space wildcard preservation", () => {
      expect(match("foo bar", "foo *")).toBe(true)
      expect(match("foo bar baz", "foo *")).toBe(true)
    })

    test("literal dot", () => {
      expect(match("foo.ts", "foo.ts")).toBe(true)
      expect(match("fooxs", "foo.ts")).toBe(false)
    })
  })

  describe("security: permission boundary must hold", () => {
    test("narrow pattern '*.ts' must not match nested .ts", () => {
      expect(match("foo.ts", "*.ts")).toBe(true)
      expect(match("src/foo.ts", "*.ts")).toBe(false)
    })

    test("deny-all with ** must still cover all paths", () => {
      expect(match("anything.txt", "**")).toBe(true)
      expect(match("sub/path/file.js", "**")).toBe(true)
    })

    test("rule with ** in middle must not over-match siblings", () => {
      expect(match("a/x/c", "a/**/c")).toBe(true)
      expect(match("a/c", "a/**/c")).toBe(true)
      expect(match("a/x/y/c", "a/**/c")).toBe(true)
    })

    test("no rule with ** must allow over-permission", () => {
      expect(match("safe/file.txt", "safe/*")).toBe(true)
      expect(match("safe/sub/file.txt", "safe/*")).toBe(false)
    })
  })

  describe("edge cases", () => {
    test("empty pattern matches empty", () => {
      expect(match("", "")).toBe(true)
    })

    test("unicode paths", () => {
      expect(match("项目/文件.ts", "项目/*.ts")).toBe(true)
      expect(match("项目/子/文件.ts", "项目/*.ts")).toBe(false)
    })

    test("dot in filename", () => {
      expect(match("foo.test.ts", "foo.*.ts")).toBe(true)
      expect(match("foobar.ts", "foo.*.ts")).toBe(false)
    })

    test("multiple slashes treated normally", () => {
      expect(match("a/b/c", "a/b/c")).toBe(true)
      expect(match("a/b/c", "a/*/c")).toBe(true)
    })
  })
})
