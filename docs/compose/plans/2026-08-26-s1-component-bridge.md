# S1 组件桥接实施计划（Solid reconciler + 三大件）

日期：2026-08-26 · 阶段：S1（第 2-3 周）· 回滚点：R2（双渲染器并存，默认仍 opentui）

## 一、目标

让 Solid 组件树直接运行在自研 fallback 渲染器上：自建 universal reconciler（solid-js/universal），
提供 ScrollBox/Textarea/Input 三大件，`GYC_TUI_BACKEND=fallback` 路径升级为 Solid 驱动的会话视图。
默认路径（auto/opentui）零改动。

## 二、架构决策

### 2.1 JSX 转译分流（关键基建）
- `babel-plugin-jsx-dom-expressions` 不支持文件级 `@jsxImportSource` pragma（已验证源码）。
- 方案：package.json `imports` 别名 `#fallback-solid/*` → `./src/tui/fallback/solid/*`（Node/Bun 标准），
  tsconfig paths 同步；`bun-solid-plugin.ts` 的 onLoad 按路径分流（`src/tui/fallback` 下的 .tsx
  用 `moduleName="#fallback-solid"`，其余不变）。
- 构建链（build.mjs / preload / bun test）全部经 `createSolidTransformPlugin`，分流一处生效全局继承。

### 2.2 节点模型（区域树，非盒子树）
- ElementNode：type/props/children/parent + 布局矩形（x/y/width/height）
- TextNode：text
- createRenderer 的 10 个节点操作 = 纯树操作；渲染 = dirty 标记 → 微任务全量 paint → Screen 重写
  → FallbackRenderer 差分输出（字节增量由 diff 引擎保证，全量 paint 实测 0.15ms 级）。

### 2.3 布局（最小垂直流）
- 显式 width/height 优先；width 缺省继承父宽；height 缺省按内容自适应。
- `flex` 标记占父级剩余高度（app shell 用）。
- text 内容按显示宽 wrap 成行（string-width 口径，与网格同源）。

### 2.4 三大件
- ScrollBox：视口裁剪 + scrollTop + scrollBy/scrollToBottom API，底部跟随。
- Textarea：逻辑行 + 软 wrap 显示行映射 + 光标（上/下/左/右/Home/End）+ 编辑
  （插入/删除/退格合并/回车换行），CJK 宽度安全。
- Input：Textarea 单行特化（Enter 提交 onSubmit）。

## 五、验收记录（slice 1，2026-08-26）

- fallback 全量：**71 pass / 0 fail**（S1 新增 11 用例：reconciler 5 + ScrollBox 2 + Textarea 3 + FallbackApp 集成 1）
- scoped tsc（tsconfig.poc-fallback.json 扩容 8 文件 + paths）：**0 错误**
- lint：solid/ 与 fallback/ 零错误；app.tsx 剩 2 个预存 HINT（未用变量，非本次）
- 端到端链路实证：JSX pragma（TS 类型）+ babel 路径分流（运行时）+ solid-js/universal
  reconciler + 区域树布局 + 差分帧输出，FallbackApp 集成测试（按键流→提交→回显→退出）全绿
- 已知边界（记入 slice 2）：resize 时 FallbackRenderer.flushFull 先于重布局输出一次空帧（可感知闪烁）；
  Textarea 光标强制可见滚动（贴底收敛模式）；无光标闪烁动画；无鼠标/选区

## 六、测试命令变更（重要）

fallback 目录含 .tsx 后，测试必须带 solid 转译 preload：

```
bun test --preload ./scripts/bun-solid-preload.ts src/tui/fallback
```

（原 `bun test src/tui/fallback` 不带 preload 会因 .tsx 未转译而失败）

- [x] JSX 分流基建：imports 别名 + tsconfig paths + bun-solid-plugin 路由
- [x] `solid/nodes.ts`：节点模型与树操作
- [x] `solid/renderer.ts`：createRenderer 绑定 + render() + dirty 调度
- [x] `solid/paint.ts`：布局计算 + Screen 绘制
- [x] `solid/jsx-runtime.ts` / `jsx-dev-runtime.ts`：JSX 工厂 + JSX 命名空间
- [x] `solid/components.tsx`：Box/Text/ScrollBox/Textarea/Input
- [x] `fallback/app.tsx`：S1 会话视图（标题条/消息流/状态条/输入区）
- [x] `app.tsx` 接线：显式 fallback 分支改跑 S1 App（崩溃降级路径保留 DemoApp）
- [x] 测试：nodes/paint/组件/集成
- [x] scoped tsc 纳入新文件
- [x] 提交（R2 锚点）

## 四、明确不做（slice 边界）

- 鼠标、选区、剪贴板集成（S2）
- 光标闪烁动画、文本样式继承体系（S2 按需）
- Markdown/tree-sitter 渲染组件（S2+，复用 P1 rich-text 层）
- 对话式双向数据流（真实会话 RPC 接入）——S1 App 是本地回显视图，
  会话接线在 S2 灰度切换时完成

## 五、R2 回滚

`git revert <S1-commit>`。默认 opentui 路径零改动；显式 fallback 退回 S0 安全模式预览。
