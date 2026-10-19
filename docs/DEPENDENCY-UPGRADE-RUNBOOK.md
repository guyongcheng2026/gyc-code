# 依赖升级演练手册（Effect v4 beta / OpenTUI 补丁链）

> 目的：两个最承重的依赖处于 beta / 补丁态（effect 4.0.0-beta.83、@opentui/* 0.5.14），
> 升级是必答题。本手册把"被动升级时全仓红 + 无法定位"的代价，前置为一次可控演练。

## 1. 现状锚点（2026-10-18）

| 依赖 | 版本 | 风险形态 |
| --- | --- | --- |
| effect / @effect/sql-sqlite-bun | 4.0.0-beta.83 | beta 间 API 漂移（已知坑：Effect.void 是值非函数；Tool.define 要求 execute 的 R 通道为 never） |
| @opentui/core / solid / keymap | 0.5.14 | 原生句柄表上限 65,535（TextBuffer）；行为依赖 5 个 postinstall 内联补丁 |
| drizzle（@gyccode/effect-drizzle-sqlite） | workspace 内部 | drizzle({ client }) 位置参数会静默自开空连接（报 no such table 与直查矛盾） |

## 2. OpenTUI 补丁链（勿手动绕过）

postinstall（package.json:16）已串联：apply-opentui-patch → apply-opentui-ffi-patch →
apply-opentui-orphan-patch → apply-opentui-win32-resize-patch → install-hooks →
repair-opentui-platform → **verify-opentui-patches.cjs**（校验，fail 即装失败）。

规则：
1. 拉取/重装依赖后**必须**先看 postinstall 是否全绿；verify 失败时对四补丁脚本
   逐个 `node scripts/apply-opentui-*.cjs --force` 重注入，再跑 verify 至 exit 0。
2. `bun run build` 之前 verify 必须通过；不要用 `|| true` 心态吞掉补丁失败。
3. 升级 opentui 版本时，先在分支上重放四补丁，逐个确认锚点行仍在（锚点失配 = 上游
   改了对应区域，需人工裁决补丁去留）。

## 3. Effect beta 升级演练（季度一次或跟随上游里程碑）

1. 新分支；`bun add effect@latest @effect/sql-sqlite-bun@latest`（仅这两个，不动其他）。
2. `bun run tsc --noEmit` —— 预期暴露 API 漂移点；按报错数量决定"跟随修"或"回退等稳定"。
   经验阈值：>50 个错误点且集中在核心抽象（Effect.gen / Layer / Schema）→ 回退，
   等下一个 beta 或 stable 再演练。
3. `bun run test` 全量（**必须** `bun run test`，禁裸 `bun test`，见 AGENTS.md）。
4. `bun run build` 重建 dist；`bun run health` 冒烟。
5. 全绿后合并；记录本次漂移点清单到 docs/compose/reports/，沉淀到知识库。

## 4. 验证链（任何依赖升级的完成定义）

```
bun run tsc --noEmit   # 0 error
bun run test           # 全量 0 fail（当前基线 2169 pass / 9 skip）
bun run build          # dist 可产出
bun run health         # 冒烟通过
```

## 5. 回滚

升级分支不合即弃；node_modules 级操作用 `bun install --force` 恢复 lockfile 状态后重跑
postinstall 补丁链。禁止在 main 上直接试装 beta。
