# gyc-code Compose 模式移植工作记录

> 日期：2026-08-07
> 对象：gyc-code（opencode 改造版 CLI，C:\Users\谷勇成\gyc-cli）
> 类型：功能移植（对标 MiMo-Code 的 compose 工作流）+ 自动同步机制
> 仓库：本地 C:\Users\谷勇成\gyc-cli / GitHub guyongcheng2026/gyc-code（gh-proxy）
> 提交：18fe331（feat: 新增 compose primary agent + 内置 compose skills）

---

## 一、背景与目标
- gyc-cli TUI 原本只有 build/plan 两个 primary agent，按 Tab 无法切到 compose 模式。
- 目标：对标 MiMo-Code 的 compose 工作流（Plan→TDD→Execute→Review→Debug→Verify→Merge），让 Tab 可循环切换 Build→Plan→Compose，并内置 15 个 compose:* skills + 提示自动注入。

## 二、实现改动
| 文件 | 改动 |
|------|------|
| src/gyccode/agent/agent.ts | 新增 compose primary agent（color #a78bf3，permission question/skill=allow）；list() 排序增加 plan/compose 两级 |
| src/gyccode/skill/compose/.bundle/ | 自 MiMo-Code .bundle 复制 15 个 compose skills + LICENSE（karpathy / superpowers） |
| scripts/gen-compose-bundle.mjs（新增） | 构建时把 .bundle 编译为 bundle.gen.ts（约 324KB 常量）|
| src/gyccode/skill/compose/index.ts（新增） | extractComposeSkills（幂等解包到数据目录 compose/version）、composeSkillsBlock（compose_skills 块注解）、composeRoot |
| src/gyccode/skill/index.ts | Skill.Info 增加 hidden；discovery 对 compose scope 以 hidden:true 扫描；available() 过滤 hidden |
| src/gyccode/session/reminders.ts | 对 compose agent 会话自动注入 PROMPT_COMPOSE + compose_skills 块（synthetic part）|
| src/gyccode/session/prompt/compose.txt | compose 系统提示词（按 gyc-code 语法改写，无 MiMo 品牌字样）|
| src/gyccode/effect/runtime-flags.ts | GYCCODE_DISABLE_COMPOSE_SKILLS 开关 |

## 三、关键决策
- 放弃 Bun macro：实测 Bun 1.3.14 宏在本仓库不可靠（cannot coerce Exception (Cell) to Bun AST），改为构建时生成 TS 常量模块（bundle.gen.ts），运行期无需读磁盘。
- compose skills 保持 hidden：不出现在 <available_skills>，只在 compose 会话注入的 <compose_skills> 中暴露（与 MiMo 设计一致）。
- 解压目录：Global.Path.data/compose/1（本机 C:\Users\谷勇成\.local\share\gyccode\compose\1），以 .extracted 标记防重。

## 四、验证结果
1. Skill.all()=16，其中 compose 15 个全部 hidden=true；Skill.available() 泄漏 0（只暴露内置 customize-gyccode）。
2. ComposeSkill.composeSkillsBlock() 生成 77 行完整 compose_skills 块（含 15 个 compose:*）。
3. SessionReminders.apply 对 compose agent 注入 synthetic part，包含 Compose Agent 提示（5204 字符）+ compose_skills 块，PASS。
4. bun run build 通过（build done）。
5. TUI 实测（node-pty）：Tab 循环 Build→Plan→Compose→Build→Plan→Compose→Build，compose 可正常切换。

## 五、提交与同步
- commit 18fe331（54 files，+9042）；.githooks/post-commit 自动 push GitHub（gh-proxy）。
- 本次建立了「代码→Obsidian」自动同步：.githooks/post-commit 追加调用 scripts/worklog-sync.mjs，把每次 commit 元数据追加到本知识库工作流水并推送。见《gyc-code-工作流水.md》。

## 六、后续维护要点
1. 改动 compose skills：修改 src/gyccode/skill/compose/.bundle/** → bun run build（重新生成 bundle.gen.ts）→ 提升 ComposeSkill.ComposeBundleVersion 以触发重新解包。
2. 记忆（gyc memory）：compose-mode-summary / compose-mode-implementation / compose-mode-verify / compose-mode-next。
3. footer.tsx（Open→Gyc 品牌小改）仍在本仓库工作区未提交。

---

*记录：Codex | 2026-08-07*