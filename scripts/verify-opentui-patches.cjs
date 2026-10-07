// opentui 补丁链完整性校验（postinstall 收尾步骤）
//
// 为什么需要独立校验：补丁脚本（apply-opentui-*.cjs）
// 在「上游版本升级、原文不匹配」时会以 exit(1) 表示失败。旧 postinstall 用 `&&`
// 串联，任一失败即中断后续步骤——包括 git hooks 安装，用户会拿到一个**未打补丁**
// 的 opentui：TUI 直接以「TuiStartupProvider is missing」/「Orphan text error」
// 崩溃，且没有任何提示指向真正的原因。
//
// 本脚本不修改任何文件，只做只读检查并汇总：
//   - 每个补丁的 marker 是否命中
//   - 未命中时打印 WARN 与后果说明，但 **exit 0**：让安装流程正常结束，
//     补丁问题不应阻断用户安装主程序。

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const opentuiDir = path.join(root, "node_modules", "@opentui");
const coreDir = path.join(opentuiDir, "core");
const solidDir = path.join(opentuiDir, "solid");

/** 读取候选文件内容；不存在返回 null。候选可为绝对路径或相对仓库根的路径。 */
function readFirst(candidates) {
  for (const file of candidates) {
    // path.join 会吞掉绝对路径的前导盘符，故先按绝对/相对分流
    const p = path.isAbsolute(file) ? file : path.join(root, file);
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    }
  }
  return null;
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

const results = [];

// ── 1. @opentui/solid 惰性 jsx patch ──────────────────────────────
{
  const src = readFirst([path.join(solidDir, "jsx-runtime.js")]);
  if (src === null) {
    results.push({ name: "@opentui/solid 惰性 jsx", ok: false, reason: "找不到 jsx-runtime.js（包未安装？）" });
  } else {
    const ok = src.includes("return () => createComponent");
    results.push({
      name: "@opentui/solid 惰性 jsx",
      ok,
      reason: ok ? undefined : "函数组件未改为惰性创建，TUI 启动即报 TuiStartupProvider is missing",
    });
  }
}

// ── 2. @opentui/solid 孤儿空文本 patch ────────────────────────────
// 两个条件分支必须分别校验。早先用 readFirst([index.bun.js, index.js]) 只读
// 第一个命中的文件，而 exports 的 "bun" → index.bun.js、"node"/"import" → index.js：
// 只打 index.bun.js 时校验照样报 OK，发布产物（Node 目标 dist）实际无防护，
// 这个盲区正是补丁对线上失效却没人发现的原因。
for (const name of ["index.bun.js", "index.js"]) {
  const src = readFirst([path.join(solidDir, name)]);
  const label = `@opentui/solid 孤儿空文本（${name}）`;
  if (src === null) {
    results.push({ name: label, ok: false, reason: `找不到 ${name}` });
    continue;
  }
  const ok = src.includes('join("") === ""');
  results.push({
    name: label,
    ok,
    reason: ok ? undefined : "空字符串仍会被文本化，条件渲染可抛 Orphan text error",
  });
}

// ── 3. @opentui/core node:ffi→koffi patch ─────────────────────────
{
  // chunk 文件名随版本变化，按内容特征动态探测（与补丁脚本同一策略）
  let found = false;
  let sawNodeFfi = false;
  for (const name of listFiles(coreDir)) {
    if (!/^chunk-node-.*\.js$/.test(name)) continue;
    try {
      const src = fs.readFileSync(path.join(coreDir, name), "utf8");
      if (!src.includes("node:ffi")) continue;
      sawNodeFfi = true;
      if (src.includes("koffiFfiAdapter")) {
        found = true;
        break;
      }
    } catch {}
  }
  if (!sawNodeFfi) {
    results.push({
      name: "@opentui/core node:ffi→koffi",
      ok: false,
      reason: "未找到引用 node:ffi 的 chunk-node-*.js（上游结构已变或包未安装）",
    });
  } else {
    results.push({
      name: "@opentui/core node:ffi→koffi",
      ok: found,
      reason: found ? undefined : "koffi fallback 未注入，Node 运行时 TUI 无法初始化原生渲染",
    });
  }
}

// ── 4. @opentui/core win32 尺寸轮询 patch ─────────────────────────
// 上游只有 POSIX SIGWINCH 一个尺寸事件源，Windows 下拖拽窗口不重排。
// 该 patch 补一个 win32 低频轮询；未打上只是布局不跟随窗口，不致崩溃。
{
  let sawSigwinch = false;
  let found = false;
  for (const name of listFiles(coreDir)) {
    if (!/^chunk-node-.*\.js$/.test(name)) continue;
    try {
      const src = fs.readFileSync(path.join(coreDir, name), "utf8");
      if (!src.includes("sigwinchHandler = (() =>")) continue;
      sawSigwinch = true;
      // 轮询块与清理块必须同时存在，只有一半说明处于半应用状态
      if (src.includes("gycWin32ResizePoll = process.platform") &&
          src.includes("clearInterval(this.gycWin32ResizePoll)")) {
        found = true;
        break;
      }
    } catch {}
  }
  if (!sawSigwinch) {
    results.push({
      name: "@opentui/core win32 尺寸轮询",
      ok: false,
      reason: "未找到 sigwinchHandler 锚点（上游结构已变，或上游已自行提供尺寸事件源）",
    });
  } else {
    results.push({
      name: "@opentui/core win32 尺寸轮询",
      ok: found,
      reason: found ? undefined : "轮询块缺失或只有清理块，Windows 拖拽终端不会重排（不致崩溃）",
    });
  }
}

// ── 5. @opentui/core-win32-x64 平台包完整性 ───────────────────────
// bun 在 Windows 上解包该包时可能静默丢文件（实测 0.5.14 官方 14 个文件只落 4 个），
// 缺 index.js 时 TUI 启动即报「Cannot find module .../index.js」降级安全模式。
// 目录不存在属正常（非 win32-x64 平台不安装该包），不报；
// postinstall 的 repair-opentui-platform.cjs 会在本校验之前自动补齐。
{
  const label = "@opentui/core-win32-x64 平台包完整性";
  const platformDir = path.join(opentuiDir, "core-win32-x64");
  if (fs.existsSync(platformDir)) {
    const required = ["index.js", "index.bun.js", "index.d.ts", "opentui.dll", "package.json"];
    const missing = required.filter((name) => !fs.existsSync(path.join(platformDir, name)));
    results.push({
      name: label,
      ok: missing.length === 0,
      reason: missing.length === 0
        ? undefined
        : `缺少 ${missing.join("、")}（bun 解包残缺）。修复：node scripts/repair-opentui-platform.cjs`,
    });
  }
}

const failed = results.filter((r) => !r.ok);

console.log("[gyc-patch] 补丁链校验：");
for (const r of results) {
  console.log(`  ${r.ok ? "[OK]  " : "[WARN]"} ${r.name}`);
}

if (failed.length > 0) {
  console.warn("[gyc-patch] 以下补丁未生效（TUI 可能不稳定，但不影响其余功能）：");
  for (const r of failed) console.warn(`  - ${r.name}：${r.reason}`);
  console.warn("[gyc-patch] 常见原因：@opentui 升级后原文不匹配。修复：node scripts/apply-opentui-patch.cjs（--force 可重注入）");
}

// 补丁是可选增强，不阻断安装流程
process.exit(0);
