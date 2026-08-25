import { $ } from "bun"

try {
  const result = await $`bunx tsc --noEmit`.quiet()
  console.log(result.stdout.toString())
} catch (e) {
  console.error(e.stderr?.toString() || e.message)
  process.exit(1)
}