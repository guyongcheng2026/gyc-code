// 应用 @opentui/solid 惰性 jsx patch（bun install 后自动运行）
// 背景：bun 编译 TUI 时函数组件被立即 createComponent，导致 TuiStartupProvider is missing。
// 修复：jsx() 对函数组件改为惰性 return () => createComponent(...)
// 用法：bun install 后执行；幂等，已应用则跳过。
const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "@opentui",
  "solid",
  "jsx-runtime.js"
);

const FROM = `    if (typeof type === "function") {
        return createComponent(type, normalizedProps);
    }`;
const TO = `    if (typeof type === "function") {
        return () => createComponent(type, normalizedProps);
    }`;

if (!fs.existsSync(target)) {
  console.log("[gyc-patch] 未找到 @opentui/solid，跳过");
  process.exit(0);
}

const src = fs.readFileSync(target, "utf8");
if (src.includes("return () => createComponent")) {
  console.log("[gyc-patch] 惰性 patch 已生效，跳过");
  process.exit(0);
}
if (!src.includes(FROM)) {
  console.error("[gyc-patch] 未匹配到原版代码，patch 失败（版本可能升级）");
  process.exit(1);
}

fs.writeFileSync(target, src.replace(FROM, TO));
console.log("[gyc-patch] @opentui/solid 惰性 patch 已应用");
