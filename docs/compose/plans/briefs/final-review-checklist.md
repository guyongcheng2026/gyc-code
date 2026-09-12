# 最终代码审查清单：Hermes 闭环学习移植

审查范围：commit `0077c0cdf4..HEAD`（16 个提交，约 5088 行新增）。用 `git diff 0077c0cdf4..HEAD -- <path>` 看具体文件。

## 背景（一句话）

把 Hermes Agent 的「任务完成 → 沉淀技能文档」闭环移植进 gyc-code：新增 `src/gyccode/learning/`（技能沉淀）、`src/gyccode/memory/user-model.ts`（谷总画像层），并把会话检索升级为 FTS5。设计原则：沉淀全部在会话尾部 fork，失败绝不影响主循环；技能写入要过三道闸门。

## 请重点审查以下 7 个问题（有就报，没有就说没有）

1. **主循环会不会被沉淀拖住或搞崩？**
   看 `src/gyccode/session/prompt.ts` 里 `learningTrigger` 的计数点、以及退出分支里的 `runReview(...).pipe(Effect.forkIn(scope))`。
   - `markReviewed()` 在 fork **之前**调用——会不会出现「标记了但因为异常没 fork 成功，导致本会话永远不再沉淀」？
   - 计数用的 `toolSignatures(lastAssistantMsg?.parts ?? []).length` 会不会重复计数（每轮把同一批工具重复累加）？
   - `feedback`：`Effect.forkIn(scope)` 的 `scope` 生命周期是否覆盖到 fork 的完成？如果 scope 在循环退出后立即关闭，fork 会不会被静默取消？

2. **技能写入的三道闸门有没有绕过路径？**
   看 `src/gyccode/learning/skill-store.ts`。
   - provenance 闸门（只能改 `origin === "agent" && !pinned`）是否覆盖 create / patch / writeSupportFile / archive / restore 全部五个入口？
   - read-before-write 闸门的 read-mark 是按**路径**还是按**技能名**记的？跨技能会不会串味？
   - `create` 时若 `.usage.json` 里已有同名条目但目录不存在（中间态），会怎样？

3. **`runner` 是否真的从不抛错？**
   看 `src/gyccode/learning/runner.ts`。宿主的期望是「沉淀失败绝不能冒泡到主循环」。
   - `parseActions` 对畸形输入（非数组、嵌套对象、超长）是否稳妥？
   - 单条动作被 store 拒绝后，其余动作是否继续？
   - reviewer 抛错（`Effect.die`）时是否被捕获？

4. **`session-search` 的 FTS 路径与回退路径是否等价？**
   看 `src/core/session-search.ts` 与 `src/core/session-search-index.ts`。
   - `toFtsPhrase` 把用户输入包成双引号短语，是否足以防止 FTS5 语法注入（例如输入含 `"` / `*` / `NEAR` / `:`）？
   - 短于 3 码点走 LIKE、其余走 FTS——会不会出现「同一个查询有时命中有时不命中」的不一致？
   - `try/catch` 兜住 FTS 报错后回退 LIKE：如果 FTS 查询**成功但返回空**、而 LIKE 本会有结果，这种情况存在吗？

5. **画像层的缓存与跨进程一致性**
   看 `src/gyccode/memory/user-model.ts` 的 `readUserModelCached` 与 `writeUserModel`。
   - 进程内写后失效是否覆盖所有写路径（`writeUserModel` 之外还有谁写这个文件）？
   - 另一个进程改了 `USER.md`，本进程 30 秒内读到旧值——这个窗口在当前用法下会不会造成实际问题？

6. **技能根路径是否还有 HERMES_HOME 泄漏？**
   全仓搜 `HERMES_HOME`。记忆侧的 `memory-bridge.ts` **故意**保留 HERMES_HOME（那是与 Hermes 共享记忆的设计），但 `learning/` 下的技能路径**必须不**采纳它。确认没有残留。

7. **账本与回滚**
   看 `src/gyccode/learning/ledger.ts`。
   - `appendEntry` 吞掉一切失败（遥测语义），`rollbackEntry` 找不到 id 必须抛错（fail-closed）——这两个语义是否实现正确？
   - `snapshotSkill` 的 blob 是否真的按 sha256 内容寻址、相同内容只存一份？
   - 回滚时删除「after 有但 before 没有」的文件——会不会误删掉用户后来手动加的文件？

## 不要报的内容

- 风格偏好、命名口味、注释措辞。
- 「可以加个缓存 / 可以抽个抽象」这类可选优化。
- 测试内部的写法问题，除非它掩盖了生产代码缺陷。

## 输出格式

按 P0 / P1 / P2 分组；每条给 `path:line` → 代码锚点 → 问题说明 → 触发条件与影响。若某一项确认没问题，用一行说明「第 N 项：无问题」。
