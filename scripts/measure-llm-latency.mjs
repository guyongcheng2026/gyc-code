// LLM 首包延时测量脚本
// 用法: bun scripts/measure-llm-latency.mjs

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "..")
const distEntry = join(projectRoot, "dist", "index.js")
const gycBin = join(projectRoot, "bin", "gyc")
const isWindows = process.platform === "win32"

// V8 heap flags (from bin/gyc)
function nodeHeapFlags() {
  const os = require("os")
  const explicit = Number(process.env.GYC_MAX_OLD_SPACE)
  const mb = Number.isFinite(explicit) && explicit > 0
    ? Math.round(explicit)
    : Math.min(Math.max(Math.round((os.totalmem() / 1024 / 1024) * 0.6), 1024), 4096)
  return ["--expose-gc", `--max-old-space-size=${mb}`]
}

function readRuntimeMarker(distDir) {
  try {
    return readFileSync(join(distDir, "RUNTIME"), "utf8").trim()
  } catch {
    return undefined
  }
}

function findNode() {
  const candidates = [
    process.env.GYC_NODE,
    "C:\\Program Files\\nodejs\\node.exe",
    join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
  ].filter(Boolean)
  return candidates.find((c) => existsSync(c)) || "node"
}

async function runGyc(prompt) {
  const node = findNode()
  const heapFlags = nodeHeapFlags()
  const hasHeapFlags = process.execArgv.some(arg => arg.startsWith("--max-old-space-size") || arg === "--expose-gc")
  
  // If we don't have heap flags, re-exec with them (like bin/gyc does)
  const args = hasHeapFlags 
    ? [distEntry, "run", prompt]
    : [...heapFlags, distEntry, "run", prompt]
  
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { 
        ...process.env, 
        GYCCODE_FAST_BOOT: "1",
        NODE_COMPILE_CACHE: process.env.GYC_COMPILE_CACHE_DIR || join(require("os").tmpdir(), "gyc-compile-cache")
      },
      shell: false,
      windowsHide: true
    })

    let stdout = ""
    let stderr = ""
    let firstTokenTime = null
    let firstTokenReceived = false
    const startTime = process.hrtime.bigint()

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString()
      stdout += text
      
      if (!firstTokenReceived && text.trim().length > 0) {
        firstTokenTime = process.hrtime.bigint()
        firstTokenReceived = true
        const latencyMs = Number(firstTokenTime - startTime) / 1_000_000
        console.log(`⚡ 首包延时: ${latencyMs.toFixed(2)} ms`)
        console.log(`📄 首包内容: ${text.trim().slice(0, 100)}`)
      }
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", (err) => {
      reject(err)
    })

    child.on("close", (code) => {
      const endTime = process.hrtime.bigint()
      const totalMs = Number(endTime - startTime) / 1_000_000
      
      console.log("")
      console.log("📊 测量结果:")
      console.log(`   退出码: ${code}`)
      console.log(`   总耗时: ${totalMs.toFixed(2)} ms`)
      
      if (firstTokenReceived) {
        const latencyMs = Number(firstTokenTime - startTime) / 1_000_000
        console.log(`   首包延时: ${latencyMs.toFixed(2)} ms`)
        console.log(`   目标: ≤ 1000 ms`)
        console.log(`   状态: ${latencyMs <= 1000 ? "✅ 达标" : "❌ 超标"}`)
      } else {
        console.log("   ❌ 未收到首包输出")
        console.log(`   stderr: ${stderr.slice(0, 500)}`)
      }
      
      if (code !== 0) {
        console.log(`   错误输出: ${stderr.slice(0, 500)}`)
      }
      
      resolve({
        totalMs,
        firstTokenMs: firstTokenReceived ? Number(firstTokenTime - startTime) / 1_000_000 : null,
        success: code === 0 && firstTokenReceived,
        latencyOk: firstTokenReceived && Number(firstTokenTime - startTime) / 1_000_000 <= 1000,
        code,
        stderr
      })
    })

    // 60秒超时
    setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error("测量超时 (60s)"))
    }, 60_000)
  })
}

async function runMultiple() {
  const results = []
  
  for (let i = 1; i <= 3; i++) {
    console.log(`\n=== 第 ${i}/3 次测量 ===`)
    try {
      const result = await runGyc("只回复 OK，不要任何其他内容")
      results.push(result)
    } catch (err) {
      console.error(`第 ${i} 次失败:`, err.message)
      results.push({ success: false, error: err.message })
    }
    
    if (i < 3) {
      console.log("等待 3 秒后继续...")
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  
  console.log("\n\n📈 汇总:")
  const successful = results.filter(r => r.success)
  if (successful.length > 0) {
    const latencies = successful.map(r => r.firstTokenMs).sort((a, b) => a - b)
    const median = latencies[Math.floor(latencies.length / 2)]
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length
    const min = latencies[0]
    const max = latencies[latencies.length - 1]
    
    console.log(`   成功次数: ${successful.length}/3`)
    console.log(`   中位数首包延时: ${median.toFixed(2)} ms`)
    console.log(`   平均首包延时: ${avg.toFixed(2)} ms`)
    console.log(`   最小: ${min.toFixed(2)} ms`)
    console.log(`   最大: ${max.toFixed(2)} ms`)
    console.log(`   目标达标率: ${successful.filter(r => r.latencyOk).length}/${successful.length}`)
  } else {
    console.log("   所有测量均失败")
    results.forEach((r, i) => {
      console.log(`   第 ${i+1} 次: code=${r.code}, stderr=${r.stderr?.slice(0, 200)}`)
    })
  }
}

runMultiple().catch(console.error)