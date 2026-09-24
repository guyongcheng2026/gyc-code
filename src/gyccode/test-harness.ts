// CLI Integration Test Harness
// Provides utilities to spawn gyc CLI, send commands, and assert outputs.

import { spawn, SpawnOptions } from "child_process"
import { join } from "path"
import { fileURLToPath } from "url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const CLI_ENTRY = join(__dirname, "index.ts")

export interface CLIResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface CLIProcess {
  proc: ReturnType<typeof spawn>
  stdout: string
  stderr: string
  write: (data: string) => void
  waitForExit: (timeoutMs?: number) => Promise<CLIResult>
  kill: (signal?: NodeJS.Signals) => void
}

/** Spawn the gyc CLI with given args and optional stdin/stdout handling */
export function spawnCLI(
  args: string[] = [],
  options: SpawnOptions = {}
): CLIProcess {
  const env = {
    ...process.env,
    GYCCODE_PURE: "1",
    GYCCODE_DISABLE_LEARNED_SKILLS: "1",
    NODE_NO_WARNINGS: "1",
  }

  const proc = spawn("bun", ["--preload", "./scripts/bun-solid-preload.ts", "--conditions=browser", CLI_ENTRY, ...args], {
    cwd: join(__dirname, "..", ".."),
    stdio: ["pipe", "pipe", "pipe"],
    env,
    ...options,
  })

  let stdout = ""
  let stderr = ""

  proc.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  return {
    proc,
    get stdout() { return stdout },
    get stderr() { return stderr },
    write: (data: string) => proc.stdin?.write(data) ?? false,
    waitForExit: (timeoutMs = 30000) => new Promise<CLIResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill("SIGKILL")
        reject(new Error(`CLI timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      proc.on("exit", (code, signal) => {
        clearTimeout(timer)
        resolve({
          stdout,
          stderr,
          exitCode: code ?? (signal ? -1 : 0),
        })
      })
      proc.on("error", (err) => {
        clearTimeout(timer)
        reject(err)
      })
    }),
    kill: (signal = "SIGTERM") => proc.kill(signal),
  }
}

/** Run a single command and wait for completion */
export async function runCLI(args: string[], timeoutMs = 30000): Promise<CLIResult> {
  const cli = spawnCLI(args)
  return cli.waitForExit(timeoutMs)
}

/** Run CLI with input (for interactive mode) and wait for output containing expected text */
export async function runCLIWithInput(
  args: string[],
  input: string,
  expectedOutput?: string,
  timeoutMs = 30000
): Promise<CLIResult> {
  const cli = spawnCLI(args)
  
  await new Promise(r => setTimeout(r, 500))
  
  cli.write(input)
  cli.write("\n")
  
  const result = await cli.waitForExit(timeoutMs)
  
  if (expectedOutput && !result.stdout.includes(expectedOutput)) {
    throw new Error(`Expected output "${expectedOutput}" not found in stdout:\n${result.stdout}`)
  }
  
  return result
}

/** Assert helpers */
export const assert = {
  exitCode: (result: CLIResult, expected: number) => {
    if (result.exitCode !== expected) {
      throw new Error(`Expected exit code ${expected}, got ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
    }
  },
  contains: (result: CLIResult, text: string, stream: "stdout" | "stderr" = "stdout") => {
    const output = stream === "stdout" ? result.stdout : result.stderr
    if (!output.includes(text)) {
      throw new Error(`Expected "${text}" in ${stream}:\n${output}`)
    }
  },
  notContains: (result: CLIResult, text: string, stream: "stdout" | "stderr" = "stdout") => {
    const output = stream === "stdout" ? result.stdout : result.stderr
    if (output.includes(text)) {
      throw new Error(`Did not expect "${text}" in ${stream}:\n${output}`)
    }
  },
  matches: (result: CLIResult, regex: RegExp, stream: "stdout" | "stderr" = "stdout") => {
    const output = stream === "stdout" ? result.stdout : result.stderr
    if (!regex.test(output)) {
      throw new Error(`Expected match for ${regex} in ${stream}:\n${output}`)
    }
  },
}

/** Test utilities */
export const testUtils = {
  waitFor: async (fn: () => boolean | Promise<boolean>, timeoutMs = 5000, intervalMs = 100): Promise<void> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await fn()) return
      await new Promise(r => setTimeout(r, intervalMs))
    }
    throw new Error(`waitFor timeout after ${timeoutMs}ms`)
  },

  tempDir: async (): Promise<string> => {
    const { mkdtemp } = await import("fs/promises")
    const { tmpdir } = await import("os")
    const { join } = await import("path")
    return mkdtemp(join(tmpdir(), "gyc-test-"))
  },

  cleanupDir: async (dir: string): Promise<void> => {
    const { rm } = await import("fs/promises")
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  },
}

export { test, expect, describe } from "bun:test"