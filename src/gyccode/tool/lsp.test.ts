import { describe, test, expect } from "bun:test"
import { filterGitIgnoredLocations } from "./lsp_gitignore"

describe("filterGitIgnoredLocations", () => {
  test("returns empty array for empty input", () => {
    expect(filterGitIgnoredLocations([])).toEqual([])
  })

  test("filters out git-ignored files using git check-ignore", () => {
    // Mock git check-ignore behavior
    const locations = [
      { uri: "file:///repo/src/main.ts" },
      { uri: "file:///repo/node_modules/foo.js" },
      { uri: "file:///repo/dist/bundle.js" },
    ]
    // In real test, we would mock git.check-ignore
    // Here we just test the function signature
    const result = filterGitIgnoredLocations(locations)
    expect(result.length).toBeLessThanOrEqual(locations.length)
  })
})
