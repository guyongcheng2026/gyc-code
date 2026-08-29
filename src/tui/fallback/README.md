# 自研 fallback 渲染器 API 契约（P0/P1 收尾）

## 概述

`src/tui/fallback/` 是自研 JS 渲染保底方案，零原生依赖、零 V8/Node C++ 绑定，
仅依赖 `string-width`（纯 JS，East Asian Width 宽度口径）。本目录接管
`GYC_TUI_BACKEND=fallback` 时的整屏 UI 渲染。

## 模块清单

| 模块              | 职责                                                           |
|-------------------|----------------------------------------------------------------|
| `screen.ts`       | 字符网格（Cell + Screen.writeText/writeWidth）                 |
| `diff.ts`         | 行戳短路 + 段内样式连续 SGR 最小化的差分帧引擎                 |
| `input.ts`        | stdin UTF-8 chunk 解析（方向键/翻页/DSR/CSI/SGR 鼠标）         |
| `terminal.ts`     | `FallbackRenderer` + `ProcessBackend` 抽象                     |
| `terminal-win32.ts` | Windows PTY 关窗事件 + size 探测（避免主进程挂死）           |
| `clipboard.ts`    | OSC 52 写入（tmux/screen 透传兼容）                            |
| `markdown.ts`     | 极简 Markdown 解析（标题/列表/代码块/行内标记）                |
| `highlight.ts`    | 零依赖代码高亮（基于 Markdown 代码块扩展）                     |
| `rich-text.ts`    | 富文本行内段样式渲染                                           |
| `safe-mode.ts`    | 单进程 fallback 互斥（多入口防抢夺）                           |
| `solid/`          | Solid 组件层（Box/Text/ScrollBox/Textarea/Select/ScrollBar/TextTable）|
| `solid/paint.ts`  | 布局 + paint（显示宽度 wrap、scrollbox clip、双宽光标定位）    |
| `app.tsx`         | FallbackApp 会话视图（标题/消息流/状态条/多行输入）            |
| `chat-bridge.ts`  | ChatBridge（events 订阅 + session.create + prompt RPC）        |
| `run-app.ts`      | 入口：组装 renderer + 组件树 + KeyParser + 鼠标/IME 生命周期  |

## 公开 API

### `runFallbackApp(options?)`

```ts
import { runFallbackApp } from "./run-app"

await runFallbackApp({
  backend?: TerminalBackend,           // 默认 ProcessBackend(stdout, stdin)
  transport?: {                        // 接线真实会话引擎（缺省走本地回显）
    url: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events: {
      subscribe: (handler: (event: unknown) => void) => Promise<() => void>
    }
  },
  directory?: string                   // 会话工作目录
})
```

退出条件：Esc / Ctrl+C（输入区无内容时复制最后一条助手消息到剪贴板） / 终端关闭。

### 鼠标（`setSgrMouse` / `disableMouse`）

`run-app.ts` 启动时自动 `setSgrMouse(backend.write)`，退出时 `disableMouse`。
事件落到 KeyParser 后转为 `{ type: "mouse", button, x, y, motion, press }`。
当前实现：滚轮上/下映射到消息流滚动 ±3 行。

### 剪贴板（`copyToClipboardViaOsc52`）

`Ctrl+C` 在消息区（非输入区）触发，写入 OSC 52 base64 序列。
兼容 tmux/screen（透传一次原始序列 + 一次 passthrough 包装）。

### KeyParser 输出 Key 类型

```ts
type Key =
  | { type: "up" | "down" | "left" | "right" | "pageup" | "pagedown" | "home" | "end" }
  | { type: "enter" | "backspace" | "escape" | "ctrl-c" }
  | { type: "text"; text: string }
  | { type: "cursor-request"; row: number; col: number }
  | { type: "mouse"; button: number; x: number; y: number; motion: boolean; press: boolean }
```

## P0/P1 完成度（2026-08-29）

| 阶段   | 任务                              | 状态     | 测试                              |
|--------|-----------------------------------|----------|-----------------------------------|
| P0-1   | 渲染回退（OSC 1337 / 半块字符）   | ✅       | screen/snapshot-matrix/diff/safe  |
| P0-2   | 剪贴板（OSC 52）                  | ✅       | clipboard (4)                     |
| P1-2   | 双宽 CJK 字符宽度                 | ✅       | snapshot-matrix/screen/rich-text  |
| P1-3   | IME 输入（fallback 路线不适用）   | ✅ N/A   | -                                 |
| P1-4   | 鼠标滚轮 + SGR 鼠标               | ✅       | input (15)                        |
| P1-5   | 性能基准 & 内存稳定性             | ✅       | perf (7)                          |

总测试：195 pass / 0 fail / 30 files / 577 expect calls。

## 关键约束

- **宽度口径**：`string-width`（与 `src/core/util/display-width.ts` 同源），
  Cell.width 区分 0（占位格）/ 1（半角）/ 2（全角）。
- **颜色回退**：truecolor → 256 → 16（亮度阈值切前景/背景）。
- **差分短路**：行戳（行级脏标记）一致即 O(1) 跳过该行；不等再逐格定位 first/last，
  并向两侧吞并宽字符占位格防止撕裂。
- **关窗检测**：Windows 单独走 `terminal-win32.ts`（CONIN$ ReadConsoleInputWatcher），
  避免主进程因管道 close 挂死。

## 后续

P2/P3 待请示后再启动。P2 候选：拆 `screen.ts` 为 buffer diff + 绘制后端、P1-1
TUI 截图回归基线。P3 候选：把 fallback 接入 cli 主入口默认走 fallback（删 opentui 依赖）。
