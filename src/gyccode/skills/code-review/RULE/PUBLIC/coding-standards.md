# 代码审查硬性规范 (RULE/PUBLIC)

> **强制执行**：违反即阻断合并，无例外。所有规则均可自动化检测。

---

## TypeScript/JavaScript 强制规则

### TS-001: 禁用 `any` 类型
```ts
// ❌ 禁止
function process(data: any) { }

// ✅ 正确
function process(data: unknown) { }
function process<T>(data: T) { }
interface UserData { name: string; age: number }
function process(data: UserData) { }
```
**检测**: `@typescript-eslint/no-explicit-any: error`

### TS-002: 优先 `const`，禁用 `var`
```ts
// ❌ 禁止
var x = 1
let y = 2 // 仅当重新赋值必要时

// ✅ 正确
const x = 1
const y = compute()
```
**检测**: `prefer-const: error`, `no-var: error`

### TS-003: 避免 `else` 分支
```ts
// ❌ 禁止
if (cond) { return a } else { return b }

// ✅ 正确 (卫语句)
if (cond) return a
return b
```
**检测**: 自定义规则 `no-else-after-return: error`

### TS-004: 避免 `try-catch` 滥用
```ts
// ❌ 禁止 (控制流)
try { return parse(json) } catch { return defaultValue }

// ✅ 正确 (Result 模式)
const result = parseSafe(json)
if (result.ok) return result.value
return defaultValue
```
**检测**: 仅允许在 I/O 边界、外部调用、资源释放处使用

### TS-005: 统一响应格式
```ts
// ✅ 后端 API 必须返回
interface ApiResponse<T> {
  code: number        // 200 成功，非 200 失败
  msg: string         // 用户可读消息
  data: T | null      // 业务数据
  traceId?: string    // 可观测追踪
}
```
**检测**: OpenAPI Schema 校验 + 单测断言

### TS-006: 前端 API 前缀统一
```ts
// ❌ 禁止
axios.get('/api/api/users')  // 双重 /api
axios.get('/users')          // 缺少前缀

// ✅ 正确
axios.get('/api/users')
```
**检测**: Axios 拦截器自动注入 `/api`，禁止手写

### TS-007: 本地开发仅 SQLite
```ts
// ❌ 禁止在代码中引入
import mysql from 'mysql2'
import pg from 'pg'

// ✅ 仅允许
import Database from 'better-sqlite3'
```
**检测**: `no-restricted-imports: ['mysql2', 'pg', 'sequelize', 'typeorm']`

---

## Python 强制规则

### PY-001: 类型注解强制
```python
# ❌ 禁止
def get_user(id):
    return db.query(User).get(id)

# ✅ 正确
def get_user(id: int) -> User | None:
    return db.query(User).get(id)
```
**检测**: `mypy --strict`, `ruff --select=ANN`

### PY-002: 配置从 sys_config 读取
```python
# ❌ 禁止硬编码
JWT_SECRET = "hardcoded-secret"
DB_POOL_SIZE = 10

# ✅ 正确
from config import get_config
config = get_config()
JWT_SECRET = config.jwt_secret
DB_POOL_SIZE = config.db_pool_size
```
**检测**: 自定义规则 `no-hardcoded-config: error`

### PY-003: SQL 参数化
```python
# ❌ 禁止
sql = f"SELECT * FROM users WHERE name = '{name}'"
cursor.execute(sql)

# ✅ 正确
sql = "SELECT * FROM users WHERE name = %s"
cursor.execute(sql, (name,))
# 或 ORM
User.query.filter_by(name=name).first()
```
**检测**: `flake8-sql-injection`, `bandit`

---

## 架构强制规则

### ARCH-001: 分层调用单向
```
Controller → Service → Repository → Database
     ↑                                           │
     └──────────── 禁止反向/跨层 ────────────────┘
```
**检测**: ArchUnit / 自定义 AST 分析

### ARCH-002: 接口隔离
```ts
// ❌ 禁止：胖接口
interface UserService {
  createUser()
  deleteUser()
  sendEmail()
  generateReport()
  syncToERP()
}

// ✅ 正确：细分接口
interface UserRepository { save(user) }
interface UserNotifier { notify(user, event) }
interface ReportGenerator { generate(params) }
interface ErpSyncService { sync(entity) }
```

### ARCH-003: 依赖倒置
```ts
// ❌ 禁止：高层依赖低层实现
class OrderService {
  private repo = new SqlOrderRepository() // 硬编码实现
}

// ✅ 正确：依赖抽象
class OrderService {
  constructor(private repo: OrderRepository) {} // 注入接口
}
```

---

## 安全强制规则

### SEC-001: 无明文密钥
```ts
// ❌ 禁止
const API_KEY = "sk-1234567890"
process.env.DB_PASSWORD = "password123"

// ✅ 正确
const API_KEY = process.env.API_KEY! // 运行时注入
// 或密钥管理服务
const secret = await vault.getSecret('api-key')
```
**检测**: `detect-secrets`, `truffleHog`, `git-secrets` 预提交钩子

### SEC-002: 输入白名单校验
```ts
// ❌ 禁止：黑名单/正则绕过
if (!input.includes('<script>')) return sanitize(input)

// ✅ 正确：白名单
const ALLOWED_CHARS = /^[a-zA-Z0-9_\-\.@]+$/
if (!ALLOWED_CHARS.test(input)) throw new ValidationError()
```

### SEC-003: 权限最小化
```ts
// ❌ 禁止：Admin 权限做普通查询
@RequireRole('ADMIN')
getUserList()

// ✅ 正确：最小权限
@RequirePermission('user:read')
getUserList()
```

---

## 等保三级合规清单 (自动化核查)

| 要求 | 检测方式 | 通过标准 |
|------|----------|----------|
| 身份鉴别：多因子、密码策略、会话超时 | 单测 + 配置扫描 | 全通过 |
| 访问控制：RBAC/ABAC、最小权限、数据范围 | 策略引擎测试 | 覆盖率 100% |
| 安全审计：关键操作留痕、不可篡改、定期分析 | 审计日志 Schema 校验 | 字段完整、链式哈希 |
| 入侵防范：WAF、异常检测、漏洞扫描 | CI 集成 SAST/DAST | 0 高危 |
| 数据完整性：校验和、备份校验、防篡改 | 备份恢复演练 | RPO=0, RTO<4h |
| 数据保密性：传输加密、存储加密、密钥轮换 | TLS 1.3 + AES-256-GCM | 全链路加密 |
| 备份恢复：定期备份、异地、演练记录 | 自动化备份 + 月度演练 | 有记录、可恢复 |

---

## 违规处理流程

1. **CI 阻断**: 预提交/流水线自动检测，失败即阻断
2. **自动修复**: 可自动修复的 (格式、导入排序) 由工具修复
3. **人工复核**: P0/P1 必须资深工程师 + 安全审核双人签名
4. **例外申请**: 仅允许有业务正当理由、风险可控、有补偿措施、限时整改