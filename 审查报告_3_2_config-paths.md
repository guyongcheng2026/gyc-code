注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：up 的 stop 判定为字符串全等，形式不一致时上溯到文件系统根 2级

## 问题1分析

文件：`src/config/fs-util.ts:168-182`（`up` 函数）

根因：`up` 函数沿目录树上溯查找 `gyccode.json` / `.gyccode` 时，终止条件（stop）采用 `options.stop === current` 的字符串全等判定。该判定在以下场景失效，导致上溯无法终止或误终止：

1. **大小写不一致**：Windows 文件系统不区分大小写，但字符串全等区分。`stop` 传入 `C:\Users\谷勇成`，`current` 经 `path.resolve` 后可能为 `c:\users\谷勇成`，全等失败 → 继续上溯到 `C:\`。
2. **分隔符不一致**：`stop` 用 `/`、`current` 用 `\`（或反之），全等失败。
3. **软链/未 realpath**：若 `stop` 来自 `process.cwd()`（可能含软链段）而 `current` 来自逐级 `path.dirname`，两者字符串不同但指向同一物理目录，全等失败。
4. **终止失败后果**：上溯到文件系统根（如 `C:\` 或 `/`），加载工作区外祖先目录的 `gyccode.json` / `.gyccode`，造成配置污染——用户在工作区 A 内却加载了祖先目录 B 的配置，且该配置可能含敏感的组织级凭据/路径。

对照证据：`project/project.ts:218` 的硬编码 `"/"` 哨兵是同一"根判定不可靠"问题的另一处显化（见 project 报告 3级问题3）；两处共同构成"路径上溯终止逻辑全仓不可靠"的系统性缺陷。

### 问题1修复后的代码

```diff
   while (current !== path.parse(current).root) {
-    if (options.stop === current) break
+    if (path.resolve(options.stop) === path.realpathSync(current)) break
     // ... 查找 gyccode.json / .gyccode
     current = path.dirname(current)
   }
```
