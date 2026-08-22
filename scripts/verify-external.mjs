// Verify that externalized provider factory packages resolve at runtime from
// node_modules (they are NOT inlined into dist). Mirrors the build.mjs
// `external` list so any drift is caught here.
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeFileSync } from "node:fs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(path.join(root, "package.json"))
const lines = []
const log = (line) => {
  lines.push(line)
  console.log(line)
}

// Must stay in sync with build.mjs `external` (provider factories only).
const EXTERNAL = [
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/anthropic",
  "@ai-sdk/azure",
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/xai",
  "@ai-sdk/mistral",
  "@ai-sdk/groq",
  "@ai-sdk/deepinfra",
  "@ai-sdk/cerebras",
  "@ai-sdk/cohere",
  "@ai-sdk/gateway",
  "@ai-sdk/togetherai",
  "@ai-sdk/perplexity",
  "@ai-sdk/vercel",
  "@openrouter/ai-sdk-provider",
  "venice-ai-sdk-provider",
  "ai-gateway-provider",
  "@aws-sdk/credential-providers",
]

// Core runtime imports that MUST stay inlined (never external).
const CORE_INLINE = ["ai", "@ai-sdk/provider", "@ai-sdk/provider-utils"]

let failed = 0

for (const pkg of EXTERNAL) {
  try {
    const resolved = require.resolve(pkg)
    log(`OK   ${pkg} -> ${path.relative(root, resolved)}`)
  } catch (error) {
    failed += 1
    log(`MISS ${pkg} (${error.code ?? error.message})`)
  }
}

for (const pkg of CORE_INLINE) {
  try {
    require.resolve(pkg)
    log(`OK   [core-inline] ${pkg}`)
  } catch (error) {
    failed += 1
    log(`MISS [core-inline] ${pkg} (${error.code ?? error.message})`)
  }
}

const summary = failed === 0 ? "ALL RESOLVED" : `${failed} UNRESOLVED`
log(summary)
// Also persist an ASCII report next to the repo root (PowerShell redirects
// produce UTF-16 files that some tools cannot decode).
writeFileSync(path.join(root, "verify-ext.out"), lines.join("\n") + "\n", "utf8")
process.exit(failed === 0 ? 0 : 1)
