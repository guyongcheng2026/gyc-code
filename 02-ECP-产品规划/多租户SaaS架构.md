# ECP多租户SaaS架构

> 电子商城多租户（采购方组织）隔离架构设计笔记

## 一、多租户需求

ECP天然是多租户场景：国网多个省公司、地市公司、直属单位在同一平台采购。

| 租户类型 | 实例 | 隔离需求 |
|---------|------|---------|
| 省公司 | 冀北/江苏/浙江等 | 数据严格隔离 |
| 地市公司 | 唐山/保定/苏州等（隶属省公司） | 省公司范围内数据可见 |
| 直属单位 | 国网电科院/联研院等 | 独立数据空间 |
| 供应商 | 所有注册供应商 | 只能看自己数据 |

## 二、隔离策略

推荐**混合模式**：

| 维度 | 策略 | 说明 |
|------|------|------|
| 数据库 | 共享库，行级隔离（tenant_id） | 降低运维复杂度 |
| 缓存 | 共享Redis，Key前缀隔离 | 成本最优 |
| 文件存储 | 租户独立目录 | 便于合规审计 |
| 搜索引擎 | 索引按租户拆分 | 数据安全 |
| 配置 | 每个租户可定制流程/审批规则 | 灵活配置 |

## 三、租户数据模型

```sql
-- 租户表
CREATE TABLE tenant (
    tenant_id        VARCHAR(32) PK,
    tenant_name      VARCHAR(200),    -- 省公司/地市公司名称
    tenant_type      ENUM('province', 'city', 'direct'),
    parent_tenant_id VARCHAR(32),     -- 上级租户（省公司→地市公司）
    status           ENUM('active', 'frozen', 'disabled'),
    config_json      TEXT,            -- 租户配置（审批流程/权限模板等）
    created_at       TIMESTAMP
);

-- 所有业务表带 tenant_id
CREATE TABLE purchase_order (
    order_id    VARCHAR(32) PK,
    tenant_id   VARCHAR(32) FK → tenant,
    ...
    INDEX(tenant_id, status)
);
```

## 四、租户管理功能

| 功能 | 说明 |
|------|------|
| 租户创建/注销 | 新省公司/供应商接入流程 |
| 租户配置 | 审批流程、权限模板、报表定制 |
| 数据迁移 | 租户数据导出/备份 |
| 资源隔离 | 存储/带宽按租户分配 |
| 交叉授权 | 省公司之间委托采购 |

## 五、关键技术设计

### 5.1 租户上下文传递

```
请求 → 解析租户ID（域名/Header/Token）
    ↓
设置ThreadLocal TenantContext
    ↓
DAO层自动添加tenant_id过滤
    ↓
返回租户隔离的数据
```

### 5.2 安全设计

| 风险 | 防护 |
|------|------|
| 跨租户数据越权 | 所有SQL强制tenant_id过滤（ORM级） |
| 租户间流量攻击 | API限流+IP白名单 |
| 数据误删除 | 租户级回收站（保留30天） |
| 合规审计 | 按租户独立审计日志 |
