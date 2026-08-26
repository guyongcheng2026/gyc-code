# opentui 全面替换：立项条件、风险评估与回滚保障

日期：2026-08-26 · 前置文档：《2026-08-26-tui-fallback-poc-report.md》（P3 决策门）

## 一、现行决策回顾

维持「全面替换暂不立项」：零迁移风险保全 SolidJS 组件树（77 文件）、tree-sitter 高亮与布局引擎；资源聚焦稳定性主线；差分帧内核（全量帧 0.090ms/2223B）作为随时可启动的技术后手。安全模式已接入主链路（创建失败 + 运行中崩溃双通道，commit fd7d81b/b75a5c3）。

## 二、立项触发条件（满足任一即启动立项评审）

**硬触发（客观事实驱动）**
| 编号 | 条件 | 监测来源 |
|------|------|----------|
| T1 | opentui 上游停更 >6 个月，或 npm 撤包导致 0.5.x 无法安装 | npm registry / GitHub 活跃度 |
| T2 | 阻塞级缺陷（原生崩溃/乱码类）连续两个小版本无法修复，补丁链失效 | gyccode.log 崩溃归因 |
| T3 | 安全模式降级月均触发 ≥3 次（opentui 稳定性不可接受的量化线） | stability-log renderer 字段 |
| T4 | 内存治理完成后 RSS 常驻仍 >物理内存 35%，且 heap snapshot 归因于 arena/FFI 泄漏 | memory-sample 心跳 + 快照分析 |

**软触发（战略判断驱动）**
| 编号 | 条件 |
|------|------|
| T5 | 出现 opentui 架构性不支持的关键特性需求（自定义合成、非矩形渲染等） |
| T6 | 「依赖零专有」品牌愿景升级为硬性合规要求 |

## 三、立项前置条件（全部满足方允许开工）

- [x] **P1 引擎验收扩容**（2026-08-26 落地）：快照矩阵已扩展到富文本层——`src/tui/fallback/rich-text.ts` 提供 tree-sitter scope→CellStyle 解析（镜像 theme/index.ts getSyntaxRules 优先级），`CellStyle` 扩展 italic/underline/strikethrough 对齐 opentui StyleDefinition 全字段；`rich-text.test.ts` 8 用例覆盖 SGR 最小化、token 边界、中文/emoji 富文本不撕裂、diff 样式变更
- [x] **P2 RendererBackend 抽象层设计冻结**（2026-08-26 落地）：接口契约见 `src/tui/fallback/renderer-backend.ts` + 设计冻结文档《2026-08-26-renderer-backend-design-freeze.md》；双实现（OpentuiRendererBackend/FallbackRendererBackend）可编译切换，`renderer-backend.test.ts` 5 用例含同构断言
- [x] P3 回滚锚点完备（见第五节，已于 2026-08-26 落地）
- [ ] P4 排期承诺：≥3 周专职迭代窗口，期间冻结其他 TUI 功能开发（待立项评审确认）
- [ ] P5 验收基准量化：帧耗时 ≤opentui 的 2 倍；增量帧字节量同量级；乱码矩阵零失败；周崩溃率不高于现状（乱码矩阵 ✅ 40+ 用例；fallback 基线 ✅ 0.150ms/2223B；opentui 端对比基线待 S0 采集）

## 四、分阶段执行与回滚点（若立项）

| 阶段 | 内容 | 工期 | 回滚点 |
|------|------|------|--------|
| S0 抽象层 | RendererBackend 接口 + opentui 适配实现 | 第 1 周 | R1：合并但不切默认，产线形态不变 |
| S1 组件桥接 | Solid reconciler 替代 + ScrollBox/Textarea/Input 三大件 | 第 2-3 周 | R2：双渲染器并存，默认仍 opentui |
| S2 灰度切换 | 默认 fallback，opentui 转后备依赖 | 第 4 周 | R3：GYC_TUI_BACKEND 一键切回 |
| S3 清理收尾 | 移除 opentui 依赖与三个补丁脚本 | 第 5 周 | R4：git revert 单独提交的 S3 |

全程原则：每阶段独立可回滚；任一阶段失败退回上一回滚点即恢复产线形态。

## 五、风险保障措施（贯穿全程）

- G1 数据零风险：会话数据 SQLite 层与渲染器完全解耦，替换不触数据
- G2 行为守门：乱码快照矩阵（40+ 用例）设为 CI 关卡，任一失败禁止合入
- G3 性能守门：tui-fallback-bench 进 CI，帧耗时回归 >20% 即阻断
- G4 用户级保险丝：S3 完成前始终保留 GYC_TUI_BACKEND 切换能力
- G5 可观测：stability-log 增加 renderer 归因字段，降级/崩溃事件可追溯

## 六、回滚锚点（2026-08-26 已落地）

| 锚点 | 内容 | 位置 |
|------|------|------|
| A1 git 基线 tag | `pre-full-replacement-baseline` 指向 1c5533f（含安全模式 v2 + P1×4 全部成果） | 本地 + GitHub 远端 |
| A2 opentui 0.5.6 包归档 | @opentui/core、core-win32-x64、keymap、solid 四包完整快照（防上游撤包） | ~/.gyc/backups/opentui-0.5.6.zip |
| A3 可运行旧形态产物 | dist/index.js（Node 目标，含打包后 opentui JS 侧）+ bin/gyc | 同上归档 zip |
| A4 补丁脚本链 | apply-opentui-{patch,ffi-patch,orphan-patch}.cjs 已入库随 A1 tag 固化 | 仓库内 |

## 七、结论

现行「暂不立项」继续有效。立项门槛已量化为 T1–T6 六项可观测条件；一旦触发，按第三节五项前置核验、第四节四级回滚推进；A1–A4 备份锚点已落地，执行失败可在分钟级恢复至当前形态。

**前置条件进展（2026-08-26 资格预审）**：P1（富文本快照矩阵）与 P2（RendererBackend 抽象层冻结）已补齐落地，P3 锚点此前已完备；剩余 P4（排期承诺）与 P5（opentui 端对比基线）为立项评审会事项。前置硬缺口已消除，触发条件一旦满足即可进入 S0。
