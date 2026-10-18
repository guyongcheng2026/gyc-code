# fallback 自研渲染器 vs OpenTUI：逐模块对照与全量替代完善计划

日期：2026-10-18 · 基准版本：`@opentui/* 0.5.14`（`package.json:71-74`）· fallback 基线：`src/tui/fallback/`（56 文件 / 7026 行，含 M0 新增 2 文件；口径为 `split("\n").length` 累计）
前置文档：《2026-08-26-opentui-replacement-readiness.md》（立项条件 T1–T6）、《2026-08-26-s1-component-bridge.md》、《2026-08-26-parity-slice-a.md》、《2026-08-27-parity-slice-b.md》

> 本文回答一个问题：**要让 `@opentui/*` 从依赖里彻底消失，还差什么、怎么补、补到什么程度算完。**
> 所有源码结论均带 `file:line`；未核实的项目显式标注「未核实」，不以推测代替证据。

---

## 立项记录（2026-10-18）

| 决策项 | 结论 | 落地位置 |
|--------|------|----------|
| ① 默认渲染后端 | **默认 `auto` = opentui 完整 UI**；`GYC_TUI_BACKEND=fallback` 或 `config.renderer=fallback` 显式切换。不改默认值（缺陷 D2 以"改注释"收口） | `src/tui/fallback/safe-mode.ts:26-33`（实现未改）、`src/tui/app.tsx:287-289`（注释已改）、`src/tui/fallback/README.md`、`GAP-ANALYSIS.md` |
| ② 替代计划 | **M0–M8 立项并立即启动**，按本文第 7 章推进；每阶段独立可回滚 | 本文第 6、7 章 |
| 执行状态 | **M0 2/4**（✅扫描脚本、✅captureSpans；⬜双后端 harness、⬜testRender 参数化）· **M1 ✅** · **M2 ✅**（⬜opacity）· **M3 ✅**（⬜主动探测、OSC52 读）· **M4 🔶**（EditBuffer+extmarks+Textarea；⬜TextBuffer/View、虚拟行、IME）· **M5 🔶**（Markdown GFM + **Code/Diff 组件**；⬜tree-sitter、LineNumber、conceal）· **M6 🔶**（行内节点 + stickyScroll + **竖直滚动条**；⬜真单行 input、wrapMode/truncate、横向滚动）· **M7 🔶**（hooks + 上下文 + KeyBus 接线；⬜keymap、Portal、插件槽位）· **M8 未开始** | `layout/engine.ts`、`render/{hit,focus,events}.ts`、`input.ts`、`text/edit-buffer.ts`、`markdown.ts`、`solid/{paint,components,jsx-runtime,hooks,context,renderer}.ts(x)` |
| 当前回归 | `bun test src/tui/fallback` **275 pass / 0 fail**（34 文件）；`bun run typecheck` 仅剩 1 个与本次无关的错误（`src/gyccode/server/.../server.ts`，他人未提交改动） | — |

> 决策 ① 的含义：**opentui 是产线默认路径，fallback 是可切换的备选**。因此替代计划的目标不是"立刻换默认"，
> 而是"当 fallback 达到 DoD 后再做一次默认值评估"——M8 之前不动默认值，回滚保险丝始终有效。

---

## 0. 结论摘要

| 判断 | 结论 | 依据 |
|------|------|------|
| 当前 fallback 能否替代 | **不能。当前只是「安全模式 + 单页会话演示」，与产线 UI 差一个数量级** | 产线 `src/tui` 有 82/241 个文件 import `@opentui`（实测统计）；fallback 只覆盖 1 个会话视图（`src/tui/fallback/app.tsx:38-168`） |
| 差距性质 | **不是"补几个控件"，而是缺三层地基：布局引擎、渲染对象模型、文本/编辑器模型** | 见第 3 章 M1/M2/M4 |
| 全量替代是否可行 | **可行，但必须按 8 个里程碑推进，估算 16–17 周（1 人）或 8–9 周（2 人并行）** | 第 7 章 |
| 现在能立刻做的 | 5 个阻断级缺陷修复 + 回归网（M0），不依赖任何立项决策 | 第 5、11 章 |
| 默认后端实际是什么 | **`auto` → 走 opentui**；`src/tui/app.tsx:287-289` 的注释称"默认走自研渲染后端"，与 `src/tui/fallback/safe-mode.ts:26-33` 实现不一致 | 见缺陷 D2 |

一句话：**fallback 已把"字符网格 + 差分 + 终端会话"这层做扎实（约 1500 行核心），但它只承担了 opentui 能力面的 20%；剩下 80% 是 Yoga 布局、Renderable 对象模型、TextBuffer/EditBuffer、tree-sitter 富文本、keymap 五块硬骨头。**

---

## 1. 评估口径

- **对比方法**：以 opentui 的公开类型声明（`node_modules/@opentui/core/**/*.d.ts`、`@opentui/solid/src/**/*.d.ts`）为"能力清单"，逐项到 fallback 源码里找对应实现；找不到即为缺口。类型声明是编译器强制的事实，比 README 可靠。
- **影响面加权**：光比"有没有"没意义。本文额外统计了产线代码对每项能力的**真实调用次数**（第 4 章），用它决定补齐优先级——调用 0 次的能力（如 `<image>`）不进 P0。
- **未覆盖**：未逐个通读 82 个 `@opentui` 消费文件，采用"抽样精读（session/index.tsx、prompt/index.tsx、dialog-select.tsx、sidebar.tsx、permission.tsx、diff-viewer.tsx）+ 全量正则计数"；计数结论可信，个别文件的隐式依赖可能遗漏，实施时以 M0 的自动扫描脚本为准。

---

## 2. 规模对照

| 维度 | OpenTUI 0.5.14 | fallback 自研 | 差距 |
|------|----------------|---------------|------|
| 渲染器实现 | `renderables/` 25 个 renderable + `lib/` 30 个模块 + Zig 原生缓冲 | `screen.ts`(249) + `diff.ts`(151) + `terminal.ts`(318) + `input.ts`(159) = 877 行 | 结构等价物只有"网格 + 差分 + 输入"三件 |
| Solid 桥接 | `@opentui/solid`：reconciler + 21 个 intrinsic（`src/elements/catalogue.d.ts:31-53`）+ 9 个 hooks（`hooks.d.ts:2-38`） | `solid/`：reconciler 绑定 134 行 + 4 个 intrinsic（`jsx-runtime.ts:114-119`）+ 9 个导出组件 | intrinsic 4/21，hooks 0/9 |
| 布局 | Yoga（WASM/原生）：`Renderable.d.ts:29-63` 33 个布局属性 + `Box.d.ts:6-23` 8 个盒模型属性 | `solid/paint.ts:161-379` 手写两遍法，支持 `width/height/flex/direction/gap/padding/border` | 属性覆盖 8/41，约 20% |
| 文本模型 | `TextBuffer` + `TextBufferView` + `EditBuffer` + `EditorView` + `SyntaxStyle` | `Screen.writeText` 直接落格 | 无缓冲区抽象、无 extmark、无虚拟行、无 undo |
| 产线消费面 | — | — | **82/241 文件 import `@opentui`；41 个 dialog、23 个插件组件、11 个路由未覆盖** |
| 测试 | `testRender` + captureSpans（14 处使用） | `MemoryBackend` + `screen.snapshot()` 纯文本快照（24 个测试文件） | 快照只有文本，无样式/无布局矩形 |

---

## 3. 逐模块对照

### M1 字符网格与帧引擎

| 项 | OpenTUI | fallback | 差异判定 |
|----|---------|----------|----------|
| 缓冲 | `OptimizedBuffer`（原生，`buffer.d.ts`），支持 scissor 栈、opacity 栈、drawText 带属性位 | `Screen`：`Cell[]` 一维数组（`screen.ts:61-79`） | 结构够用；缺 scissor/opacity 栈（由 M2 提供） |
| 单元格 | fg/bg RGBA + `TextAttributes` 位（BOLD/DIM/ITALIC/UNDERLINE/**BLINK**/**HIDDEN**/INVERSE/STRIKETHROUGH，`types.d.ts:7-17`） | `CellStyle` 8 字段（`screen.ts:17-26`），无 BLINK、无 HIDDEN | 缺 2 个属性；产线未用到 blink/hidden（0 处）→ 非阻断 |
| 宽字符 | `widthMethod: "wcwidth"｜"unicode"｜"unicode-wide"` 可切（`types.d.ts:54`） | 固定内置区间表（`char-width.ts:70-88`），无探测、无切换 | 缺 `unicode-wide` 口径；Windows Terminal 与 kitty 在 ambiguous 宽度上不同口径 |
| 差分 | Zig 侧按行/按段差分，字节流直接下发 | 行戳短路 + 段内 SGR 最小化（`diff.ts:102-169`） | **算法正确，但被 `Screen.clear()` 破坏**：`clear()` 给所有行盖新戳（`screen.ts:130-138`），而每帧 `repaint()` 都先 `clear()`（`solid/renderer.ts:50-59`）→ 行戳永远不等，短路 100% 失效，退化为逐格比较 |
| 颜色降级 | 能力探测后决定 truecolor/256/16（`types.d.ts:63-86`） | 两套并行判定：`capability.ts:47-53` 与 `diff.ts:11-37` 各写一遍，且 `capability.ts:50` 把 256 色标成 `8` | 口径分裂，改一处不改另一处必然出错 |
| 全屏/光标 | `screenMode: alternate-screen｜main-screen｜split-footer`（`renderer.d.ts:60`） | 只有 alt-screen 硬编码（`diff.ts:94-96`） | 缺 main-screen 与 split-footer（footer 模式产线未用，0 处） |

### M2 渲染对象模型（**完全缺失**）

OpenTUI 的 `Renderable`（`Renderable.d.ts:116-305`）是一个完整的对象模型，fallback 的 `ElementNode`（`solid/nodes.ts:15-29`）只是 6 个字段的树节点。

| 能力 | OpenTUI 证据 | fallback | 影响 |
|------|--------------|----------|------|
| zIndex 排序 | `Renderable.d.ts:211-215`（`requestZIndexSort`/`ensureZIndexSorted`） | 无 | 产线 10 处 `zIndex`（对话框叠层）无法表达 |
| 绝对定位 | `position`/`top`/`right`/`bottom`/`left`（`Renderable.d.ts:38-43`） | 无 | 产线 10 处 `position="absolute"`（`dialog.tsx`、`sidebar.tsx:58`） |
| scissor 栈 | `RenderCommand` push/popScissorRect（`Renderable.d.ts:306-332`）、`getScissorRect`（275-280） | 单一 `clip` 矩形参数（`paint.ts:410-439`） | 嵌套裁剪（scrollbox 套 dialog）会溢出 |
| opacity 合成 | `RenderCommand` push/popOpacity（`Renderable.d.ts:325-331`）、`opacity`（71） | 无 | 产线 12 处 `opacity`（淡入动画） |
| 命中测试 | `addToHitGrid`/`pushHitGridScissorRect`（`types.d.ts:103-105`） | 无 | 鼠标点击无法路由到具体元素 |
| 焦点链 | `focus/blur/focused/hasFocusedDescendant`（`Renderable.d.ts:176-184`）、`focused_renderable` 事件（`types.d.ts:97`） | 无（输入区是唯一焦点） | 多焦点控件（autocomplete、dialog 内输入）不可实现 |
| 生命周期/live | `live`/`liveCount`（`Renderable.d.ts:181-183`）、`registerLifecyclePass`（`types.d.ts:134-135`） | 无 | 动画/流式刷新无按帧钩子 |
| 事件面 | 12 个事件属性（`Renderable.d.ts:72-86`）：onMouse(Down/Up/Move/Drag/DragEnd/Drop/Over/Out/Scroll)、onPaste、onKeyDown、onSizeChange | 无 | 产线 24 处 `onMouseDown`、84 处 `onMouseUp` |

**结论：M2 是"能不能跑起真实 UI"的分水岭。**没有它，41 个 dialog 一个都迁不过来。

### M3 终端会话与输入

| 能力 | OpenTUI | fallback | 差异 |
|------|---------|----------|------|
| 能力探测 | DA1/DA2/XTVERSION/kitty graphics/sixel/focus/sync/osc52/notifications/multiplexer，20 个字段（`types.d.ts:63-86`） | `probeTerminal()` 只看 `TERM`/`COLORTERM`/`CI`/`TERM_PROGRAM` 四个环境变量（`capability.ts:64-75`） | 缺主动探测（发序列 + 超时收响应），tmux 内会误判 |
| 键盘协议 | Kitty keyboard 5 个 flag（`renderer.d.ts:135-146`）、CSI u、release 事件、`KeyEvent.repeated` | 12 个硬编码键（`input.ts:9-25`），`CSI_KEYS` 6 条 + `TILDE_KEYS` 5 条（`input.ts:30-46`） | **无修饰键**（shift/ctrl/alt/meta 组合全部丢失）；`input.ts:93-97` 把其余控制字符直接丢弃 → Ctrl+A/E/K/U/W、Tab 全部不可用 |
| 粘贴 | bracketed paste + `PasteEvent` + `decodePasteBytes`（`prompt/index.tsx:1478-1502`） | 无（粘贴走"文本流"路径，多行粘贴会误触发 Enter 提交） | 产线粘贴是核心路径（`expandPastedTextPlaceholders`） |
| 鼠标 | SGR + legacy + 拖动 + 滚轮 + 修饰键 + `stopPropagation/preventDefault`（`renderer.d.ts:154-179`） | SGR 1006 解析（`input.ts:150-161`、`terminal.ts:69-105`），只有 button/x/y/motion/press | 缺修饰键、缺 drag 语义、缺命中目标 |
| 焦点事件 | focus in/out 追踪（`types.d.ts:74`） | 无 | 终端切走时无法暂停渲染 |
| 同步输出 | `sync` 能力（`types.d.ts:75`，DEC 2026） | 无 | 大帧撕裂风险 |
| 光标形状 | `setCursorStyle`（`types.d.ts:119`）、`CursorStyleOptions`（37-42） | 只有反色块（`paint.ts:577-590`） | 产线用 bar/underline 区分输入模式 |
| 主题探测 | `theme_mode` 事件 + `TerminalColors`（`types.d.ts:100`、`renderer.d.ts:13`） | 无（`app.tsx:901` 写死 dark） | 亮色终端下对比度不足 |
| 剪贴板 | OSC52 读写 + `ClipboardTarget`（`lib/clipboard.d.ts`，134 行） | 只写（`clipboard.ts:14-31`），注释明写"不做读"（`clipboard.ts:8`） | 粘贴快捷键依赖读；可用 clipboardy 兜底 |
| 外部输出 | `externalOutputMode: capture-stdout｜passthrough`（`renderer.d.ts:61`） | 无 | 子进程输出直接穿屏 |

### M4 文本缓冲与编辑器（**最大单块缺口**）

| 能力 | OpenTUI | fallback | 影响 |
|------|---------|----------|------|
| 文本缓冲 | `TextBuffer`/`TextBufferView`（`text-buffer.d.ts`、`text-buffer-view.d.ts`） | 字符串数组 | 无 |
| wrap 模式 | `wrapMode: "none"｜"char"｜"word"`（`TextBufferRenderable.d.ts:17`） | 只有按显示宽度硬折（`paint.ts:35-59`） | 产线 79 处 `wrapMode`，其中 `wrapMode="none"` 用于横向滚动行 |
| 截断 | `truncate`（`TextBufferRenderable.d.ts:21`） | 无 | 产线 59 处 `truncate` |
| 对齐 | `textAlign: left｜center｜right`（18） | 无 | 产线 0 处 → 低优先 |
| 行信息 | `lineInfo`/`lineSources`/`scrollY`/`maxScrollY`（59-71） | `TextareaDisplayRow[]`（`paint.ts:257-281`） | 部分等价 |
| 选择 | 单元格级 selection + `getSelectedText`（`TextBufferRenderable.d.ts:100-107`） | 无（`selection.ts:6-10` 自认"不支持鼠标拖选"） | 复制一段回复做不到 |
| 编辑器 | `EditBuffer`：`plainText`/`logicalCursor`/`visualCursor`/`cursorOffset`（`EditBufferRenderable.d.ts:93-102`）、undo/redo、kill ring、word 操作 | `Textarea` 组件 131 行（`components.tsx:103-233`），支持插入/删除/换行/四向/Home/End | **缺 undo/redo、缺 Ctrl+W/K/U、缺跨行选择、缺列选择** |
| extmarks | `extmarks.registerType`（`lib/extmarks.d.ts`，90 行）；产线 `prompt/index.tsx:1510` 用它标记附件/paste 片段 | 无 | **prompt 迁移的硬阻断** |
| 虚拟行 | `virtualLineCount`（`EditBufferRenderable.d.ts:96`） | 无 | prompt 的附件行、诊断行 |
| 语法样式 | `syntaxStyle`（`EditBufferRenderable.d.ts:40`） | 无 | 输入框内联高亮 |
| 光标样式 | `cursorStyle`/`selectionOccupancy`/`tabIndicator`（37-41） | 反色块 | — |
| 内容变更事件 | `onCursorChange`/`onContentChange`（43-44） | 组件内部 signal，无对外事件 | 产线依赖 `onContentChange` 做 extmark 同步（`prompt/index.tsx:1459-1466`） |

### M5 语法高亮与富文本

| 项 | OpenTUI | fallback | 差异 |
|----|---------|----------|------|
| 高亮引擎 | tree-sitter（`SyntaxStyle` + `parsers-config.ts` 多语言 wasm + nvim query） | 正则 tokenizer，6 组关键字表（`highlight.ts:34-45`），`c/java/go/rust` 全部 alias 到 ts 关键字集（`highlight.ts:45`） | 精度差一个量级；且"看着像高亮"但语义错误 |
| scope→样式 | 主题 `getSyntaxRules`（`theme/index.ts`） | `resolveTokenStyle` 镜像了 15 条规则（`rich-text.ts:50-91`），但**没有 token 来源**（只有测试用） | 规则有了，输入没有 |
| Markdown | `MarkdownRenderable`：CommonMark + GFM 表格 + streaming + conceal + `tableOptions.style: "grid"`（产线 `session/index.tsx:2155-2161`） | 逐行正则，9 种块级 + 4 种行内（`markdown.ts:27-113`）；**无表格、无嵌套列表、无链接、无引用嵌套、无 conceal** | 产线 10 处 `<markdown>`，AI 回复全靠它 |
| Code | `CodeRenderable`：filetype + conceal + streaming + drawUnstyledText（`session/index.tsx:2077-2083`） | 无 Code 组件；markdown 代码块用 `highlightCodeLine` | 产线 8 处 `<code>`；写文件预览（`session/index.tsx:2595-2601`）无法渲染 |
| Diff | `DiffRenderable`：split/unified、showLineNumbers、filetype（`session/index.tsx:2914-2920`） | 无 | 产线 10 处 `<diff>` + 独立 diff-viewer 1073 行 |
| 行号 | `LineNumberRenderable`（`minWidth`/`paddingRight`） | 无 | `session/index.tsx:2587` |
| 表格 | `TextTableRenderable` | 列宽 = 最大显示宽 + 2 空格（`components.tsx:402-423`） | 无边框样式、无对齐、无自动换行 |

### M6 控件层

产线使用的 intrinsic（21 个中实际用到 9 个）：

| intrinsic | 产线用量 | fallback | 判定 |
|-----------|----------|----------|------|
| `box` | 458 处 | `Box`（`components.tsx:21-36`）支持 8 属性 | 需随 M1/M2 扩展到 41 属性 |
| `text` | 585 处 | `Text`（38-44）+ spans | 缺 wrapMode/truncate/selectable/textAlign/tabIndicator |
| `scrollbox` | 10 处（`session/index.tsx:1587`、`dialog-select.tsx:612`、`diff-viewer.tsx:832`） | `ScrollBox`（53-79）只有 scrollTop/scrollBy/scrollToBottom | **缺 stickyScroll/stickyStart、scrollbarOptions(10 处)、scrollAcceleration(44 处)、viewportCulling、横向滚动、scrollChildIntoView** |
| `textarea` | 5 处（其中 prompt 1689 行，极重） | `Textarea`（103-233） | 见 M4 |
| `input` | 1 处（`dialog-select.tsx:574` 过滤框） | `Input` 是 Textarea 特化（236-238），无单行语义 | 需真单行实现（横向滚动、无换行） |
| `select` | 0（产线自研 dialog-select） | `Select`（287-352） | 非阻断 |
| `tab_select` | 0 | 无 | 非阻断 |
| `line_number` | 1 处 | 无 | 随 M5 |
| `code`/`diff`/`markdown` | 8/10/10 | 仅 Markdown 简化版 | 随 M5 |
| `span` | **108 处 / 29 文件** | 无（只有 `spans` 数组属性，`jsx-runtime.ts:80-83`） | **必须实现**：`<span style>` 是行内样式的主要写法（`session/index.tsx:1359`），fallback 会把 `span` 当默认 box 处理，样式全部丢失 |
| `b` | **60 处 / 30 文件** | 无 | **必须实现**：粗体行内节点 |
| `i` | 1 处 | 无 | 顺带实现 |
| `u`/`a`/`br` | 0 处 | 无 | 可后置 |
| `ascii_font` | 0 | 无 | 非阻断 |
| `image` | 0（实测 0 处） | 无 | **可从替代范围剔除** |

### M7 应用层 API

| API | OpenTUI | fallback | 缺口 |
|-----|---------|----------|------|
| `render()` | `@opentui/solid/index.d.ts:4` | `renderRoot`（`solid/renderer.ts:124-140`） | 等价 |
| `Portal` | `extras.d.ts:11-15` | 无 | 产线 3 处（`permission.tsx` 等） |
| `Dynamic` | `extras.d.ts:41` | 有（`solid/index.ts:45-62`） | 等价 |
| `createSlot`/插件槽位 | `plugins/slot.d.ts`、`plugin/slots.tsx` | 无 | 23 个插件组件 |
| `useRenderer` | `hooks.d.ts:3` | 无 | 产线 23 处 / 9 文件 |
| `useTerminalDimensions` | `hooks.d.ts:5-8` | 无 | 产线 32 处 / 15 文件 |
| `useKeyboard` | `hooks.d.ts:29` | 无（app 层手动路由） | 4 处 |
| `usePaste` | `hooks.d.ts:30` | 无 | 0 处（但粘贴事件被 textarea 内部消费） |
| `useSelectionHandler` | `hooks.d.ts:37` | 无 | 0 处 |
| `onResize`/`onFocus`/`onBlur`/`useTimeline` | `hooks.d.ts:4,35,36,38` | 无 | 动画依赖 |
| keymap | `@opentui/keymap`：`KeymapProvider`/`useKeymap`/`useBindings`/`dispatchCommand`/`stringifyKeyStroke`（`keymap.tsx:10-15`） | 无 | **产线全部快捷键（数十个命令）建立在它之上** |

### M8 对话框与浮层

| 项 | OpenTUI | fallback |
|----|---------|----------|
| 实现方式 | `<box position="absolute" zIndex>` + `Portal`，走正常渲染树 | 直接 `backend.write()` 绕过帧循环（`dialog.ts:16-18`），`\x1b[2J` 清屏（`dialog.ts:36`） |
| 输入 | 统一 KeyHandler | 直接 `process.stdin.once("data")`（`dialog.ts:53-59`），与 `KeyParser` 抢同一 stdin |
| 尺寸 | 父容器约束 + Yoga | 读 `process.stdout.columns`（`dialog.ts:41`），绕过 `TerminalBackend` 抽象 |
| 结论 | 可组合、可叠层 | 只能"清屏画一个框"，与产线 41 个 dialog 无法对齐 → **建议整体废弃，随 M2 重写** |

### M9 测试与回归

| 项 | OpenTUI | fallback |
|----|---------|----------|
| 渲染测试 | `testRender`（14 处使用）→ 真实 renderer + 可读快照 | `MemoryBackend` + `screen.snapshot()` 纯文本（`snapshot.ts:8-18`） |
| 样式断言 | `captureSpans`（`types.d.ts:178-193`：text/fg/bg/attributes/width） | 无（快照丢样式） |
| 结论 | — | 补齐 `captureSpans` 等价物是 M0 的第一件事 |

### M10 其他（可裁剪）

| 能力 | OpenTUI | 产线用量 | 建议 |
|------|---------|----------|------|
| Image（kitty/sixel/blocks） | `renderables/Image.d.ts` | **0** | 剔除 |
| Audio | `audio.d.ts`；`attention.ts:118-200` 用其播放提示音 | 1 条链路 | 独立小项：改调系统播放器（Windows `Media.SoundPlayer`、macOS `afplay`），不进渲染器 |
| Timeline 动画 | `animation/Timeline.d.ts`；`useTimeline` | 少量（fade-in） | 随 M7 hooks |
| post/effects（后处理） | `post/effects.d.ts` | 0 | 剔除 |
| EmbeddedTerminal | `renderables/EmbeddedTerminal.d.ts` | 0 | 剔除 |
| NativeSpanFeed / console overlay / debug overlay | `NativeSpanFeed.d.ts`、`console.d.ts` | debug overlay 1 处 | 可选 |

---

## 4. 产线依赖面统计（决定补齐顺序）

实测（`node scripts/scan-opentui-surface.mjs`，`src/tui` 排除 `node_modules`、`fallback`：241 文件 / 37341 行，含 39 个测试文件）：

**唯一口径以脚本输出为准**，下表为 2026-10-18 首次运行结果（属性为 `name=` 调用点计数，非出现次数）：

| 属性/API | 调用点 | 归属里程碑 |
|----------|--------|-----------|
| `fg` | 551 | M6（Text 基础样式） |
| `flexDirection` | 173 | M1 |
| `paddingLeft` | 151 | M1 |
| `gap` | 148 | M1 |
| `flexShrink` | 98 | M1 |
| `paddingRight` | 93 | M1 |
| `onMouseUp` | 80 | M2 |
| `wrapMode` | 72 | M4/M6 |
| `justifyContent` | 70 | M1 |
| `paddingBottom` | 66 | M1 |
| `title` | 66 | M6（Box 边框标题） |
| `attributes` | 61 | M6 |
| `width` | 60 | M1 |
| `backgroundColor` | 59 | M6（Box） |
| `height` | 37 | M1 |
| `paddingTop` | 36 | M1 |
| `flexGrow` | 34 | M1 |
| `border` | 30 | M6 |
| `content` | 28 | M5（Markdown/Code） |
| `visible` | 25 | M2 |
| `onMouseDown` | 24 | M2 |
| `borderColor` | 23 | M6 |
| `alignItems` | 19 | M1 |
| `marginTop` | 19 | M1 |
| `minHeight` | 18 | M1 |
| `onMouseOver` | 17 | M2 |
| `placeholder` | 16 | M4（Textarea） |
| `left` | 15 | M2 |
| `position` | 14 | M2 |

intrinsic 用量（同口径）：`<text>` 585、`<box>` 458、`<span>` 108、`<b>` 60、`<diff>` 10、`<markdown>` 10、`<scrollbox>` 10、`<code>` 8、`<textarea>` 5、`<i>` 1、`<input>` 1、`<line_number>` 1。
应用层 API：`useBindings` 52、`useTerminalDimensions` 17、`testRender` 14、`useRenderer` 14、`dispatchCommand` 12。

> 判读：**M1（布局）+ M6（Text/Box 样式）两项就覆盖了 1000+ 调用点**，是投入产出比最高的部分；M2 虽然计数不多，但它是 `position/zIndex` 的唯一实现途径，属"不做则 41 个 dialog 全废"的门槛项。

---

## 5. 阻断级缺陷清单（读代码时实证发现，与替代计划解耦，应立刻修）

| 编号 | 缺陷 | 证据 | 后果 | 修复 |
|------|------|------|------|------|
| D1 | **行戳短路失效** | `screen.ts:130-138` 的 `clear()` 给每行盖新戳；`solid/renderer.ts:50-59` 每帧先 `clear()` | 每帧退化为逐格 `cellEqual`（200×60 = 12000 次/帧），行戳优化形同虚设 | `clear()` 改为"标记逻辑清屏"或只在内容真变时递增戳；或 `repaint` 改用双缓冲 swap |
| D2 | **注释与实现不符（默认后端）** | `app.tsx:287-289` 注释曾称"默认走自研渲染后端"；实际 `safe-mode.ts:31-32` 返回 `"auto"` → 走 opentui | 读代码者误判产线默认路径，排障方向错误 | **已收口（2026-10-18）**：按谷总决策保留默认 `auto`=opentui，改注释与文档，不改实现 |
| D3 | **UTF-8 边界保护用错口径** | `terminal.ts:45-55`：`charCodeAt` 取 UTF-16 码元，却与 `0x80–0xBF`（UTF-8 续字节区间）比较 | U+0080–U+00BF 区间的合法字符（如 `¡`、`¿`、`°`）会被误判为"半个字符"扣留，直到下一帧才输出 | 直接写字符串（Node 的 `stdout.write(string)` 自身保证整串编码），或改用 `Buffer` 分段 |
| D4 | **颜色能力判定两套口径** | `capability.ts:47-53`（256 色返回 `8`）vs `diff.ts:11-37`（独立 `detect256Color`） | 两处判定不一致时输出错误色深（256 色终端被降级为 16 色） | 统一到 `capability.ts`，`diff.ts` 消费 probe 结果 |
| D5 | **dialog 绕过抽象层并抢 stdin** | `dialog.ts:41`（`process.stdout.columns`）、`dialog.ts:53-59`（`process.stdin.once`） | 与 `KeyParser`（`run-app.ts:92`）同时消费 stdin，按键被吞或重复；`MemoryBackend` 测试下必挂 | 随 M8 重写；短期至少改为走 `TerminalBackend` |
| D6 | **源码注释乱码** | `diff.ts:5-7`（`差分帧引擎�?`）、`diff.ts:99-101`（`仅重绘内容发生变化的行�?`） | 说明 pre-commit 乱码检查未覆盖该文件（历史提交遗留） | 修注释；顺带核对 `check-mojibake` 的扫描范围 |

---

## 6. 全量替代的定义（DoD，缺一不可）

只有下列 7 条全部满足，才允许删除 `@opentui/*` 依赖：

1. **零依赖**：`src/**` 与 `src/tui/**` 中 `@opentui` 出现次数 = 0（`grep -r "@opentui" src --include=*.ts --include=*.tsx` 为空），`package.json` 移除 4 个包，`postinstall` 移除 4 个补丁脚本 + `repair`/`verify` 脚本。
2. **功能等价**：41 个 dialog、11 个路由、23 个插件组件全部在 fallback 后端可用；keymap 命令表 100% 覆盖（以 `src/tui/keymap.tsx` 注册的绑定数为准，逐条对拍）。
3. **视觉等价**：双后端快照矩阵 ≥200 用例，逐格（字符 + fg + bg + 属性 + 宽）全等；白名单差异仅允许"已知可接受"项且需逐条注明理由。
4. **布局等价**：500 组随机布局属性组合下，元素矩形与 Yoga 结果零偏差（以 opentui 为 oracle，仅测试期依赖）。
5. **性能门槛**：80×24 全量帧 ≤16ms（60fps 预算）；1000 行缓冲全量帧 ≤50ms；增量帧字节量 ≤ opentui 同场景 2 倍；启动到首帧 ≤ 现基线。
6. **稳定性**：8 小时长会话 RSS 无单调增长；无原生依赖 → 崩溃归因里不再出现 FFI/arena 类事件；四端终端矩阵（Windows Terminal/ConPTY、tmux、WezTerm、kitty）输入输出全绿。
7. **可回滚**：剥离 opentui 的提交可 `git revert` 单点回退；回退后 `GYC_TUI_BACKEND=opentui` 仍可用（保留 1 个版本周期）。

---

## 7. 完善计划（M0–M8）

> 工期为**估算**（单人全职，含自测，不含评审与真机验收排队）；并行度已标注。

### M0 回归网与依赖面固化（1 周，前置：无）

- **交付**
  - ✅ `scripts/scan-opentui-surface.mjs`（2026-10-18 落地）：扫描 `src/tui`，输出"intrinsic 清单 + 属性直方图 + hooks 清单 + @opentui import 文件表"；支持 `--json`（CI 比对）与 `--fail-on-import`（M8 剥离门禁，退出码 1）
  - ✅ `src/tui/fallback/testing/capture.ts`（2026-10-18 落地）：`captureSpans(screen)` 返回 `{text,fg,bg,attributes,width}[]`（对齐 `types.d.ts:178-193`），7 个用例见 `capture.test.ts`
  - ⬜ `src/tui/fallback/testing/dual-render.ts`：同一组件树分别用 opentui `testRender` 与 fallback `MemoryBackend` 渲染，产出可比快照
  - ⬜ 把 14 处 `testRender` 测试改为双后端参数化
- **验收**：`bun run test` 全绿；双后端快照一致率 ≥95%（差异项落白名单文件）
- **回滚**：纯新增文件，删掉即回退
- **当前进度（2026-10-18）**：2/4 交付完成；首次扫描结果 `82 文件 / 120 处 @opentui 引用`，已回填第 4 章

### M1 布局引擎（2 周，可与 M3 并行）— ✅ 已落地（2026-10-18）

- **交付**：`src/tui/fallback/layout/engine.ts`（单文件，替代原计划的 measure/resolve/commit 三拆——实际实现共用一个 `layoutNode` 递归，拆文件只会制造跨文件跳转）
  - 已支持属性：`flexDirection`(row/column/row-reverse/column-reverse)、`flexGrow`/`flexShrink`/`flexBasis`、`alignItems`/`alignSelf`/`justifyContent`(5 种)/`flexWrap`(wrap/wrap-reverse)、`gap`/`rowGap`/`columnGap`、`margin*`/`padding*`/`paddingX`/`paddingY`（含百分比）、`min*`/`max*`、`position`(relative/absolute/static)+`top/right/bottom/left`、`border`（布尔/样式名/按边数组）、`width/height`（数字/百分比）
  - 兼容层：`flex: true` → `flexGrow:1 + flexShrink:1 + flexBasis:0`；`direction` → `flexDirection`
  - 默认值对齐 Yoga：`flexGrow=0`、`flexShrink=0`（与 Web CSS 的 1 不同，故产线有 98 处显式 `flexShrink`）
- **接线**：`solid/paint.ts` 的 `layoutTree` 委托引擎，叶子测量经 `measureLeaf` 注入；删除旧 `layoutElement/layoutChildren/layoutRowChildren/measureNode/measureNaturalWidth`（约 180 行）；删除失效的 `measureCache` 与 `invalidateMeasure`
- **测试**：`layout/engine.test.ts` 23 用例（主轴分配 / 盒模型 / 对齐换行 / 绝对定位 / 属性归一化）
- **回归**：`bun test src/tui/fallback` **200 pass / 0 fail**；`bun run typecheck` **0 error**
- **未完成（M1 验收项）**：随机 500 组与 Yoga 的差分对拍（当前是场景断言，不是全量对拍）；三个真实页面在三档尺寸下的矩形对拍
- **回滚**：`git revert` 单点（引擎与接线同一批提交）

### M2 渲染对象模型（2 周，依赖 M1）— ✅ 已落地（2026-10-18，除 opacity）

- **已完成**
  - ✅ `zIndex`：同级按升序绘制（`paint.ts` `paintChildren`），无 zIndex 的树不排序（零额外分配），4 用例见 `solid/paint-z.test.ts`
  - ✅ `visible=false`：不绘制但仍占位（对齐 opentui `Renderable.visible` 语义）
  - ✅ scissor：`paintNode` 的 `clip` 矩形逐层 `intersect`（等价 scissor 栈，嵌套裁剪已生效）
  - ✅ `position:absolute` 叠层基础（M1 引擎提供，10 处产线用法可表达）
  - ✅ 命中网格 `render/hit.ts`：与绘制同序（zIndex / visible / 内容盒裁剪），`buildHitGrid` + `at(x,y)`
  - ✅ 焦点链 `render/focus.ts`：`focus/blur/isFocused`（自身或祖先）+ `onChange` 订阅
  - ✅ 事件冒泡 `render/events.ts`：12 个事件名映射，返回 `false` 停止冒泡
- **测试**：`render/render.test.ts` 12 用例（命中/zIndex/visible/裁剪/焦点/冒泡）
- **未完成**：`opacity` 合成（12 处；终端无 alpha，需要前景/背景混色，留待配色层统一处理）
- **验收**：命中测试与 opentui 逐坐标一致（随机 1000 点，命中 id 全等）——**未做**（需 opentui 同树对拍，属 M0 双后端 harness）
- **回滚**：新目录，节点层用适配器接旧 `ElementNode`

### M3 终端能力与输入协议（1.5 周，可与 M1 并行）— ✅ 解析侧已落地（2026-10-18）

- **已完成**
  - ✅ 修饰键矩阵：`CSI 1;{mod}{A|B|C|D|H|F}`、`{code};{mod}~`、kitty `{code};{mod}u`，`parseModifiers` 对齐 `mod = 1+shift+alt*2+ctrl*4+meta*8`
  - ✅ bracketed paste：`\x1b[200~ … \x1b[201~`，支持跨 chunk 累积，内部换行不触发 Enter
  - ✅ 焦点事件：`\x1b[I` / `\x1b[O`；开关函数 `setBracketedPaste`/`setFocusTracking`
  - ✅ Ctrl+字母：`0x01–0x1a` → `{type:"ctrl", key}`，打通 Ctrl+A/E/K/U/W/Z/Y
- **测试**：`input-protocol.test.ts` 12 用例
- **未完成**：`terminal-probe.ts` 主动探测（DA1/DA2/XTVERSION）、OSC52 读、光标形状、sync output（DEC 2026）；开关函数尚未在 `run-app` 启用
- **验收**：四端输入矩阵真机验证——**未做**（本机只能跑解析器单测）
- **回滚**：能力探测失败即回落现有环境变量判定（`capability.ts:64-75`）

### M4 文本缓冲与编辑器（3 周，关键路径，可与 M5 并行）— 🔶 核心已落地（2026-10-18）

- **已完成**
  - ✅ `text/edit-buffer.ts`：插入（含多行/CRLF 归一化）、backspace/deleteForward、四向移动、行首/行尾、Ctrl+W/K/U、undo/redo（上限 100）、跨行选择与 `getSelectedText`/`deleteSelection`、extmarks（`registerType`/`setMark`/区间迁移）
  - ✅ `solid/components.tsx` 的 `Textarea` 改为委托 `EditBuffer`（保留原 API：`handleKey/getText/clear/getCursor`），并接上 Shift+方向键选择、Ctrl+Z/Y 撤销重做
- **测试**：`text/edit-buffer.test.ts` 22 用例；`Textarea` 既有用例零回归（全量 245 pass）
- **未完成**：`TextBuffer`/`TextBufferView`（wrapMode none/word、truncate、textAlign、lineInfo）、虚拟行、IME 组合、kill ring 多级 yank、extmark 在 undo 后的精确恢复（当前只做区间夹紧）
- **验收**：`prompt/index.tsx`（1689 行）整体迁移——**未做**
- **回滚**：`EditBuffer` 与组件解耦，可回退到旧内联实现（git revert 单点）

### M5 语法高亮与富文本（2.5 周，可与 M4 并行）— 🔶 Markdown 已增强（2026-10-18）

- **已完成**：
  - `markdown.ts` 补齐 GFM 表格（网格渲染 + 列宽按显示宽 + 宽字符安全）、任务列表（☐/☑）、链接（下划线）、嵌套列表（按缩进分级）、`wrapSpans` 支持 `<br>` 与 `\n` 强制换行；8 用例见 `markdown.test.ts`
  - `code` intrinsic：按 `filetype` 逐行高亮（复用 `highlight.ts`），支持多行/超宽折行；`diff` intrinsic：unified diff 解析（`---`/`+++`/`@@`/`+`/`-`/上下文）+ `showLineNumbers` 旧新双列行号；8 用例见 `code-diff.test.ts`
- **未完成**：tree-sitter 高亮（当前仍是正则近似）、`line_number` 容器、`conceal`、`view="split"` 左右分栏、streaming 增量

- **选型**：优先 **tree-sitter WASM（web-tree-sitter）**，直接复用现有 `src/tui/parsers-config.ts` 的 wasm 与 query URL + `theme/index.ts` 的 `getSyntaxRules`（保证与 opentui 同口径）；离线缓存到 `~/.gyc/parsers/`。降级路径：`plain` 模式下用现有正则（`highlight.ts`）。
- **交付**
  - `syntax/parser-pool.ts`：wasm 加载 + LRU + 超时降级
  - `syntax/highlight.ts`：tree-sitter 增量高亮（按行缓存，编辑后只重算脏区）
  - `renderables/markdown.ts`：CommonMark 子集 + GFM 表格/任务列表 + streaming 增量 + conceal + `tableOptions.style`
  - `renderables/code.ts`：filetype + conceal + streaming + drawUnstyledText
  - `renderables/diff.ts`：split/unified + showLineNumbers + filetype
  - `renderables/line-number.ts`
- **验收**：40+ 语料（ts/tsx/py/go/rust/cpp/json/md/diff）与 opentui 渲染结果逐格全等；`session/index.tsx` 的 `<markdown>/<code>/<diff>/<line_number>` 四处迁移通过
- **回滚**：`GYC_FALLBACK_SYNTAX=regex|treesitter`

### M6 控件层（2.5 周，依赖 M1/M2/M4/M5）— 🔶 行内节点已落地（2026-10-18）

- **已完成**：`span`/`b`/`strong`/`i`/`em`/`u`/`a`/`br` 行内节点（`paint.ts` `collectSpans` 折叠为样式段，父样式继承、标签修饰叠加、`<br>` 换行）；`jsx-runtime.ts` 补齐对应 intrinsic 类型；`scrollbox` 支持 `stickyScroll`/`stickyStart`（内容增长时贴底、手动滚离后不跟随）；`verticalScrollbarOptions.visible` 绘制竖直滚动条（滑块 `█` + 轨道 `│`，内容区自动让出最后一列）；10 + 8 用例见 `inline.test.ts`、`code-diff.test.ts`
- **未完成**：真单行 `input`、`wrapMode`/`truncate`/`textAlign`、横向滚动、`viewportCulling` 显式开关（当前由 clip 天然满足）

- **交付**：`src/tui/fallback/renderables/`：`box`(41 属性 + 4 边框样式 + per-side + customBorderChars + title/bottomTitle)、`text`、`input`(真单行)、`textarea`、`select`、`tab_select`、`scrollbox`(+`scrollbarOptions`/`stickyScroll`/`stickyStart`/`scrollAcceleration`/`viewportCulling`/横向/`scrollChildIntoView`/autoScroll)、`scrollbar`、`text-table`、`slider`、`ascii-font`
- **验收**：21 个 intrinsic 中产线实际用到的 12 个（`box`/`text`/`scrollbox`/`textarea`/`input`/`span`/`b`/`i`/`markdown`/`code`/`diff`/`line_number`）全部可用；`dialog-select.tsx`（751 行，含过滤框 + 滚动 + 鼠标）整体迁移通过
- **回滚**：逐控件灰度，`#fallback-solid` 导出表按控件开关

### M7 应用层接线（2 周，依赖 M6）— 🔶 hooks 与上下文已落地（2026-10-18）

- **已完成**：`solid/context.ts`（`RendererContext` + `KeyBus`/`KeyBusContext`）、`solid/hooks.ts`（`useRenderer`/`useTerminalDimensions`/`onResize`/`useKeyboard`/`usePaste`/`onFocus`/`onBlur`）、`renderRoot` 自动包 Provider、`run-app` 创建 KeyBus 并广播按键；4 用例见 `hooks.test.tsx`
- **未完成**：keymap（绑定表/前缀序列/leader/which-key）、`Portal`、插件槽位 `createSlot`

- **交付**
  - `keymap/`：Bindings/Commands/Leader/序列前缀/which-key（对齐 `@opentui/keymap` 语义；**绑定表本身是数据，直接复用 `src/tui/keymap.tsx` 与 `config/keybind.ts`，不改业务**）
  - `hooks.ts`：`useRenderer`/`useTerminalDimensions`/`useKeyboard`/`usePaste`/`onResize`/`onFocus`/`onBlur`/`useSelectionHandler`/`useTimeline`
  - `portal.tsx`（`extras.d.ts:11-15` 等价）、`slots.tsx`（`createSlot` 等价）
  - `theme-bridge.ts`：`RGBA` → `CellStyle`（避免改 33 个主题 json）
- **验收**：`src/tui` 全量 `.tsx` 零 `@opentui` import 且 `bun run typecheck` 通过；14 个渲染测试在双后端下全绿
- **回滚**：`GYC_TUI_BACKEND=opentui` 一键切回（保留一个版本周期）

### M8 剥离与收尾（1 周）

- **交付**：删 4 个 `@opentui/*` 依赖、4 个 `apply-opentui-*.cjs`、`repair-opentui-platform.cjs`、`verify-opentui-patches.cjs`；同步 `AGENTS.md`（启动器/dist 陷阱、补丁脚本段）、`docs/gyccode操作手册.docx`（渲染器选择章节）、`README`
- **验收**：DoD 7 条全绿；`bun run build` 产物体积与冷启动耗时对比表（前后）
- **回滚**：单独提交，`git revert` 单点恢复

### 关键路径与总工期

```
M0(1w) → M1(2w) ┬→ M2(2w) → M6(2.5w) → M7(2w) → M8(1w)
        M3(1.5w)┘                  ↑
        M4(3w) ────────┬──────────┘
        M5(2.5w) ──────┘
```

- 单人：约 **16–17 周**
- 双人（A 做 M1/M2/M3，B 做 M4/M5，M6 起合流）：约 **8–9 周**

---

## 8. 关键技术选型与理由

| 决策点 | 选择 | 理由 | 放弃的方案 |
|--------|------|------|-----------|
| 布局 | 自研 flex 子集 + 以 Yoga 为 oracle 差分测试 | Yoga 是 C/WASM 依赖，替换目标是"零原生"，不能把 Yoga 带进来；自研子集可控且测试期可用 opentui 的 Yoga 做金标准 | ① 直接用 `yoga.wasm`（引入 wasm 依赖，与"零原生"目标冲突但**可接受**，若工期紧可作备选）；② 继续手写两遍法（无法覆盖 98 处 flexShrink） |
| 语法高亮 | tree-sitter WASM | 与现有 `parsers-config.ts` + 主题规则同源，避免"自研高亮 + opentui 高亮"两套口径长期并存 | shiki（纯 JS 成熟，但逐帧成本高、主题口径与 `theme/index.ts` 不同源） |
| 编辑器 | 自研 `EditBuffer`（不引第三方） | 需求明确（extmarks/virtual lines/undo），第三方 TUI 编辑器无法嵌入字符网格 | 复用 `@opentui/core/edit-buffer`（正是要删的包） |
| keymap | 自研核心 + 复用现有绑定表 | 绑定表是数据（`config/keybind.ts`），逻辑只有"前缀树 + 分发 + leader" | 移植 `@opentui/keymap`（同样是待删依赖） |
| 音频 | 调系统播放器 | 与渲染器解耦，`attention.ts:118-124` 已是注入式（`audio?: Pick<...>`），改注入实现即可 | 自研 WAV 解码（不必要） |
| 图像 | 剔除 | 实测产线 0 处 `<image>` | — |

---

## 9. 关于「复用 `D:\00MyAI\HR` 组件」

**先给结论：HR 的 `.vue` 组件无法在 TUI 内复用，但它的交互规格与部分纯 TS 逻辑可以。**

事实核对：

- `D:\00MyAI\HR\frontend-geeker` 是 **Vue 3 + Vite 的 Web 前端**：`src` 下 169 个 `.vue`、84 个 `.ts`，`src/components` 24 个 `.vue`。
- 本仓库 TUI 是 **Solid + 终端字符网格**，无 DOM、无 CSS、无浏览器布局引擎；`.vue` 单文件组件的 `<template>/<style>` 无处落地。
- 实测依赖：`src/hooks` 9 个文件中 5 个 `import ... from "vue"`（`useAuthButtons`/`useOnline`/`useSelection`/`useTable`/`useTime`）；`src/utils` 10 个文件与 `src/enums`/`src/config` 全部 Vue-free。

可复用的三块：

1. **交互与信息架构规格**（价值最高）：`src/components`、`src/views` 的字段顺序、表格列定义、表单校验提示位置、空态/加载态处理，可作为 M6 控件与 41 个 dialog 重排的 UX 参照。
2. **纯 TS 逻辑**（需逐个核实）：`src/utils/desensitization.ts`（脱敏，与仓库 `data-desensitization-security` 规则呼应）、`src/utils/dict.ts`（字典/枚举映射）、`src/utils/color.ts`、`src/enums/httpEnum.ts`。
3. **词条**：`src/languages` 的文案可映射到 `src/tui/fallback/i18n.ts`（74 行，当前只有极少词条）。

落地方式（若确实要"用 HR 的控件"）：把 HR 组件的**字段/交互契约**抽成后端无关的 descriptor（`{ columns, fields, actions, validators }`），由 TUI 控件消费；**不要**尝试在终端里渲染 Web 组件。

---

## 10. 风险与回滚

| 风险 | 等级 | 触发信号 | 缓解 |
|------|------|----------|------|
| 布局引擎与 Yoga 长期存在细微偏差 | 高 | 快照矩阵出现 >5% 差异 | M1 的金标准差分测试前置；偏差项逐条落白名单并注明可接受理由 |
| 自研编辑器无法覆盖 prompt 全部交互 | 高 | M4 验收用例失败 | 旧 `Textarea` 保留为 `GYC_FALLBACK_EDITOR=legacy`；M4 单独可回退 |
| tree-sitter wasm 首次加载慢/离线不可用 | 中 | 首帧 >300ms 或离线失败 | 预打包 wasm 到 `assets/`，LRU 池化，失败降级正则 |
| 工期超预期导致"半替代"状态长期存在 | 中 | M6 结束仍有 `@opentui` import | 每个里程碑结束跑 `scan-opentui-surface.mjs`，import 数必须单调下降 |
| 性能回退（纯 JS 差分） | 中 | 全量帧 >2× opentui | M0 就把 bench 纳入 CI；D1 修复后重测基线 |
| 删除 opentui 后失去 `GYC_TUI_BACKEND=opentui` 保险丝 | 高 | M8 执行 | M8 单独提交 + 保留一个版本周期再删依赖；A2 归档（`~/.gyc/backups/opentui-0.5.6.zip`）仍有效 |

---

## 11. 立即可做的 10 件事（不依赖立项决策）

1. 修 D1：`screen.ts:130-138` 的 `clear()` 不再无条件递增所有行戳（或 `repaint` 改双缓冲 swap），修完重测帧耗时。
2. 修 D3：`terminal.ts:45-55` 去掉错误的 UTF-8 边界逻辑。
3. 修 D4：`diff.ts:11-37` 改为消费 `capability.ts:64-75` 的 probe 结果，删掉重复的 `detectTrueColor/detect256Color`。
4. 修 D6：`diff.ts:5-7`、`diff.ts:99-101` 的乱码注释。
5. 修 D5：`dialog.ts:41,53-59` 改走 `TerminalBackend`，至少不再抢 stdin。
6. 澄清 D2：`app.tsx:287-289` 注释与 `safe-mode.ts:31-32` 对齐（默认值改不改请谷总定）。
7. 新增 `scripts/scan-opentui-surface.mjs`，把第 4 章统计变成可重复执行的脚本。
8. 新增 `captureSpans`（`src/tui/fallback/testing/capture.ts`），让快照能断言样式。
9. 给 `Screen` 加 `captureSpans` 后的第一个用途：为现有 24 个 fallback 测试补"样式断言"，防止后续重构悄悄丢样式。
10. 把 `docs/compose/plans/2026-08-26-opentui-replacement-readiness.md` 的 T1–T6 触发条件与本文 M0–M8 对齐，更新「S3 重启条件」——当前它写的三个条件（Markdown/Dialog/灰度 2 周）**不足以支撑全量替代**，应替换为本文第 6 章 DoD。
