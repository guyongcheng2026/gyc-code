// 应用 @opentui/solid 孤儿空文本 patch（bun install 后自动运行）
// 背景：Solid 的 Show/条件渲染在 falsy 分支会把空字符串 "" 作为占位插入
// children；@opentui/solid 的 reconciler 将其文本化并因缺少 <text>
// 父级抛 "Orphan text error"（undefined/null/false 均被跳过，唯独 "" 例外）。
// 修复：_insertNode 里「确实要抛 orphan 错误」的那条分支内，内容为空串则跳过。
//
// 为什么空串守卫必须放在 orphan 分支**里面**（2026-10-11 排查）：
// 旧版把空串检查放在 `isTextNodeRenderable(node)` 之后、父级检查之前，
// 而该判断对 <b>/<span> 这类内联元素同样成立。内联元素是「先插入空壳节点、
// 随后再挂文本子节点」，插入那一刻 toChunks() 必然为空 —— 旧守卫据此 return，
// 节点永不进树，内容永久丢失。表现：会话标题、footer（GYC CODE）、侧栏各
// 插件标题（cwd/lsp/files/mcp/… 都用 <b>）整块不显示，而带 style 的 span
// 因编码为 StyledText chunks 幸免，恰好造成「有些行在、有些行没了」的错乱。
// 放进 orphan 分支后：parent 是 text 时根本不进该分支（内联元素正常插入），
// 只有真正会抛错的孤儿场景才按空串跳过，原意图完整保留。
//
// 用法：bun install 后执行；幂等，已应用则跳过（并支持从旧版就地升级）。
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

const THROW_LINE = `      throw new Error(\`Orphan text error: "\${node.toChunks().map((c) => c.text).join("")}" must have a <text> as a parent: \${parent.id} above \${node.id}\`);`;

// 上游原文（未打补丁）
const FROM = `  if (isTextNodeRenderable(node)) {
    if (!(parent instanceof TextRenderable2) && !isTextNodeRenderable(parent)) {
${THROW_LINE}
    }
  }`;
// 目标：空串守卫移入 orphan 分支内部
const TO = `  if (isTextNodeRenderable(node)) {
    if (!(parent instanceof TextRenderable2) && !isTextNodeRenderable(parent)) {
      if (node.toChunks().map((c) => c.text).join("") === "") {
        return;
      }
${THROW_LINE}
    }
  }`;
// 旧版（空串守卫在父级检查之前，会误杀内联元素）
const LEGACY = `  if (isTextNodeRenderable(node)) {
    if (node.toChunks().map((c) => c.text).join("") === "") {
      return;
    }
    if (!(parent instanceof TextRenderable2) && !isTextNodeRenderable(parent)) {
${THROW_LINE}
    }
  }`;
// 新版本特征（幂等判据；必须与旧版区分，否则升级时会被误判为「已生效」）
const APPLIED = `    if (!(parent instanceof TextRenderable2) && !isTextNodeRenderable(parent)) {
      if (node.toChunks().map((c) => c.text).join("") === "") {`;

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
  if (src.includes(APPLIED)) {
    console.log(`[gyc-patch] ${name} 孤儿空文本 patch 已生效（新版），跳过`);
    continue;
  }
  if (src.includes(LEGACY)) {
    fs.writeFileSync(target, src.replace(LEGACY, TO));
    console.log(`[gyc-patch] ${name} 孤儿空文本 patch 已从旧版升级（误杀内联元素 → 守卫移入 orphan 分支）`);
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
