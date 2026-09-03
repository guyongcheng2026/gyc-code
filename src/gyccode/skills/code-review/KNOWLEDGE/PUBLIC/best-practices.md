# 代码审查最佳实践 (PUBLIC)

## 通用审查原则

### 1. 先理解再评判
- 先读懂业务意图、上下文、调用链路
- 不要对着单个文件孤立审查，关注模块边界

### 2. 分级输出，避免信息淹没
- P0/P1 必须有**代码定位**、**风险说明**、**修复示例**、**规则引用**
- P2/P3 可批量汇总，给出重构方向

### 3. 引用权威来源
- AGENTS.md / SOUL.md (项目铁律)
- OWASP Top 10 / CWE (安全)
- Clean Code / Refactoring (质量)
- 语言官方指南 (TypeScript/Go/Python/Rust)

---

## 常见模式速查

### 安全反模式 → 修复模式
| 反模式 | 风险 | 修复 |
|--------|------|------|
| `sql = "SELECT * FROM t WHERE x = '" + input + "'"` | SQL注入 | 参数化查询 / ORM |
| `eval(userInput)` / `new Function(input)` | RCE | 白名单解析器 / 沙箱 |
| `fs.readFile(userPath)` | 路径遍历 | `path.resolve(base, userPath)` + 校验在 base 内 |
| `console.log(password)` | 敏感信息泄露 | 结构化日志脱敏 |
| `crypto.createHash('md5')` | 弱哈希 | `bcrypt` / `argon2` / `scrypt` |

### 性能反模式 → 优化模式
| 反模式 | 优化 |
|--------|------|
| 循环中 `await db.query()` | 批量 `IN` / 事务 / `Promise.all` |
| `SELECT *` 大表全量 | 列裁剪 + 索引覆盖 + 游标分页 |
| 无缓存重复计算 | Redis/LRU + Key 设计 + TTL |
| 同步阻塞 CPU 密集任务 | Worker Threads / 子进程 / 队列异步化 |

### 代码异味 → 重构手法
| 异味 | 重构 |
|------|------|
| 长函数 (>30行) | Extract Method |
| 大类 (>300行) | Extract Class |
| 重复代码 | Extract Superclass / Strategy Pattern |
| 过多参数 (>4个) | Parameter Object / Builder |
| Switch/If-else 链 | Polymorphism / Strategy / Map-based |

---

## 审查工具链推荐

| 语言 | Linter | Formatter | SAST | 依赖扫描 |
|------|--------|-----------|------|----------|
| TypeScript | ESLint + @typescript-eslint | Prettier | CodeQL / SonarQube | npm audit / Snyk |
| Python | Ruff / Flake8 | Black / Ruff | Bandit / Semgrep | pip-audit / Safety |
| Go | golangci-lint | gofmt | govulncheck | govulncheck |
| Rust | Clippy | rustfmt | cargo-audit | cargo-audit |

---

## 审查会话模板

```markdown
## 审查会话记录

**PR/Commit**: #1234 / abc1234
**作者**: @dev-name
**审查者**: @reviewer-name + gyc-code-review
**日期**: 2026-09-02

### 变更摘要
- 新增用户导入功能 (Excel/CSV)
- 重构认证中间件支持多租户
- 修复订单并发扣库存 Bug

### 审查结论
✅ 通过 (P0=0, P1=0, P2=2, P3=1)
⚠️ 需修复后合并
❌ 拒绝，重大问题

### 后续行动
- [ ] 作者修复 P2 问题
- [ ] 补充单测覆盖率到 85%
- [ ] 更新 API 文档
```