# Task 4 规格：技能存储与两道闸门

## 要新建的文件

1. `src/gyccode/learning/skill-store.ts`
2. `src/gyccode/learning/skill-store.test.ts`

## 已有基础（不要修改它们）

`src/gyccode/learning/` 下已有三个已提交模块，直接用：

**paths.ts** 导出：`gycHome()`、`skillsRoot(root?)`、`archiveRoot(root?)`、`skillDir(root, name)`、`skillFile(root, name)`、`usagePath(root?)`、`ledgerPath(root?)`、`blobsDir(root?)`、`learningStatePath(root?)`、`SUPPORT_DIRS`（references / templates / scripts 三类）、`isValidSkillName(name)`、`isValidSupportPath(rel)`

**usage.ts** 导出：类型 `SkillOrigin` / `SkillState` / `SkillUsageEntry { origin, state, pinned, useCount, viewCount, patchCount, createdAt, lastActivityAt }` / `SkillUsage`；函数 `readUsage(root)`、`recordCreated(root, name, origin)`、`bumpView`、`bumpUse`、`bumpPatch(root, name)`、`setState(root, name, state)`、`setPinned(root, name, pinned)`、`isWritable(entry)`

**ledger.ts** 导出：类型 `FileSnapshot { path, sha256 }` / `LedgerEntry { id, ts, actor, action, skill, evidence: { sessionId }, before, after }`；函数 `sha256(content)`、`snapshotSkill(root, name)`、`appendEntry(root, input)`（input = `{ actor, action, skill, sessionId, before, after }`，返回 id，失败吞掉）、`readLedger(root)`、`rollbackEntry(root, id)`

动手前先确认这三个文件的实际导出签名，可能与上面描述略有不符。

## skill-store.ts 接口

```ts
export interface SkillInfo { name: string; description: string; body: string; files: string[] }

export type RejectReason =
  | "invalid-name" | "already-exists" | "not-found" | "not-writable"
  | "read-before-write" | "invalid-support-path" | "invalid-content"

export type ApplyResult = { ok: true } | { ok: false; reason: RejectReason; message: string }

export interface SkillStore {
  list(): Promise<string[]>
  read(name: string): Promise<SkillInfo | undefined>
  readSupportFile(name: string, rel: string): Promise<string | undefined>
  create(input: { name: string; description: string; body: string; sessionId: string }): Promise<ApplyResult>
  patch(input: { name: string; description?: string; body?: string; sessionId: string }): Promise<ApplyResult>
  writeSupportFile(input: { name: string; filePath: string; content: string; sessionId: string }): Promise<ApplyResult>
  archive(input: { name: string; sessionId: string; reason: string }): Promise<ApplyResult>
  restore(input: { name: string; sessionId: string }): Promise<ApplyResult>
}

export function make(root: string): SkillStore
```

## 行为要求

### SKILL.md 格式

必须带 YAML frontmatter，供 gyc 技能发现器识别：

```
---
name: <name>
description: <description>
---

<body>
```

提供内部函数 `formatSkillFile(name, description, body)` 与 `parseSkillFile(raw)`：解析出 `description` 与 `body`；解析不出 frontmatter 时 `description` 为空、`body` 为整份内容。

### read-mark（闸门二）

store 实例内部维护一个 `Set`，记录本次沉淀中已读过的路径。`read(name)` 与 `readSupportFile(name, rel)` 写入这个集合。`patch` 前必须已 `read` 过该技能的 SKILL.md，否则返回 `reason` 为 `read-before-write` 的拒绝。

### create

- `isValidSkillName(name)` 为假 → `invalid-name`
- 技能目录已存在 → `already-exists`
- 不在 `.usage.json` 中时先调 `recordCreated(root, name, "agent")`
- 成功时：`snapshotSkill` 取 before（应为空数组）→ 写 SKILL.md → `snapshotSkill` 取 after → `appendEntry({ actor: "agent", action: "create", skill: name, sessionId, before, after })`

### patch（闸门一 + 闸门二）

- 技能不存在 → `not-found`
- `isWritable((await readUsage(root))[name])` 为假 → `not-writable`（provenance 白名单：只写 agent 自建且未 pinned 的）
- 未先 `read` 过 → `read-before-write`
- `description` 与 `body` 都未提供 → `invalid-content`
- 未提供的字段保持原值；成功时重写 SKILL.md，落账 `action: "patch"`，并 `bumpPatch(root, name)`

### writeSupportFile

- `isValidSupportPath(filePath)` 为假 → `invalid-support-path`
- 技能不存在 → `not-found`；不可写 → `not-writable`
- **新增**文件不需要先读；**覆盖已存在**文件时必须已 `readSupportFile` 过该文件，否则 `read-before-write`
- 成功时落账 `action: "write_file"`（before / after 用 `snapshotSkill` 取整个技能目录的快照，不是单文件），并 `bumpPatch(root, name)`

### archive

用 `rename` 把 `skillDir(root, name)` 移到 `archiveRoot(root)` 下、名为 `<name>-<ISO 时间戳去掉冒号与点号>` 的目录；然后 `setState(root, name, "archived")`；落账 `action: "archive"`。技能不存在 → `not-found`。

### restore

在 `archiveRoot(root)` 下找以 `<name>-` 开头的目录，`rename` 回 `skillDir(root, name)`；`setState(root, name, "active")`；落账 `action: "restore"`。找不到 → `not-found`。

### 容错

除语义性拒绝外，文件系统层错误（ENOENT / EEXIST 等）也一律转成 `ok: false` 的拒绝结果，**不让异常抛给调用方**。

## skill-store.test.ts 必须覆盖

用 `mkdtemp(path.join(tmpdir(), "gyc-store-"))` 建临时 root，`afterEach` 清理，**绝不能写真实 `~/.gyc`**。

1. create 合法名 → `ok: true`，SKILL.md 存在且含正确 frontmatter，`.usage.json` 中 `origin` 为 `agent`
2. create 非法名（`fix-1234`）→ `invalid-name`
3. create 已存在 → `already-exists`
4. patch 一个未登记技能（模拟手写或外部安装）→ `not-writable`
5. patch 刚 create 的技能但未先 read → `read-before-write`
6. 先 read 再 patch → `ok: true`，body 已更新，`patchCount` 为 1
7. patch 只给 body 不给 description → description 保持原值
8. writeSupportFile 新建 `references/x.md`（未先读）→ `ok: true`，文件内容正确
9. writeSupportFile 路径逃逸（含 `..`）或传 `SKILL.md` → `invalid-support-path`
10. writeSupportFile 覆盖已存在文件但未先 `readSupportFile` → `read-before-write`
11. archive → 技能目录消失、`skills_archived` 下出现、usage `state` 为 `archived`
12. archive 后 restore → 技能目录回来、`state` 为 `active`
13. 每次成功变更都在 `.ledger.jsonl` 里多一条（用 `readLedger` 断言长度递增与 action 正确）

## 工作方式

TDD：先写 `skill-store.test.ts` → 跑 `bun test src/gyccode/learning/skill-store.test.ts` 确认红 → 写 `skill-store.ts` → 跑绿。可以迭代几轮修失败用例。**不要为了让测试变绿而删用例或弱化断言。**

全部绿后 commit（信息：`feat(learning): 技能存储与 provenance/read-before-write 两道闸门`），最后跑 `bun test src/gyccode/learning` 确认四份测试全绿。

## 铁律

注释、测试描述、提交信息里禁止出现「用户」两字（改用「谷总」或换句式）；注释全简体中文；新文件 UTF-8 无 BOM。

不要修改 `paths.ts` / `usage.ts` / `ledger.ts`；若确实发现它们不满足需要，在回复里说明并停下，不要自己动手改。
