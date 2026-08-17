// 应用 @opentui/solid 孤儿空文本 patch（bun install 后自动运行）
// 背景：Solid 的 Show/条件渲染在 falsy 分支会把空字符串 "" 作为占位插入
// children；@opentui/solid 0.4.5 的 reconciler 将其文本化并因缺少 <text>
// 父级抛 "Orphan text error"（undefined/null/false 均被跳过，唯独 "" 例外）。
// 修复：_insertNode 对内容为空字符串的文本节点直接跳过（无渲染意义）。
// 用法：bun install 后执行；幂等，已应用则跳过。
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "node_modules", "@opentui", "solid", "index.bun.js");

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

if (!fs.existsSync(target)) {
  console.log("[gyc-patch] 未找到 @opentui/solid，跳过");
  process.exit(0);
}

const src = fs.readFileSync(target, "utf8");
if (src.includes('join("") === ""')) {
  console.log("[gyc-patch] 孤儿空文本 patch 已生效，跳过");
  process.exit(0);
}
if (!src.includes(FROM)) {
  console.error("[gyc-patch] 未匹配到原版代码，patch 失败（版本可能升级）");
  process.exit(1);
}

fs.writeFileSync(target, src.replace(FROM, TO));
console.log("[gyc-patch] @opentui/solid 孤儿空文本 patch 已应用");
