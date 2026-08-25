// gyc pair：微信 iLink bot 扫码配对，凭据自动写入 ~/.gyc/.env
import { exec } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { EOL } from "node:os"
import process from "node:process"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { pairWeixin } from "@/gateway/pair"

const ENV_KEYS = [
  ["GYC_WEIXIN_TOKEN", (c: { token: string }) => c.token],
  ["GYC_WEIXIN_ACCOUNT_ID", (c: { accountId: string }) => c.accountId],
  ["GYC_WEIXIN_BASE_URL", (c: { baseUrl: string }) => c.baseUrl],
  ["GYC_WEIXIN_HOME_CHANNEL", (c: { homeChannel: string }) => c.homeChannel],
] as const

/** 将配对凭据写入 ~/.gyc/.env：替换既有 GYC_WEIXIN_* 行，缺失则追加。 */
function saveCredentials(credential: { accountId: string; token: string; baseUrl: string; homeChannel: string }): void {
  const envPath = join(homedir(), ".gyc", ".env")
  const values = new Map(ENV_KEYS.map(([key, pick]) => [key, pick(credential)]))
  let lines: string[] = []
  try {
    lines = readFileSync(envPath, "utf-8").split(/\r?\n/)
  } catch {
    lines = []
  }
  const seen = new Set<string>()
  const replaced = lines.map((line) => {
    const match = /^([A-Z0-9_]+)\s*=/.exec(line)
    if (!match || !values.has(match[1])) return line
    seen.add(match[1])
    return `${match[1]}=${values.get(match[1])}`
  })
  const missing = [...values.keys()].filter((key) => !seen.has(key))
  if (missing.length > 0) {
    replaced.push("# gyc 微信网关凭证（gyc pair 写入）", ...missing.map((key) => `${key}=${values.get(key)}`))
  }
  writeFileSync(envPath, replaced.join(EOL), "utf-8")
}

/** 出码即落盘 SVG 页面并自动打开浏览器，供谷总在屏幕上扫码。 */
async function openQrInBrowser(scanData: string): Promise<void> {
  const QRCode = await import("qrcode")
  const svg = await QRCode.toString(scanData, { type: "svg", margin: 2, width: 360 })
  const html =
    '<!doctype html><meta charset="utf-8"><title>gyc 微信配对</title>' +
    '<body style="display:flex;flex-direction:column;align-items:center;gap:16px;font-family:sans-serif">' +
    "<h2>gyc 微信机器人配对</h2><p>请用微信扫码，并在手机上确认登录</p>" +
    svg +
    "</body>"
  const file = join(homedir(), ".gyc", "data", "weixin", "pair-qr.html")
  writeFileSync(file, html, "utf-8")
  exec(`start "" "${file}"`, { shell: "cmd.exe" }, () => undefined)
  process.stdout.write("二维码已在浏览器打开；文件位置：" + file + EOL)
}

export const PairCommand = effectCmd({
  command: "pair",
  describe: "pair the weixin bot via QR scan and save credentials to ~/.gyc/.env",
  instance: false,
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.pair")(function* () {
    process.stdout.write("开始扫码配对（8 分钟内有效）…" + EOL)
    try {
      const credential = yield* Effect.promise(() =>
        pairWeixin((line) => process.stdout.write(line + EOL), openQrInBrowser),
      )
      yield* Effect.promise(() => Promise.resolve(saveCredentials(credential)))
      // 新账号必须从零开始：陈旧的轮询游标/回复凭证会触发服务端 -14 会话超时
      for (const stale of ["sync-buf.json", "context-tokens.json"]) {
        rmSync(join(homedir(), ".gyc", "data", "weixin", stale), { force: true })
      }
      process.stdout.write(`凭据已写入 ~/.gyc/.env（home channel：${credential.homeChannel.slice(0, 16)}…）` + EOL)
      process.stdout.write("已清理旧账号会话数据；请重启网关守护使新凭据生效：gyc gateway" + EOL)
    } catch (cause) {
      return yield* fail(`配对失败：${String(cause)}`)
    }
    return undefined
  }),
})
