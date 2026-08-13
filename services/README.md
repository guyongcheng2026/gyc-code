# gyc-code 自建后端服务

自建三项服务，用于替代对第三方 SaaS 的依赖（对应 docs/ROADMAP-2026-08-12.md）。

## 技术栈

- Bun + bun:sqlite，**零 npm 依赖**（无需 bun install）
- 数据落盘 SQLite（服务目录下 `*.db`）
- 中文环境 UTF-8

## 一、账号服务（替代控制台 OAuth）

**启动**：

```bash
bun services/account/server.ts        # 默认端口 8787
GYCCODE_ACCOUNT_PORT=8787 bun services/account/server.ts
```

**客户端指向**：

```bash
export GYCCODE_ACCOUNT_URL=http://localhost:8787
gyc account login
```

**API 面**（与 gyccode provider / account 模块对齐）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/device/code` | 设备码申请（RFC 8628） |
| POST | `/auth/device/token` | 设备码轮询 / refresh_token 换发 |
| GET | `/device/confirm?user_code=xxx` | 浏览器确认页（批准/拒绝） |
| GET | `/api/user` | 当前用户（Bearer） |
| GET | `/api/orgs` | 用户组织列表（Bearer） |
| GET | `/api/config` | 组织 provider 配置（Bearer + x-org-id） |
| POST | `/api/register` | 注册（邮箱 + 密码，口令复杂度校验，argon2id 哈希） |
| POST | `/api/login` | 登录（签发 access/refresh token） |
| POST | `/api/logout` | 登出（吊销 access token） |
| GET | `/api/audit` | 审计日志（仅 admin，最近 100 条） |
| GET | `/health` | 健康检查 |

**说明**：
- 种子账号 `admin@gyccode.local` / 组织 `gyc-local`；设备确认后签发 7 天 access token + 30 天 refresh token
- 种子管理员密码：`GYCCODE_ADMIN_PASSWORD` 注入（未设置时本地默认 `admin123` 并告警，生产必须 env 注入）
- 密码存储：`Bun.password` argon2id 哈希（零依赖）；注册口令 ≥8 位且含字母+数字（等保口令复杂度）
- 审计（等保安全审计）：注册/登录/登录失败/登出/设备码签发与确认/refresh 换发均留痕 `audit_logs`；查询接口仅 admin 角色可访问（权限最小化）
- 新注册用户默认加入本地组织（最小授权），角色 `user`
- `/api/config` 默认返回空 provider 配置：模型数据源由客户端 models-dev 提供，模型供应商由用户自行配置；如需统一网关，可按组织返回 provider 映射

## 二、分享服务（替代第三方分享站）

**启动**：

```bash
bun services/share/server.ts          # 默认端口 8788
GYCCODE_SHARE_PORT=8788 bun services/share/server.ts
```

**客户端指向**：

```bash
export GYCCODE_SHARE_URL=http://localhost:8788   # 展示链接 base
```

**API 面**（与 ShareNext 模块对齐）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/share` | 创建分享 `{ sessionID }` → `{ id, url, secret }` |
| POST | `/api/share/{id}/sync` | 同步数据 `{ secret, data }` |
| DELETE | `/api/share/{id}` | 删除分享 `{ secret }` |
| GET | `/api/share/{id}/data` | 读取分享数据 |
| GET | `/s/{id}` | 只读渲染页（HTML） |
| GET | `/health` | 健康检查 |

**说明**：渲染页为纯静态 HTML（无脚本注入），分享数据以 JSON 快照存储，支持撤销（DELETE）。

## 三、额度升级（客户端降级）

客户端 429 提示已改为**默认不跳转第三方**：

- `GYCCODE_UPGRADE_URL` 未配置 → 仅提示"免费额度用尽，请配置付费供应商或等待重置"
- `GYCCODE_UPGRADE_URL` 已配置（如指向自建定价页）→ 显示升级链接

## 环境变量汇总

| 变量 | 服务 | 说明 |
|------|------|------|
| `GYCCODE_ACCOUNT_URL` | 账号 | 账号服务地址（gyccode provider / account login） |
| `GYCCODE_SHARE_URL` | 分享 | 分享展示链接 base |
| `GYCCODE_UPGRADE_URL` | 额度 | 升级页地址（未配置则不跳转） |
| `GYCCODE_UI_UPSTREAM` | Web UI | serve 的内嵌 UI 上游 |
| `GYCCODE_MODELS_URL` | 模型 | 模型目录数据源 |
| `GYCCODE_DISABLE_SHARE` | 分享 | `true` 时禁用分享功能 |

## 四、模型目录镜像（自建数据源）

模型目录（models.opencode.ai/api.json，公共中立模型清单）可用自建镜像替代，实现数据源 100% 自主：

```bash
# 1. 同步最新模型清单到 models-mirror/api.json（184 供应商 / 6000+ 模型）
bun scripts/sync-models.mjs

# 2. 与插件市场同站托管（serve-marketplace 已支持 /models 路径）
bun scripts/serve-marketplace.mjs
# → http://localhost:8790/models/api.json

# 3. 客户端指向镜像（models-dev 读取 ${GYCCODE_MODELS_URL}/api.json）
export GYCCODE_MODELS_URL=http://localhost:8790/models
```

`models-mirror/` 不入库（6MB 且随上游更新），每次部署前执行同步脚本即可。

## 部署提示（公网）

- 生产部署需 TLS 终止（反向代理）与鉴权加固（等保三级基线）
- SQLite 单机部署；多实例需替换为共享存储（超出当前范围，见 ROADMAP 边界声明）
