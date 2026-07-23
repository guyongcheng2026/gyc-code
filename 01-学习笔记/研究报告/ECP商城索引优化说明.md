# ECP与国网商城索引优化与性能设计说明

> 基于《ECP商城数据架构设计-SQL》的表结构，给出索引策略、分区建议、读写分离与高频查询优化方案。
> 元信息：2026-07-20

---

## 一、现有索引盘点（已建）

SQL脚本中已为高频查询字段建立索引：

| 表 | 已建索引 | 用途 |
|----|---------|------|
| t_ecp_project | project_no(唯一), purchase_type, status, org_id | 按方式/状态/单位查项目 |
| t_ecp_bid | (project_id,package_id)组合, supplier_id, is_winner | 查某包投标/中标 |
| t_ecp_contract | contract_no(唯一), supplier_id, status, framework_flag | 合同查询 |
| t_ecp_award | (project_id,package_id)组合, supplier_id | 定标查询 |
| t_ecp_notice | project_id, notice_type, publish_date | 公告查询 |
| t_mall_order | order_no(唯一), user_id, order_status, shop_id | 订单查询 |
| t_mall_sku | sku_code(唯一), spu_id | 商品查询 |
| t_mall_product | category_id, status, shop_id | 商品列表 |
| t_mall_shipment | shipment_no(唯一), order_id, tracking_no | 物流查询 |

---

## 二、建议补充索引（高频查询场景）

### 2.1 ECP交易域补充索引

```sql
-- 1. 按采购单位+状态查申请（采购专责工作台）
ALTER TABLE t_ecp_purchase_req ADD INDEX idx_org_status (apply_org_id, status);

-- 2. 按项目查投标（开标后评标视图）
ALTER TABLE t_ecp_bid ADD INDEX idx_proj_winner (project_id, is_winner);

-- 3. 按供应商查历史投标（供应商画像）
ALTER TABLE t_ecp_bid ADD INDEX idx_sup_time (supplier_id, bid_date);

-- 4. 按合同查履约（合同执行跟踪）
ALTER TABLE t_ecp_contract_exec ADD INDEX idx_contract_node (contract_id, node_type);

-- 5. 按评价周期查绩效（季度评价）
ALTER TABLE t_ecp_supplier_eval ADD INDEX idx_period (eval_period);

-- 6. 澄清按状态查待答复（采购方待办）
ALTER TABLE t_ecp_clarification ADD INDEX idx_status_time (status, ask_time);
```

### 2.2 商城电商域补充索引

```sql
-- 1. 商品按类目+状态查（商品列表分页）
ALTER TABLE t_mall_product ADD INDEX idx_cat_status (category_id, status);

-- 2. 商品按店铺+状态查（商家后台）
ALTER TABLE t_mall_product ADD INDEX idx_shop_status (shop_id, status);

-- 3. 订单按用户+状态查（我的订单）
ALTER TABLE t_mall_order ADD INDEX idx_user_status (user_id, order_status);

-- 4. 订单按时间查（运营报表）
ALTER TABLE t_mall_order ADD INDEX idx_created (created_at);

-- 5. SKU按价格查（价格排序）
ALTER TABLE t_mall_sku ADD INDEX idx_price (price);

-- 6. 评价按商品查（商品详情页）
ALTER TABLE t_mall_review ADD INDEX idx_prod_star (product_id, star_level);

-- 7. 搜索日志按关键词查（热词统计）
ALTER TABLE t_mall_search_log ADD INDEX idx_keyword (keyword);
```

---

## 三、分区策略

### 3.1 大表分区建议

| 表 | 数据量预估 | 分区策略 |
|----|-----------|---------|
| t_ecp_bid | 年千万级 | 按 `bid_date` RANGE 月度分区 |
| t_ecp_evaluation | 年千万级 | 按 `submit_time` 月度分区 |
| t_ecp_notice | 年百万级 | 按 `publish_date` 月度分区 |
| t_mall_order | 年千万级 | 按 `created_at` 月度分区 |
| t_mall_order_item | 年亿级 | 按 `created_at` 月度分区（与order对齐） |
| t_mall_shipment_track | 年十亿级 | 按 `track_time` 月度分区 + 归档至ClickHouse |
| t_mall_search_log | 年亿级 | 按 `search_time` 月度分区 |

### 3.2 分区示例（t_mall_order）

```sql
ALTER TABLE t_mall_order PARTITION BY RANGE (TO_DAYS(created_at)) (
  PARTITION p202601 VALUES LESS THAN (TO_DAYS('2026-02-01')),
  PARTITION p202602 VALUES LESS THAN (TO_DAYS('2026-03-01')),
  PARTITION p202603 VALUES LESS THAN (TO_DAYS('2026-04-01')),
  PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

> 注：分区键必须包含在主键/唯一索引中。若 `order_no` 为唯一键且非分区键，需改为 `(order_no, created_at)` 组合唯一或去除唯一约束改用业务层保障。

---

## 四、读写分离与分库

### 4.1 读写分离架构

```
                     ┌─────────────┐
  应用写请求 ──────→ │  主库(Master) │ ←── 强一致写
                     └──────┬──────┘
                            │  binlog同步
              ┌─────────────┼─────────────┐
              ↓             ↓             ↓
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ 从库1    │  │ 从库2    │  │ 从库3    │  ← 读请求负载均衡
        │ (报表)   │  │ (查询)   │  │ (搜索)   │
        └──────────┘  └──────────┘  └──────────┘
```

**适用场景**：
- 主库：写操作（下单、评标提交、合同签署）
- 从库1：报表统计（采购驾驶舱、供应商分析）
- 从库2：前台查询（商品搜索、订单列表）
- 从库3：后台管理（供应商审核、合同管理）

### 4.2 分库分表建议

| 维度 | 策略 |
|------|------|
| 按组织分库 | `apply_org_id` / `org_id` 哈希分8库（省公司级） |
| 按时间分表 | 订单/投标/评标按年/月分表 |
| 按SKU分表 | 商品SKU按 `category_id` 分16表 |
| 热点分离 | 购物车/收藏等高频小表独立库 |

---

## 五、高频查询SQL示例（验证索引有效性）

```sql
-- Q1: 查询某供应商在某项目中的所有投标（走 idx_proj_pkg + supplier_id）
SELECT b.* FROM t_ecp_bid b
WHERE b.project_id = 'xxx' AND b.supplier_id = 'yyy'
ORDER BY b.bid_date DESC;

-- Q2: 查询某采购单位的待办澄清（走 idx_status_time）
SELECT * FROM t_ecp_clarification
WHERE status = 'PENDING' AND ask_time > DATE_SUB(NOW(), INTERVAL 7 DAY);

-- Q3: 查询某用户近30天订单（走 idx_user_status + idx_created）
SELECT * FROM t_mall_order
WHERE user_id = 'uuu' AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
ORDER BY created_at DESC;

-- Q4: 查询某商品类目下已上架商品（走 idx_cat_status）
SELECT spu_code, product_name, shop_id FROM t_mall_product
WHERE category_id = 'ccc' AND status = '已上架'
LIMIT 20 OFFSET 0;

-- Q5: 查询框架协议下的执行订单（走 idx_contract）
SELECT * FROM t_ecp_mall_order
WHERE contract_id = 'kkk' AND order_status != '已取消';
```

---

## 六、慢查询监控建议

| 措施 | 说明 |
|------|------|
| 开启慢查询日志 | `slow_query_log=1`, `long_query_time=1` |
| 定期EXPLAIN | 对TOP 20慢SQL做执行计划分析 |
| 索引使用率监控 | `sys.schema_unused_indexes` 清理无用索引 |
| 表空间监控 | 大表月度分区自动创建脚本 |

---

> 📋 本说明与ER图、数据字典、SQL脚本构成完整的ECP与国网商城数据架构交付体系。
