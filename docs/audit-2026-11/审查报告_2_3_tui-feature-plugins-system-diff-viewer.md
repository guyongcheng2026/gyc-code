注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# diff-viewer.tsx 审查报告

- 源文件：`src/tui/feature-plugins/system/diff-viewer.tsx`（1129 行）

# 问题1：差异加载失败被掩盖为「无差异」空状态（2级）

## 问题1分析:

第 801/807/813/819 行四个 Match 分支顺序缺陷：首次加载失败时 diff()=undefined → files()=[]，807 行「无差异！」先命中，813 行「差异加载失败」分支不可达——加载错误（网络/IO 失败）被掩盖成空状态，用户误以为无差异。根因是「空数组」与「未加载/加载失败」共用同一渲染路径，且 Match 按声明顺序匹配。相关数据流：116-133 行 createResource，files=diff()??[]。

### 问题1修复后的代码：
```diff
（读 diff-viewer.tsx 第 795-825 行核对上下文后起草最小修复：在空结果分支前先判断 resource 状态——loading/error 优先匹配，undefined+error 走「差异加载失败」，仅成功且长度为 0 才走「无差异！」）
```

---

## 核查通过项（无问题）
- hunkRowsCache 有容量上限 32 + onCleanup clear（294-318 行）
- scroll 使用处全部判空（393 行等）
- lifecycle 统一管理帧回调（176-184 行）
- createResource 竞态由 Solid 框架处理，无事件订阅泄漏
