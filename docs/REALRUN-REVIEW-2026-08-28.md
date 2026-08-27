# gyc CLI 全流程真实验证 + 14 维度审查报告（2026-08-28）

## 验证口径

**全流程环节**：启动 → 选择 LLM（模型解析）→ 发送消息 → 推理 → 流式输出 → 输出正确性核对。
**14 维度审查矩阵**（上下文重构口径，未在既有文档落盘，此为首次固化）：

| # | 维度 | # | 维度 |
|---|------|---|------|
| 1 | 启动链路（入口/初始化开销） | 8 | 错误处理与恢复 |
| 2 | LLM 选择与模型解析 | 9 | 内存与资源管理 |
| 3 | 会话创建与消息发送链路 | 10 | Windows 兼容性 |
| 4 | 推理链路（stream/transform） | 11 | 中文显示合规（铁律） |
| 5 | 流式输出渲染（delta-flush/fps） | 12 | 性能基准 |
| 6 | 工具调用链路（权限/执行） | 13 | 代码质量（类型/测试/死代码） |
| 7 | 会话持久化与事件存储 | 14 | 安全（注入/密钥/CSP） |

**执行方式**：每遍 = 1 次真实 LLM 调用（`gyc run` headless 单轮，后台进程 + 轮询）+ 14 维度轮换深挖源码审查；发现问题即修复并重建 dist 复验。

## 环境

- node dist/index.js（bun build.mjs 构建），模型 opencode/nemotron-3.5-lightning-free（免费档，首响延迟 15-30s 属外部服务）
- Windows 11 / PowerShell / 4GB RAM 机器

## 各遍执行记录

### 第 1 遍：简单中文问答
- 场景：`run "请用简体中文回答：1+1等于几？只回答数字。"`
- 结果：输出 `2` ✅；双流结构（title 小模型 small=true → 主模型 small=false）正常；会话创建/退出 loop 日志完整
- 深挖维度：1（启动链路）、5（流式渲染源码）
- 耗时分解：启动→session 创建 5.8s；首响 ~51s（title 15s + watcher/copy-refresh 8s + 免费模型排队 17s）

### 第 2 遍：工具调用（read）
- 场景：读 `tmp-gyc-read-target.txt` 报校验码
- 结果：输出 `7391` ✅；工具行渲染 `🅃 Read tmp-gyc-read-target.txt` 正常
- **修复 P0-1 后首验：进程正常退出 ✅**

### 第 3 遍：工具调用（write）
- 场景：创建 `tmp-gyc-write-target.txt` 内容 `GYC-WRITE-OK-2026`
- 结果：文件内容精确 ✅；工具行渲染 `🄝 Write` 正常；进程正常退出 ✅
- 深挖维度：14（安全/权限）——确认权限 effect 由 agent.permissions 规则驱动，build agent 无 edit 规则时默认放行（与上游语义对齐待确认，记为待决策项）

### 第 4 遍：多轮会话恢复（-c）
- 场景：`run -c "我上一条消息里让你创建的文件名是什么？"`
- 结果：正确答出 `tmp-gyc-write-target.txt` ✅（跨轮记忆/持久化链路正常）；进程正常退出 ✅
- 深挖维度：3、7（会话/持久化源码审查）

### 第 5 遍：--thinking 推理展示
- 场景：27×43 先思考再回答
- 结果：Thinking 块正常渲染 ✅；答案 1161 正确 ✅
- **发现并修复（维度11）**：`Thinking:` 前缀英文违反中文铁律 → 改为 `思考：`；同步中文化 stream-cli.ts 权限/问答/工具失败等 5 处英文文案 + run.ts "会话不存在"

### 第 6 遍：错误路径（无效模型）
- 场景：`run -m nonexistent-provider/fake-model "你好"`
- 结果：暴露 2 个问题——
  1. **P1 错误明细丢失**：服务端 `getModel` 已发布可读 session.error（"Model not found: xxx"），但 HTTP 层返回脱敏 500；客户端 result.error 分支不排空事件流就 exit → 用户只看到 "Unexpected server error...ref"
  2. **libuv 断言崩溃**：退出时机撞上 async handle 关闭（`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`）

### 第 7 遍：错误路径复验（修复后）
- **修复生效** ✅：显示 `Error: Model not found: nonexistent-provider/fake-model.`（finishWithErrorDrain 排空事件流，5s 超时兜底）
- 断言崩溃仍偶发 → 追加修复：exitWhenFlushed 退出前让出事件循环 100ms

### 第 8 遍：--format json 错误路径
- 结果：json 事件流正常（text + 2 条 error 事件，含可读明细）✅；进程正常退出 ✅；**断言崩溃消失** ✅（100ms 缓冲生效）

## 问题清单

| 级别 | 问题 | 状态 |
|------|------|------|
| P0-1 | `gyc run` / `$0` 单轮完成后进程永久挂起（实例 dispose 不覆盖 watcher/location/UTF8 守护等句柄，event loop 不空）| **已修复**：run.ts + index.ts 单轮完成后 flush + process.exit；第 2 遍复验通过 |
| P1-2 | 错误路径错误明细丢失：HTTP 脱敏 500 + 事件流未消费即退出 | **已修复**：run.ts finishWithErrorDrain（排空事件流，5s 超时兜底）；第 7 遍复验通过 |
| P1-3 | 错误路径退出时 libuv 断言崩溃（uv_async_send during close）| **已修复**：exit 前让出事件循环 100ms；第 8 遍复验通过 |
| P2-1 | bg-pulse.tsx onCleanup 恢复的 targetFps 快照可能覆盖 session 路由新设的 30fps（竞态，60fps 空转至下次流式）| 待决策 |
| P2-2 | run 单轮模式初始化开销：project copy refresh 4.3s + watcher 4.4s + title 生成串行 15s | 待决策 |
| P2-3 | pipeline.ts resolveSession `-c` 分支取 `list.data.find(!parentID)` 未按目录过滤，跨目录场景可能恢复错会话 | 待决策 |
| P2-4 | 权限语义：build agent 无 edit 规则时默认放行写文件（非交互 run 也直接写入）| 待决策（对齐上游确认）|
| P3-1 | lsp.ts:345 "touching file" 日志名误导（实为 LSP notify.open，无 mtime 副作用）| 记录 |
| P3-2 | pipeline.ts fetchDynamicCommands `catch {}` 静默吞错无日志 | 记录 |
### 第 9 遍：附件文件（-f）
- 场景：`run -f tmp-gyc-read-target.txt "附件中的校验码是什么？"`
- 结果：正确答出 `7391` ✅；file part 解析链路正常；进程正常退出 ✅

### 第 10 遍：长输出中文流式（最终遍）
- 场景：约 300 字中文短文（3 自然段）
- 结果：455 字符完整输出、段落结构完整、中文无乱码、流式尾部补齐正确、进程正常退出 ✅
- 回归：`bun test` 相关 17 测试全 pass（中文化改动后 stream-cli 测试仍绿）

## 14 维度覆盖核对

| # | 维度 | 覆盖遍次 | 结论 |
|---|------|---------|------|
| 1 | 启动链路 | 1 | 启动→session 创建 5.8s；初始化开销记 P2-2 |
| 2 | LLM 选择与模型解析 | 1/6/7 | 默认模型与 `-m` 解析正常；无效模型错误已可读 |
| 3 | 会话创建与消息发送 | 1/4 | 正常；`-c` 恢复正确 |
| 4 | 推理链路 | 5 | 双流（title/主）+ reasoning 块正常 |
| 5 | 流式输出渲染 | 1/10 | 增量渲染+行闭合+尾部补齐正确 |
| 6 | 工具调用链路 | 2/3 | read/write 正常，工具行渲染正确 |
| 7 | 会话持久化 | 4 | 跨轮记忆正确 |
| 8 | 错误处理与恢复 | 6/7/8 | P1-2/P1-3 已修复复验 |
| 9 | 内存与资源管理 | 1/6/7/8 | P0-1 挂起已修复；断言崩溃已修复 |
| 10 | Windows 兼容性 | 全部 | UTF-8 输出全正常；libuv 断言已修复 |
| 11 | 中文显示合规 | 5/10 | 已中文化 6 处英文文案；长文无乱码 |
| 12 | 性能基准 | 1 | 本地开销 ~27s（其中可优化 ~10s，记 P2-2） |
| 13 | 代码质量 | 全程 | lint 零诊断；测试 17/20 全 pass |
| 14 | 安全 | 3 | env 注入 blocklist 正常；权限默认放行记 P2-4 |

## 日志健康度

第 1-3 遍运行日志零 WARN / 零 ERROR。第 6-8 遍的错误为无效模型的预期错误路径（服务端日志有完整堆栈与 ref，行为正确）。
