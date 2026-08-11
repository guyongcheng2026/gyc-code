# GitHub Spec Kit — 规范驱动开发工具箱研究

> 研究日期：2026-08-01
> 状态：已研究，未安装（用户选择仅入库）
> 来源：https://github.com/github/spec-kit

---

## 一、是什么

**Spec Kit** 是 GitHub 官方开源的**规范驱动开发（Spec-Driven Development）**工具箱，一句话需求自动展开成规格/设计/任务。

- ⭐ **124,928 星**（GitHub 官方仓库，2025-08 创建，一年内爆发式增长）
- 定位：解决 vibe coding 最大的坑——**方向跑偏**。让 Agent 先对齐（写规格）再执行（写代码）
- 核心理念：**规格可执行化**——规范不再是被丢弃的脚手架，而是直接生成工作实现

## 二、核心流程（SDD 五步）

```
/speckit.constitution → 项目原则（代码质量/测试标准/UX/性能）
/speckit.specify      → 需求规格（说 what/why，不说技术栈）
/speckit.plan         → 技术方案（指定技术栈/架构）
/speckit.tasks        → 任务清单（可执行任务列表）
/speckit.implement    → 执行实现（按计划构建功能）
```

### 可选增强命令

| 命令 | 作用 |
|------|------|
| `/speckit.clarify` | 澄清模糊需求（plan 之前推荐） |
| `/speckit.analyze` | 跨工件一致性与覆盖分析（tasks 后 implement 前） |
| `/speckit.checklist` | 生成质量检查清单（"英语版单元测试"） |
| `/speckit.taskstoissues` | 任务列表转 GitHub Issues |
| `/speckit.converge` | 评估代码库与 spec/plan/tasks 差距，追加剩余任务 |

## 三、技术架构

- **specify CLI**：核心工具，Python 实现（需要 uv 或 pipx + Python 3.11+）
- **安装**：`uv tool install specify-cli` 或从 PyPI `pip install specify-cli`
- **扩展体系**：Extensions（新增能力）+ Presets（定制流程）+ Bundles（角色套装）
- **支持 30+ AI 编码工具**：Claude Code、Codex、Copilot、Cursor 等
- **两种安装模式**：
  - slash-command 模式（`.claude/commands/` 下的提示词文件）
  - **skills 模式**（`--integration-options="--skills"`，产物是标准 SKILL.md）⭐ Hermes 兼容

## 四、发展阶段（适用场景）

| 阶段 | 场景 | 说明 |
|------|------|------|
| 0-to-1 | 新项目 | 需求→规格→计划→构建生产级应用 |
| 创意探索 | 并行实现 | 多技术栈/多架构/UX实验 |
| 迭代增强 | 存量项目 | 增量加功能/遗留系统现代化 |

## 五、对 Hermes 的适用性评估

### ✅ 适合（高度推荐）

1. **格式兼容**：skills 模式产物是标准 SKILL.md，Hermes 原生支持
2. **官方背书**：GitHub 官方 12.5 万星，质量可靠
3. **理念契合**：与用户 compose 技能（Plan→TDD→Execute→Review）同一理念的工业化版本
4. **解决真痛点**：先对齐再执行，防止 AI 开发方向跑偏

### ⚠️ 需要适配

- 依赖：uv（Python 包管理器）+ Python 3.11+
- 命令是 `/speckit.xxx` 斜杠格式 → 需转成 Hermes 技能调用方式
- 核心 `specify` CLI 可独立运行，Hermes 能直接调 terminal 执行

### 决策记录

- **2026-08-01**：用户选择仅研究入库，暂不安装（选项 D）
- 后续如需安装：`uv tool install specify-cli` + 用 skills 模式初始化

---

*研究：小翎 | 2026-08-01*
