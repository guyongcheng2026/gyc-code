# OpenTUI 稳定性修复：长会话内存泄露与超长会话崩溃

> **日期**：2026-10-02
> **范围**：`src/tui/`（渲染层）、`src/cli/tui/`（worker）、`scripts/`（补丁链）
> **依赖版本**：`@opentui/core` 0.5.6、`@opentui/solid` 0.5.6
> **验证**：`bun run typecheck` 0 error；`bun run test` 1662 pass / 9 skip / 0 fail（197 files）；`bun run build` 成功
> **性质**：崩溃止血（P0）+ 内存泄露收敛（P1）+ 工程加固（P2），无新增依赖

---

## 一、问题定性

opentui 0.5.6 的原生句柄表上限为 **65,535**（实测第 65,535 次 `createTextBuffer` 返回无效句柄，表现为「打开会话即退出」）。句柄按「同时存活」计：单个 `<text>` 约 3 个句柄，带边框 `<box>` 另占 1 个。

既有虚拟化（`src/tui/routes/session/virtual-window.ts`）只约束**消息条数**，不约束：

- **单条内容的行数** —— 一条 5 万行的工具输出即可独占全部预算；
- **消息区之外的常驻 renderable** —— diff-viewer / sidebar / which-key / 浮层完全不受约束。

内存侧另有三条独立增长源：孤儿 part 条目（无回收路径）、`session_diff` 无字节上限、工具输出折叠对全文做码点物化。

---

## 二、修复清单与证据

### P0 崩溃止血

| 编号 | 问题 | 修复 | 证据 |
|---|---|---|---|
| P0-1 | 句柄预算只覆盖消息区 | 新增 `src/tui/util/handle-budget.ts`：常量、折行估算、进程级计数器 | 20 用例 |
| P0-2 | 单条正文/思维链/diff 全文直送渲染器 | 新增 `src/tui/util/limit-content.ts`（行数 + 字节双限）+ `src/tui/component/limited-content.tsx` 闸门；接入 `routes/session/index.tsx` 三处（`<markdown>` / `<code>` / `<diff>`） | 13 用例 |
| P0-3 | `collapseToolOutput` 对全文 `Array.from` | 重写为「先切片后计数 + ASCII 快速通道」 | 实测 32MB 输入堆增量 **38MB → ~0** |

默认上限：单条内容 2000 行 / 512KB，超出折叠并显示被折叠行数。

### P1 内存泄露

| 编号 | 问题 | 修复 | 证据 |
|---|---|---|---|
| P1-1 | `store.part` 孤儿条目无界增长 | 新增 `src/tui/context/part-guard.ts`；`context/sync.tsx` 的 `message.part.updated` 在父消息不在 store 时丢弃事件 | 5 用例 |
| P1-2 | `session_diff` 无字节上限 × 20 个 LRU 会话 | 新增 `src/tui/util/diff-budget.ts`（8MB 预算，保留最新文件）；`sync.tsx` 两处写入接入 | 9 用例 |
| P1-3 | `targetFps` 写死 60/30，忽略终端能力 | `fallback/capability.ts` 新增 `sessionTargetFps()`；plain 终端降至 10fps | 5 用例（并入 capability.test.ts） |
| P1-4 | 原生内存不受 V8 堆约束，守护有盲区 | 新增 `src/tui/util/handle-pressure.ts`；`app.tsx` 内存守护增加句柄预算维度 | 6 用例 |

**P1-1 泄露路径复述**：`message.updated` 超 100 条时 `shift()` 最旧消息并 `delete draft.part[oldest.id]`；该消息的 part 事件若晚到（流式补发 / 重连补发 / revert 残留），原实现因 `store.part[messageID]` 为 undefined 而**无条件重建** `[part]`，此后该 message 已不在 `store.message` 中，淘汰/删除/LRU 三条清理路径均遍历不到它 → 永久驻留。

### P2 工程加固

| 编号 | 问题 | 修复 |
|---|---|---|
| P2-1 | `collapse-tool-output` 的 `Array.from`（即 P0-3） | 已修 |
| P2-2 | `renderBudget` 无会话规模维度 | 未做，见第五节 |
| P2-3 | postinstall 用 `&&` 串联，任一 patch `exit(1)` 会中断后续（含 hooks 安装），用户拿到**未打补丁**的 opentui | `package.json:16` 改为 `\|\| true` 不短路串联；新增 `scripts/verify-opentui-patches.cjs` 收尾校验，**恒 exit 0** |
| P2-4 | diff 视图每次按键对整份 patch 做 `split("\n")` | `feature-plugins/system/diff-viewer.tsx` 按 diff 字符串缓存 hunk 行偏移（LRU 32 份 + `onCleanup` 清理） |
| P2-5 | `virtualTopPoll` 500ms 常驻轮询 | `routes/session/index.tsx` 降至 1000ms |
| 附带 | `sync.tsx` `vcs.branch.updated` 分支引用了 `lsp.updated` case 块内的 `workspace` → ReferenceError，该分支从未成功执行 | 在本 case 内重新取值 |

---

## 三、新增文件

```
src/tui/util/handle-budget.ts          句柄预算常量 / 折行估算 / 计数器
src/tui/util/limit-content.ts          单条内容行数 + 字节折叠
src/tui/util/diff-budget.ts            session_diff 字节预算
src/tui/util/handle-pressure.ts        句柄压力档位
src/tui/context/part-guard.ts          孤儿 part 事件判定
src/tui/component/limited-content.tsx  受限富渲染闸门组件
scripts/verify-opentui-patches.cjs     补丁链只读校验
```

配套测试：`handle-budget` 20 / `limit-content` 13 / `diff-budget` 9 / `handle-pressure` 6 / `part-guard` 5 / `collapse-tool-output` 8。

修改文件：`package.json`、`src/tui/app.tsx`、`src/tui/context/sync.tsx`、`src/tui/routes/session/index.tsx`、`src/tui/feature-plugins/system/diff-viewer.tsx`、`src/tui/util/collapse-tool-output.ts`、`src/tui/fallback/capability.ts`、`src/tui/fallback/capability.test.ts`、`.gitignore`、`scripts/manual_content_7.py`、`docs/gyccode操作手册.docx`。

---

## 四、补丁链现状校验

`scripts/verify-opentui-patches.cjs` 读 marker 校验，三项均 **OK**：

```
[gyc-patch] 补丁链校验：
  [OK]   @opentui/solid 惰性 jsx
  [OK]   @opentui/solid 孤儿空文本
  [OK]   @opentui/core node:ffi→koffi
```

补丁含义对照（供后续升级参考）：

| 脚本 | 绕开的缺陷 |
|---|---|
| `apply-opentui-patch.cjs` | bun 编译时函数组件被立即 `createComponent`，导致 `TuiStartupProvider is missing` |
| `apply-opentui-ffi-patch.cjs` | OpenTUI Node 后端依赖 `node:ffi`，Node 主线未内置 → 注入 koffi 适配 |
| `apply-opentui-orphan-patch.cjs` | Solid 条件渲染把 `""` 占位插入 children，reconciler 文本化后因缺 `<text>` 父级抛 `Orphan text error` |

三者均幂等（命中 marker 即跳过），原文不匹配时 `exit(1)` —— 这正是 P2-3 改为不短路的原因。

---

## 五、已知限制（未做）

1. **`estimateContentHandles` 是保守估算**：opentui 未暴露已用句柄数读取接口，无法精确计量。`globalHandleBudget` 现已接线到 `LimitedContent` 的挂载/卸载生命周期（`src/tui/component/limited-content.tsx:60-79`），`reserve/release` 正常工作，`handleBudgetPressure` 日志维度已就位且会触发。（文档于 `08c1b53` 之后滞后，现已校正。）
2. ~~**`LimitedContent` 的 `plain` 分支按整段渲染单个 `<text>`**~~ —— **已收口**：`splitPlainRows`（`src/tui/component/limited-content.tsx:112`）按行切分，`:86` 逐行渲染，测试见 `limited-content-split.test.ts`（8 例）。
3. ~~**`renderBudget` 仍只有 plain/非 plain 两档，未按会话规模或节点预算降档**~~ —— **已收口**：`sessionTargetFps`（`src/tui/fallback/capability.ts:147`）按会话规模 `renderScale()` 降档，`src/tui/routes/session/index.tsx:398/401` 在流式开始/结束时分别设 `streaming` 与静默态的 targetFps。
4. **未做真实终端 2 小时长跑内存曲线对比** —— 无头环境下 CPU 数据不可信，`scripts/measure-memory.ts` 需真实 TTY。

---

## 六、复现与验收

崩溃复现条件：单条消息内容超过 2000 行或 512KB（此前会直接撞满句柄表）。修复后同一输入应折叠为「前 2000 行 + 折叠行数提示」，且 `bun test src/tui/util/limit-content.test.ts` 中「5 万行内容估算远超预算」用例可确认估算生效。

内存验收口径：
- `collapse-tool-output.test.ts` 的「32MB 输入堆增量 < 8MB」用例 —— 旧实现为 38MB，可直接对比；
- 长时间运行后 `store.part` 键数应与「已访问会话数」解耦（B1）；
- `session_diff` 常驻字节应不超过 8MB（B2）。

---

## 七、过程记录（供后续同类任务参考）

1. **PowerShell 批量改文件会毁编码**。用 `(Get-Content -Raw) -replace ... | Set-Content -Encoding UTF8` 改 `src/tui/routes/session/index.tsx` 时，中文被按 GBK 误解码且行尾字节被吞，产生数十个 `TS1002 Unterminated string literal`。修复方式：`git checkout --` 该文件后改用 Edit 工具重做。**含中文的文件一律用 Edit/Write 工具，不用 PowerShell 改写。**
2. **测试断言要先核对实现语义**。本次有两处断言写错（emoji 孤立代理项检查、`m0` 是否为孤儿），是实现正确、测试错误——不能改实现迁就测试。
3. **内存回归测试要有区分度**。初版阈值 64MB 对旧实现（32MB 输入涨 38MB）不具区分度，先实测旧实现再定阈值，否则是假回归测试。
