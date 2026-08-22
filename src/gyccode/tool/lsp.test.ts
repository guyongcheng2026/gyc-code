import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { filterGitIgnoredLocations } from "./lsp_gitignore"

// Windows git.exe cold starts are slow; allow generous time so the test is
// robust under parallel test-file load.
const GIT_TIMEOUT = 20_000

describe("filterGitIgnoredLocations", () => {
  test("returns empty array for empty input", async () => {
    const result = await filterGitIgnoredLocations([], process.cwd())
    expect(result).toEqual([])
  })

  test("filters out git-ignored files using git check-ignore", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gyc-gitignore-"))
    try {
      spawnSync("git", ["init", "-q", dir])
      await writeFile(path.join(dir, ".gitignore"), "node_modules/\ndist/\n")

      const locations = [
        { uri: pathToFileURL(path.join(dir, "src", "main.ts")).href },
        { uri: pathToFileURL(path.join(dir, "node_modules", "foo.js")).href },
        { uri: pathToFileURL(path.join(dir, "dist", "bundle.js")).href },
      ]

      const result = await filterGitIgnoredLocations(locations, dir)
      expect(result).toEqual([locations[0]])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, GIT_TIMEOUT)
})
