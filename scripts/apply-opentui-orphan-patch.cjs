// 应用 @opentui/solid 孤儿空文本 patch（bun install 后自动运行）
// 背景：Solid 的 Show/条件渲染在 falsy 分支会把空字符串 "" 作为占位插入
// children；@opentui/solid 的 reconciler 将其文本化并因缺少 <text>
// 父级抛 "Orphan text error"（undefined/null/false 均被跳过，唯独 "" 例外）。
// 修复：_insertNode 对内容为空字符串的文本节点直接跳过（无渲染意义）。
// 用法：bun install 后执行；幂等，已应用则跳过。
//
// 为什么必须同时打 index.bun.js 与 index.js（2026-10-07 复核）：
// package.json 的 exports 对同一入口按条件指向两个不同文件——
//   "bun" -> ./index.bun.js   "node"/"import"/"default" -> ./index.js
// 而发布产物 dist 是 **Node 目标**：dist/RUNTIME 写 "node"，build.mjs:162 对
// node 目标用 conditions ["node","browser"]，命中 "node" 条件解析到 index.js。
// 只打 index.bun.js 等于开发环境（bun run dev 命中 "bun" 条件）有防护、
// 线上产物（bin/gyc 走 dist）无防护，表现为「开发不复现、线上偶发崩」。
// 实证：未打补丁时 dist/index.js 里 `if (Vx(t)) {` 后直接接 throw，
// 缺少本补丁插入的空串守卫。
const fs = require("fs");
const path = require("path");

const solidDir = path.join(__dirname, "..", "node_modules", "@opentui", "solid");
// 两个条件分支都要覆盖，缺一个就会在另一种运行时下静默失效。
const TARGETS = ["index.bun.js", "index.js"];

const FROM = `  if (isTextNodeRenderable(node)) {
    if (!(parent instanceof TextRenderable2) && !isTextNodeRenderable(parent)) {
      throw new Error(\`Orphan text error: "\${node.toChunks().map((c) => c.text).join("")}" must have a <text> as a parent: \${parent.id} above \${node.id}\`);
    }
  }`;
const TO = `  if (isTextNodeRenderable(node)) {
    if (node.toChunks().map((c) => c.text).join("") === "") {
      return;
    }
    if (!(parent instanceof TextRenderable2) && !isTextNodeRenderable(parent)) {
      throw new Error(\`Orphan text error: "\${node.toChunks().map((c) => c.text).join("")}" must have a <text> as a parent: \${parent.id} above \${node.id}\`);
    }
  }`;

if (!fs.existsSync(solidDir)) {
  console.log("[gyc-patch] 未找到 @opentui/solid，跳过");
  process.exit(0);
}

const failed = [];
for (const name of TARGETS) {
  const target = path.join(solidDir, name);
  if (!fs.existsSync(target)) {
    console.log(`[gyc-patch] 未找到 ${name}，跳过`);
    continue;
  }

  const src = fs.readFileSync(target, "utf8");
  if (src.includes('join("") === ""')) {
    console.log(`[gyc-patch] ${name} 孤儿空文本 patch 已生效，跳过`);
    continue;
  }
  if (!src.includes(FROM)) {
    failed.push(name);
    console.error(`[gyc-patch] ${name} 未匹配到原版代码，patch 失败（版本可能升级）`);
    continue;
  }

  fs.writeFileSync(target, src.replace(FROM, TO));
  console.log(`[gyc-patch] ${name} 孤儿空文本 patch 已应用`);
}

if (failed.length > 0) {
  console.error(`[gyc-patch] 孤儿空文本 patch 未覆盖：${failed.join(", ")}`);
  process.exit(1);
}
