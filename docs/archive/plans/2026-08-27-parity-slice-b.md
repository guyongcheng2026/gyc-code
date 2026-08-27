# 功能平价 slice B：常用组件 + 代码高亮 + 性能超越（100% 覆盖路线第 2 步）

日期：2026-08-27 · 目标：常用功能 100% 覆盖 + 性能超越 opentui + 全面中文化

## 一、opentui 20 个 renderable 覆盖矩阵

| opentui 组件 | fallback 状态 | 本 slice | 备注 |
|---|---|---|---|
| Box/Text/Textarea/Input/ScrollBox/Markdown | ✅ slice A | — | 已平价 |
| **Select** | ❌ | ✅ | Dialog/菜单基础件 |
| **ScrollBar** | ❌ | ✅ | ScrollBox 视觉指示 |
| **TextTable** | ❌ | ✅ | 数据表格 |
| **Code（语法高亮）** | ❌ | ✅ | 正则通用高亮器（零原生） |
| TabSelect/Slider | ❌ | 后续 | 标签页/滑块 |
| Diff/LineNumber | ❌ | 后续 | diff-viewer 场景 |
| EditBuffer/TextBuffer/FrameBuffer | ❌ | 后续 | 高级文本缓冲 |
| ASCIIFont/Image/EmbeddedTerminal | ❌ | 观察 | CLI 会话场景非核心 |

## 二、性能超越策略

当前基线（80x24）：全量帧 0.150ms；opentui 同场景实测约 5-10ms/帧（含 yoga 布局 + 原生层）。
优化点：
1. **行哈希差分**：renderDelta 先比较行哈希（O(1)/行），跳过未变行的逐格比较——
   大屏（200x50）增量帧耗时从 O(rows×cols) 降到 O(changed_rows×cols)
2. **量算缓存**：measureNode 结果按 (节点版本, 宽度) memo——Solid 树变更频繁但
   局部，全量 paint 时未变子树跳过量算
3. **bench 脚本**：多尺寸（80x24/120x40/200x50）× 全量/增量对比数据落盘

## 三、中文化

- 新组件 API 注释、界面文案全中文（既有约定延续）
- Markdown/高亮器配色注释中文化

## 四、任务

- [x] 计划
- [x] Select 组件（上下/回车/Esc/可见性滚动）
- [x] ScrollBar（竖直比例条，滚动位置指示）
- [x] TextTable（对齐列 + 表头样式）
- [x] 代码高亮器（highlight.ts：关键字/字符串/注释/数字，md 代码块接入）
- [x] 行戳差分（diff.ts + screen.ts）
- [x] 量算缓存（nodes/renderer/paint）
- [x] 测试 + tsc + lint + 提交

## 五、验收记录（2026-08-27）

- fallback 全量：**106 pass / 0 fail**（slice B 新增 11 用例：Select 3 + ScrollBar 2 + TextTable 1 + 高亮 2 + 性能 3）
- **性能基准（2000 次迭代均值）**：
  - 80x24 全量帧：0.150ms → **0.102ms（-32%）**
  - 120x40 全量帧：**0.260ms**；增量帧 24B 不变
  - 对比 opentui 同场景（5-10ms/帧）：**领先 50-100 倍**，P5 验收线（≤2 倍）超额满足
- 性能机制：①行写戳短路（未变行 O(1) 跳过）②值比较写入（相同内容吸收，stamp 不递增）
  ③cellEqual 浅比较替代 cellKey 字符串构造 ④量算缓存（props/子树变更沿父链失效）
- scoped tsc 0 错误；lint 0 问题

## 六、覆盖矩阵更新（slice B 后）

常用组件已全覆盖：Box/Text/Textarea/Input/ScrollBox/Markdown/**Select/ScrollBar/TextTable/代码高亮**。
剩余（次常用）：TabSelect/Slider/Diff/LineNumber/EditBuffer/FrameBuffer/ASCIIFont/Image/EmbeddedTerminal。
