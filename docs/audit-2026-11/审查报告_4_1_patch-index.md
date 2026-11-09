注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度
# 问题1：filePath 未校验路径遍历，存在 ../ 任意文件写入风险 2级
## 问题1分析：
src/gyccode/patch/index.ts:225-239 `*** Add File:` / `*** Delete File:` / `*** Update File:` 分支中 `path: header.filePath` 直接取自解析后的 patch 文本，未对 `filePath` 做 `../` 遍历、绝对路径或工作目录越界校验。攻击者可提交 `*** Add File: ../../etc/passwd` 等 patch，导致任意文件写入或覆盖。
### 问题1修复后的代码：
```diff
   if (line.startsWith("*** Add File:")) {
     const { content, nextIdx } = parseAddFileContent(lines, header.nextIdx)
+    if (!isSafePath(header.filePath)) throw new Error(`Unsafe patch path: ${header.filePath}`)
     hunks.push({
       type: "add",
       path: header.filePath,
       contents: content,
     })
   } else if (line.startsWith("*** Delete File:")) {
+    if (!isSafePath(header.filePath)) throw new Error(`Unsafe patch path: ${header.filePath}`)
     hunks.push({
       type: "delete",
       path: header.filePath,
     })
   } else if (line.startsWith("*** Update File:")) {
+    if (!isSafePath(header.filePath)) throw new Error(`Unsafe patch path: ${header.filePath}`)
     const { chunks, nextIdx } = parseUpdateFileChunks(lines, header.nextIdx)
     hunks.push({
       type: "update",
       path: header.filePath,
       move_path: header.movePath,
       chunks,
     })
+function isSafePath(p: string): boolean {
+  const normalized = path.normalize(p)
+  return !normalized.startsWith("..") && !path.isAbsolute(normalized) && !normalized.includes("\\..\\")
+}
```
