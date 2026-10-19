# 插件市场盘点报告（B5 brainstorm 供料，2026-10-18 实测）

**目的：** 为 P2 增强项 B5「插件生态扩展」提供现状基准与对标差异，供 brainstorm 立项决策。

## 一、现状（全部实测）

### 内容源（marketplace/，本地生成物，.gitignore 未排除已提交部分）
- `marketplace/index.json`：2 个 PluginEntry（gyc-hello 1.0.0、gyc-workspace-stats 1.0.0）。
- `marketplace/pkg/`：2 个 tgz（npm pack 产物）；`marketplace/plugins/<name>/`：两插件源码（package.json + src/index.mjs）。
- 构建/托管：`scripts/build-marketplace.mjs`（npm pack + 写索引）、`scripts/serve-marketplace.mjs`（本地 :8790）；CI 发布 GitHub Pages。

### 客户端链路（src/gyccode/plugin/）
- registry 实际值：`https://guyongcheng2026.github.io/gyc-code/index.json`（`marketplace.ts:25`，`GYCCODE_PLUGIN_REGISTRY` 可覆盖；`plugins.gyc-code.dev` 仅 README 规划未落地）。
- 拉取：`marketplace.ts:53 fetchIndex` → 搜索/安装：`install.ts`（418 行，下载 tgz 到 `.gyc/plugins/cache`）。
- 模块规模：marketplace.ts 101、meta.ts 162、shared.ts 277、index.ts 291、install.ts 418、loader.ts 214 行；另有 vendor 集成模块（digitalocean/snowflake/xai/cloudflare/azure/pty-environment + openai/、github-copilot/ 子目录）。
- CLI 入口：`plug` 命令组（`command-registry.ts:26,59` → `@gyccode/cli/cmd/plug`）。

### 已知设计债（TODO-DESIGN D2 在案）
- `PluginMeta` 类名与 `plugin/meta.ts` namespace 重名。
- tgz 下载安装与既有 npm 安装（`shared.ts` resolvePluginTarget→Npm.add）双轨并存。

## 二、与 OpenCode 插件机制的对照（基于源码结构，标注推断）

| 维度 | gyc-code 现状 | OpenCode 机制 | 差距定性 |
|---|---|---|---|
| 分发 | 自建 GitHub Pages 索引 + tgz（已通） | npm 包 + 本地目录双轨 [推断：公开生态靠 npm] | 通道已有，生态量为零 |
| 索引规模 | 2 个插件 | 社区索引 [未核实具体规模] | 冷启动阶段 |
| 安装来源 | tgz 单轨 + npm 双轨并存（D2 未收敛） | 双轨收敛 | 结构性债 |
| 插件能力面 | 注入工具（hello）与统计命令（workspace-stats）样例 | 工具/命令/事件钩子 [推断] | 待按样例核验钩子面 |
| 命名冲突 | PluginMeta 重名（D2） | 无此类债 | 单点修复即可 |

## 三、brainstorm 前建议的决策点（供谷总）

1. **双轨收敛**（D2）：tgz 与 npm 二选一为唯一通道，另一个降级为兼容读取——建议 npm 为主（复用 Npm.add 与版本管理），tgz 仅作离线包。
2. **生态冷启动**：先补 3~5 个「有用且小」的官方插件（如 git 状态面板、cost-ledger 查询、会话导出），再谈第三方入驻。
3. **能力面扩权**：插件当前能否注册权限规则/MCP/agent——需读 loader.ts:214 确认后再定钩子设计（未核实项）。
4. **CNAME**：`plugins.gyc-code.dev` 是否启用（DNS+Pages 配置，非代码工作）。

## 复核命令

```powershell
Get-Content marketplace/index.json ; rg -n "fetchIndex|registry" src/gyccode/plugin/marketplace.ts
```