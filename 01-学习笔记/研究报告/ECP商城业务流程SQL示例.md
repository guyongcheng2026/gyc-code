# ECP与国网商城关键业务流程SQL示例

> 基于《ECP商城数据架构设计-SQL》的38张表，给出典型业务场景的可执行SQL。
> 元信息：2026-07-20

---

## 一、ECP交易域典型查询

### 1.1 采购项目全流程跟踪

```sql
-- 查询某采购项目从方案到定标的完整链路
SELECT
  p.project_no, p.project_name, p.purchase_type, p.status AS proj_status,
  pl.plan_no, pl.estimate_amount AS plan_amount,
  n.title AS notice_title, n.publish_date, n.end_bid_date,
  COUNT(DISTINCT b.id) AS bid_count,
  COUNT(DISTINCT b.supplier_id) AS bidder_count,
  MAX(b.bid_amount) AS highest_bid, MIN(b.bid_amount) AS lowest_bid,
  a.award_amount, a.rank_no, s.name AS winner_name, a.status AS award_status
FROM t_ecp_project p
LEFT JOIN t_ecp_purchase_plan pl ON p.plan_id = pl.id
LEFT JOIN t_ecp_notice n ON p.id = n.project_id AND n.notice_type = '中标公告'
LEFT JOIN t_ecp_bid b ON p.id = b.project_id
LEFT JOIN t_ecp_award a ON p.id = a.project_id
LEFT JOIN t_mdm_supplier s ON a.supplier_id = s.id
WHERE p.project_no = 'SG-2026-001'
GROUP BY p.id, pl.id, n.id, a.id, s.id;
```

### 1.2 某供应商所有中标合同

```sql
-- 查询某供应商历史中标合同及执行情况
SELECT
  c.contract_no, c.contract_name, c.total_amount, c.sign_date,
  c.framework_flag, c.status AS contract_status,
  COUNT(e.id) AS exec_nodes,
  SUM(CASE WHEN e.actual_date IS NOT NULL THEN 1 ELSE 0 END) AS completed_nodes,
  AVG(e.progress) AS avg_progress
FROM t_ecp_contract c
LEFT JOIN t_ecp_contract_exec e ON c.id = e.contract_id
WHERE c.supplier_id = '供应商UUID'
  AND c.status IN ('已签署','执行中')
GROUP BY c.id
ORDER BY c.sign_date DESC;
```

### 1.3 评标打分明细（某包）

```sql
-- 查询某分包各专家打分及最终排名
SELECT
  b.supplier_id, s.name AS supplier_name, b.bid_amount,
  ev.expert_id, ex.name AS expert_name, ev.tech_score, ev.biz_score,
  ev.price_score, ev.total_score, ev.comment,
  b.rank_no, b.is_winner
FROM t_ecp_bid b
JOIN t_ecp_evaluation ev ON b.id = ev.bid_id
JOIN t_mdm_supplier s ON b.supplier_id = s.id
JOIN t_mdm_person ex ON ev.expert_id = ex.id
WHERE b.package_id = '分包UUID'
ORDER BY ev.total_score DESC;
```

### 1.4 供应商绩效趋势

```sql
-- 查询某供应商近4个季度绩效评分趋势
SELECT
  eval_period, delivery_score, quality_score, service_score,
  price_score, hse_score, total_score, grade
FROM t_ecp_supplier_eval
WHERE supplier_id = '供应商UUID'
ORDER BY eval_period DESC
LIMIT 4;
```

### 1.5 框架协议下的商城执行订单

```sql
-- 查询某框架协议已下发的商城订单及审批状态
SELECT
  mo.order_no, mo.total_amount, mo.approve_status, mo.order_status,
  o.user_id, o.org_id, o.created_at
FROM t_ecp_mall_order mo
JOIN t_mall_order o ON mo.order_no = o.order_no
WHERE mo.contract_id = '框架合同UUID'
  AND mo.order_status != '已取消'
ORDER BY mo.created_at DESC;
```

---

## 二、国网商城电商域典型查询

### 2.1 商品搜索（类目+关键词+价格区间）

```sql
-- 商城商品列表查询（类目过滤+价格排序+分页）
SELECT
  p.spu_code, p.product_name, p.brand, p.model,
  sk.sku_code, sk.price, sk.stock_qty, p.main_image,
  sh.shop_name, sh.service_score
FROM t_mall_product p
JOIN t_mall_sku sk ON p.id = sk.spu_id
JOIN t_mall_shop sh ON p.shop_id = sh.id
WHERE p.category_id = '类目UUID'
  AND p.status = '已上架'
  AND p.product_name LIKE '%变压器%'
  AND sk.price BETWEEN 100000 AND 500000
ORDER BY sk.price ASC
LIMIT 20 OFFSET 0;
```

### 2.2 购物车结算生成订单

```sql
-- 步骤1: 从购物车生成订单（伪代码→实际业务层逻辑）
-- 先插入订单
INSERT INTO t_mall_order (id, order_no, user_id, org_id, shop_id, total_amount, pay_amount, currency, receiver_name, receiver_phone, receiver_addr, order_status, pay_status, source, created_at, updated_at)
VALUES (UUID(), 'M20260720xxxx', '用户UUID', '单位UUID', '店铺UUID', 850000.00, 850000.00, 'CNY', '张三', '138xxxx', '北京市XX区', '待付款', 'UNPAID', '商城', NOW(), NOW());

-- 步骤2: 从购物车项生成订单明细
INSERT INTO t_mall_order_item (id, order_id, sku_id, spu_id, product_name, spec_json, unit_price, quantity, item_amount, created_at, updated_at)
SELECT UUID(), '订单UUID', c.sku_id, sk.spu_id, p.product_name, sk.spec_json, sk.price, c.quantity, sk.price * c.quantity, NOW(), NOW()
FROM t_mall_cart c
JOIN t_mall_sku sk ON c.sku_id = sk.id
JOIN t_mall_product p ON sk.spu_id = p.id
WHERE c.user_id = '用户UUID' AND c.selected = 1;

-- 步骤3: 清空已结算购物车项
DELETE FROM t_mall_cart WHERE user_id = '用户UUID' AND selected = 1;
```

### 2.3 我的订单列表

```sql
-- 查询某用户不同状态的订单（含店铺名、商品数）
SELECT
  o.order_no, o.total_amount, o.order_status, o.pay_status, o.created_at,
  sh.shop_name,
  COUNT(oi.id) AS item_count,
  SUM(oi.quantity) AS total_qty
FROM t_mall_order o
JOIN t_mall_shop sh ON o.shop_id = sh.id
JOIN t_mall_order_item oi ON o.id = oi.order_id
WHERE o.user_id = '用户UUID'
  AND o.order_status != '已取消'
GROUP BY o.id
ORDER BY o.created_at DESC
LIMIT 10 OFFSET 0;
```

### 2.4 物流轨迹追踪

```sql
-- 查询某订单的物流轨迹（时间正序）
SELECT
  st.track_time, st.track_desc, st.location, st.source
FROM t_mall_shipment sp
JOIN t_mall_shipment_track st ON sp.id = st.shipment_id
WHERE sp.order_id = '订单UUID'
ORDER BY st.track_time ASC;
```

### 2.5 店铺销售报表

```sql
-- 查询某店铺近30天销售概览
SELECT
  sh.shop_name,
  COUNT(DISTINCT o.order_no) AS order_count,
  SUM(o.pay_amount) AS total_sales,
  AVG(o.pay_amount) AS avg_order_value,
  COUNT(DISTINCT o.user_id) AS buyer_count
FROM t_mall_order o
JOIN t_mall_shop sh ON o.shop_id = sh.id
WHERE sh.id = '店铺UUID'
  AND o.pay_status = '已付'
  AND o.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY sh.id;
```

---

## 三、跨域联合查询

### 3.1 框架协议采购闭环

```sql
-- 从ECP框架协议合同 → 框架执行单 → 商城实际订单 的全链路
SELECT
  c.contract_no, c.total_amount AS framework_amount, c.framework_valid_to,
  mo.order_no AS framework_order, mo.total_amount AS framework_order_amount, mo.order_status,
  o.order_no AS mall_order, o.pay_amount, o.order_status AS mall_status,
  o.pay_status, o.created_at AS mall_order_time
FROM t_ecp_contract c
JOIN t_ecp_mall_order mo ON c.id = mo.contract_id
JOIN t_mall_order o ON mo.order_no = o.order_no
WHERE c.framework_flag = 1
  AND c.supplier_id = '供应商UUID'
ORDER BY c.sign_date DESC;
```

### 3.2 供应商在ECP与商城的统一视图

```sql
-- 某供应商：ECP中标合同数 + 商城店铺订单数
SELECT
  s.name AS supplier_name,
  (SELECT COUNT(*) FROM t_ecp_contract c WHERE c.supplier_id = s.id AND c.status='已签署') AS ecp_contract_count,
  (SELECT COUNT(*) FROM t_ecp_award a WHERE a.supplier_id = s.id) AS ecp_award_count,
  (SELECT COUNT(*) FROM t_ecp_bid b WHERE b.supplier_id = s.id AND b.is_winner = 1) AS ecp_win_count,
  (SELECT COUNT(*) FROM t_mall_shop sh WHERE sh.supplier_id = s.id) AS mall_shop_count,
  (SELECT COUNT(*) FROM t_mall_order o JOIN t_mall_shop sh ON o.shop_id=sh.id WHERE sh.supplier_id=s.id) AS mall_order_count
FROM t_mdm_supplier s
WHERE s.id = '供应商UUID';
```

---

## 四、统计分析与报表SQL

### 4.1 采购方式分布

```sql
SELECT purchase_type, COUNT(*) AS proj_count, SUM(budget_amount) AS total_budget
FROM t_ecp_project
WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 YEAR)
GROUP BY purchase_type
ORDER BY total_budget DESC;
```

### 4.2 供应商等级分布

```sql
SELECT grade, COUNT(*) AS supplier_count
FROM t_ecp_supplier_eval
WHERE eval_period = '2026Q2'
GROUP BY grade
ORDER BY supplier_count DESC;
```

### 4.3 商城类目销售TOP10

```sql
SELECT
  cat.cat_name,
  SUM(oi.item_amount) AS category_sales,
  COUNT(DISTINCT o.order_no) AS order_count
FROM t_mall_order_item oi
JOIN t_mall_order o ON oi.order_id = o.id
JOIN t_mall_sku sk ON oi.sku_id = sk.id
JOIN t_mall_product p ON sk.spu_id = p.id
JOIN t_mall_category cat ON p.category_id = cat.id
WHERE o.pay_status = '已付'
  AND o.created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
GROUP BY cat.id
ORDER BY category_sales DESC
LIMIT 10;
```

---

> 📋 以上SQL示例均基于38张表结构设计，可直接在MySQL 8.0中执行验证。
> 配合ER图、数据字典、索引优化说明，构成完整的数据架构落地参考。
