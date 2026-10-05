// 应用 @opentui/core win32 终端尺寸轮询 patch（bun install 后自动运行）
//
// 背景（2026-10-05 排查）：opentui 的终端尺寸变化只有 POSIX 信号源
// —— process.on("SIGWINCH", this.sigwinchHandler)（chunk-node-ks0581vk.js:7358），
// handler 读 this.stdout.columns / rows（:7133-7137），去抖 100ms（:7323）。
// 全库无 stdout.on("resize")，也无 win32 WM_SIZE / GetConsoleScreenBufferInfo 轮询；
// 所有 onResize 实现（:934/:967/:3001/:3210/:5793）都是被动回调，不是事件源。
// 结果：Windows 下拖拽终端窗口 / 最大化不触发重排，布局错乱且句柄估算失准。
// 已实测 0.5.14 仍未修此问题，故本补丁在升级后依然需要。
//
// 修复：win32 平台增加低频尺寸轮询（500ms），检测到变化就复用既有的
// sigwinchHandler —— 走的是与 POSIX 完全相同的 handleResize 去抖路径，
// 不改动上游任何渲染逻辑。
//
// 用法：bun install 后执行；幂等，已应用则跳过；未匹配原版则 exit(1)。
const fs = require("fs");
const path = require("path");

const coreDir = path.join(__dirname, "..", "node_modules", "@opentui", "core");

// 幂等标记必须取「实际写入代码里真实出现的字符串」。早期版本用
// "gyc-win32-resize-poll"（只在注释里出现），而写入代码用的是驼峰的
// gycWin32ResizePoll —— 标记永不命中，连跑两次就插两份轮询定时器。
const MARKER = "gycWin32ResizePoll";

const POLL_INTERVAL_MS = 500;

const RESIZE_FROM = [
  "  sigwinchHandler = (() => {",
  "    const width = this.stdout.columns || 80;",
  "    const height = this.stdout.rows || 24;",
  "    this.handleResize(width, height);",
  "  }).bind(this);",
].join("\n");

// 插在 sigwinchHandler 定义之后：轮询回调里要调 this.sigwinchHandler()，
// 放前面虽然因为 setInterval 延迟执行而运行时恰好安全，但依赖时序，不稳健。
const RESIZE_TO = [
  "  sigwinchHandler = (() => {",
  "    const width = this.stdout.columns || 80;",
  "    const height = this.stdout.rows || 24;",
  "    this.handleResize(width, height);",
  "  }).bind(this);",
  `  gycWin32ResizePoll = process.platform === "win32" && _usesProcessStdout ? setInterval(() => {`,
  "    const c = this.stdout.columns;",
  "    const r = this.stdout.rows;",
  "    if (!c || !r) return;",
  "    if (c === this.width && r === this.height) return;",
  "    this.sigwinchHandler();",
  `  }, ${POLL_INTERVAL_MS}) : null;`,
].join("\n");

const CLEANUP_FROM = [
  "    if (this._usesProcessStdout) {",
  '      process.removeListener("SIGWINCH", this.sigwinchHandler);',
  "    }",
].join("\n");

const CLEANUP_TO = [
  "    if (this._usesProcessStdout) {",
  '      process.removeListener("SIGWINCH", this.sigwinchHandler);',
  "    }",
  "    if (this.gycWin32ResizePoll) {",
  "      clearInterval(this.gycWin32ResizePoll);",
  "      this.gycWin32ResizePoll = null;",
  "    }",
].join("\n");

if (!fs.existsSync(coreDir)) {
  console.log("[gyc-patch] 未找到 @opentui/core，跳过");
  process.exit(0);
}

// chunk 文件名随版本变化（0.5.6: chunk-node-ks0581vk.js，0.5.14: chunk-node-wp7ct2m6.js），
// 必须按内容动态定位，不能硬编码文件名——否则升级后会作用在错误的文件上，
// 且因 marker 检查而「静默跳过」，留下一份未打补丁的渲染器。
const candidates = fs.readdirSync(coreDir).filter((f) => /^chunk-node-.*\.js$/.test(f));
const target = candidates
  .map((f) => path.join(coreDir, f))
  .find((f) => {
    try {
      return fs.readFileSync(f, "utf8").includes(RESIZE_FROM)
    } catch {
      return false
    }
  });

if (!target) {
  console.error(
    "[gyc-patch] 未在 @opentui/core 的 chunk-node-*.js 中匹配到 sigwinchHandler 锚点，" +
      "patch 失败（版本可能已变更或上游已自行修复）",
  );
  process.exit(1);
}

let src = fs.readFileSync(target, "utf8");

// 幂等判定必须看「轮询赋值块是否完整存在」，而不是只看标识符是否出现过：
// 标识符在清理块里也会出现，若只查它，处于「只有清理块」的半应用状态会被
// 误判为已完成，从而永远补不上轮询。
const applied = src.includes(RESIZE_TO) && src.includes(CLEANUP_TO);
const partial = src.includes(MARKER) && !applied;

if (applied) {
  console.log("[gyc-patch] win32 尺寸轮询 patch 已生效，跳过");
  process.exit(0);
}

if (partial) {
  console.error(
    "[gyc-patch] 检测到半应用状态（清理块在、轮询块缺），patch 失败。" +
      "请执行 node_modules 全新安装后重试",
  );
  process.exit(1);
}

if (!src.includes(RESIZE_FROM)) {
  console.error("[gyc-patch] 未匹配到原版 sigwinchHandler 代码，patch 失败（版本可能升级）");
  process.exit(1);
}
src = src.replace(RESIZE_FROM, RESIZE_TO);

if (src.includes(CLEANUP_FROM)) {
  src = src.replace(CLEANUP_FROM, CLEANUP_TO);
} else {
  console.error("[gyc-patch] 未匹配到 SIGWINCH 清理代码，patch 失败（销毁时会泄漏轮询定时器）");
  process.exit(1);
}

fs.writeFileSync(target, src);
console.log("[gyc-patch] @opentui/core win32 尺寸轮询 patch 已应用");