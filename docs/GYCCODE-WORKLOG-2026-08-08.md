# gyc-code 工作记录（2026-08-08）：内存/CPU 优化

## 背景与目标
- 用户环境：Intel i5-5250U（2核4线程）+ 4GB 内存（2015 MacBook Air 级别）
- 问题：运行 gyc CLI 时 CPU 温度高、风扇声音大
- 根因调查结论：
  - 空闲 CPU 仅 2.9%（无空转 bug）
  - 工作负载 CPU 27-41%（Agent 活动固有开销）
  - 真正压力源是内存：WorkingSet ~950MB / Private 1.8GB

## 基线数据（优化前，重启后可对比）
- 空闲 CPU（8 秒无操作）：2.9% 单核
- 工作负载 CPU：27-41% 单核
- WorkingSet：935-978MB（稳态，30 秒采样无持续增长，非泄漏）
- PrivateMemory：1820MB / VirtualMemory：13.1GB
- SQLite 数据库：gyccode-local.db 152MB
  - page_count=39006 x 4096B，freelist_count=0（无法 VACUUM）
  - event 26416 行 + part 6873 行 + message 1464 行 + session 34 行
- 日志：gyccode.log 2.1MB（5 秒无增长）

## 已实施改动（需重启生效）

### 1. SQLite 页缓存降容
- 文件：src/core/database/database.ts
- 改动：PRAGMA cache_size -64000 -> -16000（64MB -> 16MB）

### 2. read-cache 容量上限
- 文件：src/gyccode/tool/read-cache.ts（新增文件）
- 改动：MAX_ENTRIES=200，超出时淘汰最老条目（Map 保持插入顺序）
- 验证：插入 205 条后保持 200；f0/f4 被淘汰，f5/f200/f204 保留

### 3. 命令懒加载
- 文件：src/gyccode/index.ts（+93/-50）
- 改动：移除 20+ 静态命令 import，改为 COMMANDS 映射 + registerCommand 按需加载
- 行为：
  - 非 --help：只加载首参数匹配的命令（默认分支注册 TUI）
  - --help：注册全部命令，db 用轻量占位（避免 help 路径加载 sqlite）
  - alias 支持：auth->providers、plug->plugin
- 验证：24 个命令 --help 全部 exit 0

### 之前会话的改动（一并生效）
- src/codemode/tool-runtime.ts：estimateTokens 精度提升（非 ASCII 按 1 token/字符，ASCII 每 4 字符 1 token）
- src/gyccode/index.ts：DbCommand 懒加载 require -> await import（Bun 构建兼容 top-level await）
- src/gyccode/tool/read.ts：read-cache 集成 + 修复 ReadStop 重复类声明
- src/gyccode/tool/write.ts、edit.ts：写入/编辑后 read-cache.invalidate

## 验证记录（已实际运行）
- bun run build.mjs -> build done
- gyc --version -> 0.0.1
- gyc --help -> 完整命令列表、无重复、db 占位显示
- 24 个命令 --help 逐个 -> 全部 exit 0
- gyc db path -> 输出数据库路径（按需加载 sqlite）
  - 默认 gyc TUI 启动 -> 5 秒存活无报错
  - read-cache 上限逻辑 -> 205 条目正确收敛到 200

## 乱码修复（TUI 底部不断刷新乱码）

### 现象
- 运行 gyc 时，TUI 底部 spinner（Braille 盲文点阵字符）与中文状态文本不断闪烁乱码

### 根因
- opentui 渲染以 UTF-8 字节流写入 stdout（Bun 实测 ⠋ = E2 A0 8B）
- conhost 默认使用系统 ANSI 代码页 936（GBK），把 UTF-8 字节按 GBK 解码 → 乱码
- Windows Terminal 本身即 UTF-8，无此问题；opentui 自身不做任何编码处理

### 修复
- src/tui/terminal-win32.ts：新增 win32EnableUtf8Console()，调用 kernel32 SetConsoleOutputCP(65001)
- src/gyccode/index.ts：进程入口启动时调用（幂等；仅 win32 + stdout TTY 时生效）
- 退出时不恢复原代码页：恢复会重新引入乱码（同一控制台后续 bun/node/git 均输出 UTF-8）

### 验证
- bun run build.mjs -> build done；dist/chunk-jxsatsra.js 含 SetConsoleOutputCP(65001)
- dist/index.js 确认 ENV 加载后立即调用（minify 为 v0()）
- kernel32 直调验证：SetConsoleOutputCP(65001) 返回 1，GetConsoleOutputCP 生效
- 默认 gyc TUI 启动 -> 6 秒存活、stderr 无输出
- 生效方式：重启 gyc（用户当前实例为旧代码）

## 重启后的步骤
1. 退出当前 gyc，重新运行 gyc（会加载 dist/ 中新构建代码，build 已完成）
2. 复查内存基线（对比上方基线数据）：
   - Get-Process -Name bun | Select Id, CPU, WorkingSet64
   - 空闲 8 秒采样 CPU delta（预期接近 0-3%）
3. 预期：内存应下降（不再常驻 24 个命令模块 + SQLite 缓存上限降 48MB）
4. 观察温度/风扇是否改善

## 可选后续优化（未做）
- 数据库瘦身：152MB（event 26416 行为主），freelist=0 无法 VACUUM，需删除旧数据（有数据丢失风险，需用户同意）
- 更深入常驻模块/V8 heap 构成分析

## 环境注意事项（重要）
- 路径含中文（C:\Users\谷勇成\）时，write 工具创建的新文件可能不落盘到 bash/bun 可见的真实文件系统（read-cache.ts、CC-BENCHMARK 报告均踩过此坑）。创建新文件必须用 bash 工具 + workdir=C:\Users\谷勇成\gyc-cli + 相对路径。
- 所有 bash 命令建议设置 workdir 并用相对路径。
- 构建命令：bun run build.mjs（bin/gyc 优先使用 dist/index.js）
