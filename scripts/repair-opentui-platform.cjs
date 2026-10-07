// @opentui 平台原生包完整性自愈（postinstall 步骤，在 verify 校验前执行）
//
// 为什么需要：实测（2026-10-07，@opentui 0.5.14，win32-x64）bun 解包
// @opentui/core-win32-x64 时会静默丢文件——官方 14 个文件只落盘 4 个，
// 缺 index.js 导致 TUI 启动即报「Cannot find module .../index.js」降级安全模式。
// bun 的 tarball sha512 校验能通过、解包产物却残缺，丢因未核实（疑似杀软
// 实时扫描干扰解包）。删除目录重装 bun 不会修复（每次解包同样残缺），
// 唯一可靠路径是绕开 bun、用系统 tar 直接解官方 tarball 补齐。
//
// 策略：
//   - 包目录不存在 → 非 win32-x64 平台本就不安装，静默跳过（CI/Linux 不受影响）
//   - 关键文件齐全 → 快速返回，不动网络不改文件
//   - 关键文件缺失 → 从 bun.lock 记录的 registry 地址下载 tarball，
//     sha512 与 bun.lock 记录一致才落盘，系统 tar 解包后拷入包目录
// 任何失败只 WARN 不阻断安装（与 verify-opentui-patches.cjs 同一哲学）。

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const pkgDir = path.join(root, "node_modules", "@opentui", "core-win32-x64");

// index.js 是入口（缺它即触发本 bug），其余为 dlopen/解析链必需
const REQUIRED_FILES = ["index.js", "index.bun.js", "index.d.ts", "opentui.dll", "package.json"];

function missingFiles() {
  return REQUIRED_FILES.filter((name) => !fs.existsSync(path.join(pkgDir, name)));
}

// 从 bun.lock 提取该包的 tarball 地址与 integrity。
// 只命中依赖解析区（": ["..." 形态）；版本声明区的 "pkg": "0.5.14" 不带 [ 不会命中。
function readLockEntry() {
  const text = fs.readFileSync(path.join(root, "bun.lock"), "utf8");
  const m = text.match(
    /"@opentui\/core-win32-x64":\s*\["[^"]*",\s*"([^"]+)",\s*\{[^}]*\},\s*"([^"]+)"/,
  );
  return m ? { tarball: m[1], integrity: m[2] } : null;
}

async function main() {
  if (!fs.existsSync(pkgDir)) return;

  const missing = missingFiles();
  if (missing.length === 0) return;

  console.warn(`[gyc-repair] @opentui/core-win32-x64 安装残缺，缺少：${missing.join("、")}`);

  const entry = readLockEntry();
  if (!entry) throw new Error("bun.lock 中未找到 @opentui/core-win32-x64 的解析条目（锁文件结构已变？）");

  const res = await fetch(entry.tarball);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}：${entry.tarball}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = crypto.createHash("sha512").update(buf).digest("base64");
  if (actual !== entry.integrity.replace(/^sha512-/, "")) {
    throw new Error("tarball sha512 与 bun.lock 记录不一致，拒绝落盘（registry 副本被篡改或损坏）");
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gyc-opentui-"));
  try {
    const tgz = path.join(tmp, "pkg.tgz");
    fs.writeFileSync(tgz, buf);
    const r = spawnSync("tar", ["-xzf", tgz, "-C", tmp], { stdio: "ignore" });
    if (r.status !== 0) throw new Error("系统 tar 解包失败（Windows 10+/macOS/Linux 均自带 tar）");
    // 逐文件覆盖，不用 cpSync 整目录：Windows 上对已存在目录 rename 语义会报
    // 「Cannot overwrite non-directory」，且整目录替换要删旧目录，dll 可能被运行中进程占用
    for (const name of fs.readdirSync(path.join(tmp, "package"))) {
      fs.copyFileSync(path.join(tmp, "package", name), path.join(pkgDir, name));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const stillMissing = missingFiles();
  if (stillMissing.length > 0) throw new Error(`修复后仍缺：${stillMissing.join("、")}`);
  console.log("[gyc-repair] 已从 registry tarball 补齐 @opentui/core-win32-x64");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    console.warn(`[gyc-repair] 自愈失败（不影响安装继续）：${msg}`);
    console.warn("[gyc-repair] 手动修复：node scripts/repair-opentui-platform.cjs 单跑复现报错，或删除 node_modules/@opentui/core-win32-x64 后换网络重装依赖");
    process.exit(0);
  });
