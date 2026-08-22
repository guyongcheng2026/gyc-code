// 应用 @opentui/core 的 node:ffi → koffi 适配 patch（bun install 后自动运行）
// 背景：OpenTUI 的 Node 后端（chunk-node-*.js）依赖 node:ffi 内置模块，而 Node
// 主线尚未内置 node:ffi（本机 Node 实测 require('node:ffi') 报 ERR_UNKNOWN_BUILTIN_MODULE），
// 导致 TUI 在 Node 运行时无法初始化原生渲染。
// 修复：在 chunk 顶层内联 koffiFfiAdapter（用项目依赖 koffi 实现 node:ffi 接口子集），
// 并在 loadBackend/loadBackend2 的 catch 分支注入 koffi fallback。
// 适配函数内联而非外部文件：bun build 打包进 dist 后自包含，运行时经
// createRequire 按包名 "koffi" 从 node_modules 解析（koffi 在 build.mjs external 列表）。
// 用法：bun install 后执行；幂等，已应用则跳过。
const fs = require("fs");
const path = require("path");

const coreDir = path.join(__dirname, "..", "node_modules", "@opentui", "core");
const chunkFile = path.join(coreDir, "chunk-node-q0cwyvm9.js");
const MARK = "koffiFfiAdapter";

// ---- 适配函数（内联注入 chunk 顶层）----
const ADAPTER_FN = `function koffiFfiAdapter(koffi) {
  var TYPE_MAP = { void: "void", bool: "int8_t", u8: "uint8_t", u16: "uint16_t", u32: "uint32_t", u64: "uint64_t", i8: "int8_t", i16: "int16_t", i32: "int32_t", i64: "int64_t", f32: "float", f64: "double", ptr: "void *", pointer: "void *", buffer: "void *", usize: "size_t", cstring: "str", napi_env: "void *", napi_value: "void *", function: "void *", callback: "void *" };
  function mapType(type) {
    if (type && typeof type === "object") throw new Error("node-ffi-koffi: unsupported composite type");
    return TYPE_MAP[type] ?? type;
  }
  function dlopen(libPath, symbols) {
    var lib = koffi.load(libPath);
    var functions = {};
    for (var name in symbols) {
      var def = symbols[name];
      // OpenTUI 传入的是 normalizeNodeDefinition 后的定义（字段为 arguments/return）
      var ret = mapType(def.return);
      var args = (def.arguments ?? []).map(mapType);
      try { functions[name] = lib.func(name, ret, args); }
      catch (e) { functions[name] = function () { throw new Error("node-ffi-koffi: symbol not exported: " + name + " (" + e.message + ")"); }; }
    }
    var registered = new Set();
    return {
      lib: {
        registerCallback: function (def, callback) {
          var ret = mapType(def.return);
          var args = (def.arguments ?? []).map(mapType);
          var type = koffi.proto("gyc_cb_" + registered.size, ret, args);
          var ptr = koffi.register(callback, koffi.pointer(type));
          registered.add(ptr);
          return ptr;
        },
        unregisterCallback: function (ptr) {
          if (registered.delete(ptr)) { try { koffi.unregister(ptr); } catch (e) {} }
        },
        close: function () {
          for (var ptr of [...registered]) { try { koffi.unregister(ptr); } catch (e) {} }
          registered.clear();
          try { lib.unload(); } catch (e) {}
        }
      },
      functions: functions
    };
  }
  function getRawPointer(value) { return koffi.address(value); }
  function toArrayBuffer(pointer, length, copy) {
    var view = koffi.decode(pointer, koffi.array("uint8_t", Number(length)));
    var out = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    return out.buffer;
  }
  return {
    dlopen: dlopen,
    getRawPointer: getRawPointer,
    toArrayBuffer: toArrayBuffer,
    suffix: process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"
  };
}
`;

// ---- patch 目标 ----
const FROM_ANCHOR = `var requireModule = createRequire(import.meta.url);
var backend = loadBackend();`;
const TO_ANCHOR = `var requireModule = createRequire(import.meta.url);
${ADAPTER_FN}
var backend = loadBackend();`;

const FROM1 = `  try {
    const nodeFfi = requireModule("node:ffi");
    return createNodeBackend(nodeFfi.default ?? nodeFfi);
  } catch (error) {
    return createUnsupportedBackend(error);
  }`;
const TO1 = `  try {
    const nodeFfi = requireModule("node:ffi");
    return createNodeBackend(nodeFfi.default ?? nodeFfi);
  } catch (error) {
    try {
      return createNodeBackend(koffiFfiAdapter(requireModule("koffi")));
    } catch (koffiError) {
      return createUnsupportedBackend(error);
    }
  }`;

const FROM2 = `  try {
    return createNodeBackend2(await importModule("node:ffi"));
  } catch (error) {
    return createUnsupportedBackend2(error);
  }`;
const TO2 = `  try {
    return createNodeBackend2(await importModule("node:ffi"));
  } catch (error) {
    try {
      return createNodeBackend2(koffiFfiAdapter(await importModule("koffi")));
    } catch (koffiError) {
      return createUnsupportedBackend2(error);
    }
  }`;

if (!fs.existsSync(chunkFile)) {
  console.error("[gyc-patch] 未找到 chunk-node-q0cwyvm9.js，跳过（@opentui/core 版本可能变化）");
  process.exit(0);
}

let src = fs.readFileSync(chunkFile, "utf8");
const force = process.argv.includes("--force");
if (!force && src.includes(MARK)) {
  console.log("[gyc-patch] node:ffi→koffi patch 已生效，跳过（--force 可重新注入）");
  process.exit(0);
}

// 兼容旧版 patch（v1 注入外部文件 node-ffi-koffi.cjs）：先还原回原始文本。
const OLD1 = `  } catch (error) {
    try {
      return createNodeBackend(requireModule("./node-ffi-koffi.cjs"));
    } catch (koffiError) {
      return createUnsupportedBackend(error);
    }
  }`;
const OLD2 = `  } catch (error) {
    try {
      return createNodeBackend2(await importModule("./node-ffi-koffi.cjs"));
    } catch (koffiError) {
      return createUnsupportedBackend2(error);
    }
  }`;
const RESTORE1 = `  } catch (error) {
    return createUnsupportedBackend(error);
  }`;
const RESTORE2 = `  } catch (error) {
    return createUnsupportedBackend2(error);
  }`;
for (const [from, to] of [
  [OLD1, RESTORE1],
  [OLD2, RESTORE2],
]) {
  if (src.includes(from)) src = src.replace(from, to);
}
if (force) {
  // force 模式：先用正则移除 v2 内联的适配函数（兼容旧版内容差异），再走下方正常注入
  src = src.replace(
    /var requireModule = createRequire\(import\.meta\.url\);\nfunction koffiFfiAdapter[\s\S]*?\nvar backend = loadBackend\(\);/,
    "var requireModule = createRequire(import.meta.url);\nvar backend = loadBackend();",
  );
  const restore = (from, to) => {
    if (src.includes(from)) src = src.replace(from, to);
  };
  restore(TO1, FROM1);
  restore(TO2, FROM2);
}
fs.writeFileSync(chunkFile, src, "utf8");
const oldAdapter = path.join(coreDir, "node-ffi-koffi.cjs");
if (fs.existsSync(oldAdapter)) fs.unlinkSync(oldAdapter);

let applied = 0;
for (const [from, to] of [
  [FROM_ANCHOR, TO_ANCHOR],
  [FROM1, TO1],
  [FROM2, TO2],
]) {
  if (src.includes(from)) {
    src = src.replace(from, to);
    applied++;
  } else {
    console.error(`[gyc-patch] 未匹配到原版代码（@opentui/core 版本可能升级），跳过该分支`);
  }
}

if (applied === 0) {
  process.exit(1);
}
fs.writeFileSync(chunkFile, src, "utf8");
console.log(`[gyc-patch] @opentui/core node:ffi→koffi fallback 已注入（${applied}/3 处）`);
