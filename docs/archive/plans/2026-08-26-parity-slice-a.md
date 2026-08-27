# 功能平价建设 slice A：布局增强 + 富文本 + Markdown（S3 前置）

日期：2026-08-26 · 目标：核心/基础/常用功能对齐 opentui，逐步清除依赖

## 一、差距分析（opentui vs fallback）

| 能力 | 优先级 | 本 slice |
|------|--------|---------|
| 水平布局（row） | 核心（状态条横排、双栏） | ✅ |
| border/padding/gap | 基础（视觉结构） | ✅ |
| 样式继承（嵌套 text） | 基础（富文本前提） | ✅ |
| 行内富文本（spans） | 基础（Markdown 前提） | ✅ |
| Markdown 渲染 | 核心（AI 回复载体） | ✅ |
| Select 组件 | 常用 | 下一 slice |
| 鼠标/选区 | 常用 | 后续 |

## 二、设计

### 2.1 布局增强（paint.ts）
- `direction?: "row" | "column"`（默认 column，向后兼容）：row 模式子元素横向排列，
  宽度缺省按内容量算（wrap 宽 = 剩余空间），高度继承父高
- `border?: boolean | "single" | "double"`：绘制框线，内容区内缩 1 格
- `padding?: number`：内容内缩
- `gap?: number`：子元素间距（column 纵向 / row 横向）
- 量算两遍法扩展：row 模式先量各子内容宽度，flex 瓜分剩余宽

### 2.2 富文本行（styled spans）
- `StyledSpan = { text: string; style: CellStyle }`
- 富文本行 wrap：拼 (char, style) 虚拟流按显示宽折行，输出每行 span 段
- text 元素新增 `spans` prop；无 spans 时保持纯文本路径（兼容）
- 样式继承：text 无自身 style 时继承最近祖先 style（有限深度，避免递归成本）

### 2.3 Markdown（markdown.ts）
最小解析器（不引依赖，逐行扫描 + 行内正则）：
- 块级：`#`~`######` 标题（bold）；``` 代码块（dim + 左边界线）；
  `- `/`* ` 无序列表（"• "）；`1. ` 有序列表（序号）；`> ` 引用（dim + "│ "）；
  `---` 分隔线（─ 填充）；空行分段
- 行内：`**bold**` / `*italic*` / `` `code` ``（fg+bg）/ `~~strike~~`
- 输出 `MarkdownLine = StyledSpan[]`（含列表/引用前缀 span）

### 2.4 组件（components.tsx）
- `Markdown(props: { source: string })`：解析 + For 渲染每行富文本 text
- Text 扩展 spans 透传

## 三、任务

- [x] 计划文档
- [x] 布局增强（direction/border/padding/gap）
- [x] 富文本 spans 行渲染 + wrap
- [x] 样式继承
- [x] markdown.ts 解析器
- [x] Markdown/Text 组件
- [x] 测试（布局 6 + 富文本 4 + markdown 8+）
- [x] 全量回归 + tsc + lint + 提交

## 四、明确不做（本 slice）

- Select/TabSelect、鼠标、选区、剪贴板（下一 slice）
- 嵌套列表/表格/图片语法（Markdown 深水区，按需再加）
- yoga 完整 flexbox（过度工程；row+flex+gap 已覆盖核心 UI 形态）
