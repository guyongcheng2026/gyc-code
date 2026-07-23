# ECP与国网商城数据架构 — 审查与细化补充

> 本文是对《ECP交易域数据架构设计》《国网商城电商域数据架构设计》及配套SQL的批判性审查结论与细化补充。
> 审查发现三类问题：①实体缺失（用JSON blob代替可关联表）；②字段缺失（税率/单位/ERP集成号/发票/审批）；③等保合规缺口（无审计日志）。
> 元信息：2026-07-20

---

## 一、审查发现（问题清单）

### 1.1 实体缺失（高严重度 — 阻塞功能落地）

| # | 缺失实体 | 影响 | 原设计缺陷 |
|---|---------|------|-----------|
| E1 | 分包采购明细 | 分包所含物料不可查询/统计 | `t_ecp_package.material_codes` 用TEXT存JSON，无法JOIN |
| E2 | 投标资质文件 | 投标人资质无法核验留痕 | 无表 |
| E3 | 评标模板/委员会 | 打分维度无定义、委员会无名单 | `scoring_rule`仅存JSON，无结构化模板 |
| E4 | 异议/投诉 | 法定异议投诉流程无载体 | 无表（招投标法强制） |
| E5 | 框架协议采购目录 | 框架协议下可执行商品无价格上限 | 无表 |
| E6 | 合同付款计划 | 进度款/到货款/质保金无计划 | 无表 |
| E7 | 合同变更 | 补充协议无记录 | 无表 |
| E8 | 操作审计日志 | 等保2.0三级强制要求 | 无表 |
| E9 | 审批流节点 | 申请/方案/合同审批无留痕 | 仅存`approve_flow_id` |
| M1 | 发票/抬头 | B2B电商必须开票，无载体 | 无表 |
| M2 | 收货验收 | 订单状态无实际收货记录 | 无表 |
| M3 | 退款流水 | 售后退款无交易记录 | 无表 |
| M4 | 品牌/地址/店铺资质 | 基础主数据缺失 | 品牌用VARCHAR，地址内联，资质无表 |
| M5 | 促销活动 | 仅优惠券，缺活动引擎 | 无表 |
| M6 | 文件/消息 | 文件散落各表，通知无载体 | 无统一表 |

### 1.2 字段缺失（中严重度 — 影响业务完整性）

| 表 | 缺字段 | 必要性 |
|----|--------|--------|
| t_mall_product | tax_rate/unit/moq/lead_time/approval_required_flag | B2B计税、起订、审批必填 |
| t_mall_sku | tax_rate/moq/lead_time/price_effective_date | 同上 |
| t_mall_order | invoice_title_id/erp_po_no/approval_flow_id/budget_code/cancel_reason | 开票、ERP集成、审批 |
| t_mall_order_item | tax_rate/tax_amount/cost_center/erp_po_item_id/delivery_date | 税额、成本中心、集成 |
| t_ecp_contract | erp_po_no/parent_contract_id/contract_pdf_hash | ERP集成、补充协议 |
| t_ecp_bid | tech_bid_url/biz_bid_url/late_flag/withdraw_status/encrypt_algo | 技术/商务标分离、迟到撤标 |

### 1.3 一致性问题（低严重度）

- 状态枚举不统一：申请用"审批中"，方案用"审批中"，合同用"签署中"——建议统一为"待审批/已审批/已驳回"三态
- 时间字段缺 `created_by`/`updated_by`（操作人），不利审计
- 缺逻辑删除约定（`is_deleted TINYINT(1) DEFAULT 0`）

---

## 二、ECP交易域补充表（10张）

### E1 分包采购明细 `t_ecp_package_item`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| package_id | CHAR(32) | FK→t_ecp_package | 所属分包 |
| material_code | VARCHAR(30) | FK→t_mdm_material | 物料编码 |
| material_name | VARCHAR(200) | | 物料名称（快照） |
| spec_model | VARCHAR(200) | | 规格型号 |
| quantity | DECIMAL(10,3) | NOT NULL | 数量 |
| unit | VARCHAR(10) | | 单位 |
| estimate_price | DECIMAL(18,2) | | 估算单价 |
| estimate_amount | DECIMAL(18,2) | | 估算金额 |
| remark | VARCHAR(500) | | 备注 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`package_id`(普通), `material_code`(普通)

### E2 投标资质文件 `t_ecp_bid_qualification`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| bid_id | CHAR(32) | FK→t_ecp_bid | 关联投标 |
| qual_type | VARCHAR(30) | | 资质类型（营业执照/体系认证/业绩证明） |
| file_name | VARCHAR(200) | | 文件名 |
| file_url | VARCHAR(500) | | 文件URL |
| file_hash | VARCHAR(100) | | SM3哈希 |
| upload_time | DATETIME | | 上传时间 |
| status | VARCHAR(20) | | 待审/通过/不通过 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`bid_id`(普通)

### E3 评标模板 `t_ecp_eval_template`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| template_name | VARCHAR(100) | | 模板名称 |
| dimensions | MEDIUMTEXT | | 评分维度JSON：[{name, weight, max_score, type}] |
| status | VARCHAR(20) | | 草稿/启用 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`package_id`(普通)

### E4 评标委员会 `t_ecp_eval_committee`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| expert_id | CHAR(32) | FK→t_mdm_person | 专家 |
| role | VARCHAR(20) | | 主任/成员 |
| confirm_status | VARCHAR(20) | | 待确认/已确认/已拒绝 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`package_id`(普通)

### E5 异议投诉 `t_ecp_complaint`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| complainant_id | CHAR(32) | FK→t_mdm_person/supplier | 投诉人 |
| complainant_type | VARCHAR(20) | | 供应商/专家/其他 |
| complaint_type | VARCHAR(20) | | 异议/投诉 |
| content | TEXT | NOT NULL | 内容 |
| submit_time | DATETIME | | 提交时间 |
| handle_status | VARCHAR(20) | DEFAULT 'PENDING' | 待处理/已受理/已驳回/已结案 |
| handle_by | CHAR(32) | | 处理人 |
| handle_result | TEXT | | 处理结果 |
| handle_time | DATETIME | | 处理时间 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`project_id`(普通), `handle_status`(普通)

### E6 框架协议采购目录 `t_ecp_framework_catalog`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| contract_id | CHAR(32) | FK→t_ecp_contract | 关联框架合同 |
| material_code | VARCHAR(30) | FK→t_mdm_material | 物料 |
| material_name | VARCHAR(200) | | 名称 |
| spec_model | VARCHAR(200) | | 规格 |
| unit | VARCHAR(10) | | 单位 |
| price_ceiling | DECIMAL(18,2) | | 价格上限 |
| moq | INT | | 最小起订 |
| lead_time | INT | | 货期（天） |
| valid_from | DATE | | 生效 |
| valid_to | DATE | | 失效 |
| status | VARCHAR(20) | | 有效/失效 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`contract_id`(普通), `material_code`(普通)

### E7 合同付款计划 `t_ecp_contract_payment`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| contract_id | CHAR(32) | FK→t_ecp_contract | |
| seq | INT | | 期次 |
| payment_type | VARCHAR(20) | | 预付款/进度款/到货款/质保金 |
| plan_amount | DECIMAL(18,2) | | 计划金额 |
| plan_date | DATE | | 计划付款日 |
| actual_amount | DECIMAL(18,2) | | 实付金额 |
| actual_date | DATETIME | | 实付日 |
| pay_status | VARCHAR(20) | DEFAULT 'UNPAID' | 未付/已付/部分付 |
| invoice_no | VARCHAR(50) | | 发票号 |
| erp_fi_no | VARCHAR(50) | | ERP凭证号 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`contract_id`(普通)

### E8 合同变更 `t_ecp_contract_change`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| contract_id | CHAR(32) | FK→t_ecp_contract | |
| change_type | VARCHAR(20) | | 补充/变更/解除 |
| change_reason | TEXT | | 变更原因 |
| change_amount | DECIMAL(18,2) | | 变更金额（+/−） |
| change_content | TEXT | | 变更内容 |
| approve_status | VARCHAR(20) | DEFAULT 'PENDING' | 待审批/已审批/已驳回 |
| approved_by | CHAR(32) | | 审批人 |
| change_date | DATE | | 变更生效日 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`contract_id`(普通)

### E9 操作审计日志 `t_ecp_audit_log`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| biz_module | VARCHAR(30) | | 业务模块（采购/合同/订单） |
| biz_id | CHAR(32) | | 业务ID |
| action | VARCHAR(30) | | 操作类型（新增/修改/删除/提交/审批） |
| operator_id | CHAR(32) | FK→t_mdm_person | 操作人 |
| operator_ip | VARCHAR(50) | | 操作IP |
| detail | MEDIUMTEXT | | 操作详情（前后值） |
| result | VARCHAR(20) | | 成功/失败 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`biz_module`+`biz_id`(组合), `operator_id`(普通), `created_at`(分区)

### E10 审批流节点 `t_ecp_approval_log`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| flow_type | VARCHAR(30) | | 审批类型（申请/方案/合同） |
| biz_id | CHAR(32) | | 业务ID |
| node_no | INT | | 节点序号 |
| node_name | VARCHAR(50) | | 节点名称 |
| approver_id | CHAR(32) | FK→t_mdm_person | 审批人 |
| approve_action | VARCHAR(20) | | 通过/驳回/转办 |
| approve_comment | TEXT | | 审批意见 |
| approve_time | DATETIME | | 审批时间 |
| status | VARCHAR(20) | | 待审/已审/已驳回 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`flow_type`+`biz_id`(组合)

---

## 三、国网商城电商域补充表（10张）

### M1 品牌 `t_mall_brand`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| brand_code | VARCHAR(30) | UNIQUE | 品牌编码 |
| brand_name | VARCHAR(100) | NOT NULL | 品牌名 |
| brand_logo | VARCHAR(500) | | LOGO |
| status | VARCHAR(20) | | 启用/停用 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### M2 收货地址簿 `t_mall_address`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| user_id | CHAR(32) | FK→t_mdm_person | 用户 |
| receiver_name | VARCHAR(50) | NOT NULL | 收货人 |
| phone | VARCHAR(20) | | 电话 |
| province | VARCHAR(50) | | 省 |
| city | VARCHAR(50) | | 市 |
| district | VARCHAR(50) | | 区 |
| detail_addr | VARCHAR(300) | | 详细地址 |
| is_default | TINYINT(1) | DEFAULT 0 | 默认 |
| tag | VARCHAR(20) | | 标签（家/公司） |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`user_id`(普通)

### M3 发票抬头 `t_mall_invoice_title`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| owner_id | CHAR(32) | FK→t_mdm_organization/person | 归属（单位/个人） |
| title_type | VARCHAR(20) | | 企业/个人 |
| title | VARCHAR(200) | NOT NULL | 抬头 |
| tax_no | VARCHAR(30) | | 税号 |
| bank_name | VARCHAR(100) | | 开户行 |
| bank_account | VARCHAR(50) | | 账号 |
| address | VARCHAR(300) | | 地址 |
| phone | VARCHAR(20) | | 电话 |
| email | VARCHAR(100) | | 接收邮箱 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`owner_id`(普通)

### M4 发票 `t_mall_invoice`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| order_id | CHAR(32) | FK→t_mall_order | 关联订单 |
| invoice_title_id | CHAR(32) | FK→t_mall_invoice_title | 抬头 |
| invoice_type | VARCHAR(20) | | 增值税专票/普票 |
| amount | DECIMAL(18,2) | | 金额（不含税） |
| tax_amount | DECIMAL(18,2) | | 税额 |
| total_amount | DECIMAL(18,2) | | 价税合计 |
| invoice_no | VARCHAR(50) | | 发票号 |
| drawer | VARCHAR(50) | | 开票人 |
| issue_status | VARCHAR(20) | DEFAULT 'PENDING' | 待开/已开/已红冲 |
| issue_time | DATETIME | | 开票时间 |
| pdf_url | VARCHAR(500) | | 发票PDF |
| erp_invoice_no | VARCHAR(50) | | ERP发票号 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`order_id`(普通), `invoice_no`(普通)

### M5 收货验收 `t_mall_receipt`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| order_id | CHAR(32) | FK→t_mall_order | |
| order_item_id | CHAR(32) | FK→t_mall_order_item | 明细 |
| sku_id | CHAR(32) | FK→t_mall_sku | |
| plan_qty | DECIMAL(10,3) | | 应收 |
| actual_qty | DECIMAL(10,3) | | 实收 |
| qualified_qty | DECIMAL(10,3) | | 合格 |
| unqualified_qty | DECIMAL(10,3) | | 不合格 |
| qc_result | VARCHAR(20) | | 合格/不合格/部分合格 |
| receipt_by | CHAR(32) | FK→t_mdm_person | 验收人 |
| receipt_time | DATETIME | | 验收时间 |
| erp_gr_no | VARCHAR(50) | | ERP收货凭证 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`order_id`(普通)

### M6 退款流水 `t_mall_refund`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| aftersale_id | CHAR(32) | FK→t_mall_aftersale | 关联售后 |
| refund_no | VARCHAR(50) | UNIQUE | 退款单号 |
| refund_amount | DECIMAL(18,2) | | 退款金额 |
| refund_channel | VARCHAR(20) | | 原路/账期冲抵 |
| refund_status | VARCHAR(20) | DEFAULT 'PROCESSING' | 处理中/成功/失败 |
| trans_no | VARCHAR(100) | | 渠道交易号 |
| refund_time | DATETIME | | 退款时间 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`refund_no`(唯一), `aftersale_id`(普通)

### M7 店铺资质 `t_mall_shop_qualification`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| shop_id | CHAR(32) | FK→t_mall_shop | |
| qual_type | VARCHAR(30) | | 营业执照/授权书/资质证书 |
| file_url | VARCHAR(500) | | 文件 |
| file_hash | VARCHAR(100) | | 哈希 |
| valid_from | DATE | | 生效 |
| valid_to | DATE | | 失效 |
| status | VARCHAR(20) | | 有效/过期/待审 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`shop_id`(普通)

### M8 促销活动 `t_mall_promotion`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| promo_name | VARCHAR(100) | | 活动名 |
| promo_type | VARCHAR(20) | | 满减/折扣/秒杀/团购 |
| rule_json | MEDIUMTEXT | | 规则JSON |
| scope_type | VARCHAR(20) | | 全店/类目/商品 |
| scope_id | CHAR(32) | | 作用对象ID |
| begin_time | DATETIME | | 开始 |
| end_time | DATETIME | | 结束 |
| status | VARCHAR(20) | | 未开始/进行中/已结束 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### M9 文件管理 `t_mall_file`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| biz_module | VARCHAR(30) | | 业务模块 |
| biz_id | CHAR(32) | | 业务ID |
| file_name | VARCHAR(200) | | 文件名 |
| file_url | VARCHAR(500) | | URL |
| file_hash | VARCHAR(100) | | 哈希 |
| file_size | INT | | 大小（字节） |
| file_type | VARCHAR(20) | | 类型 |
| uploader_id | CHAR(32) | | 上传人 |
| upload_time | DATETIME | | 上传时间 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`biz_module`+`biz_id`(组合)

### M10 消息通知 `t_mall_message`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| receiver_id | CHAR(32) | FK→t_mdm_person | 接收人 |
| msg_type | VARCHAR(30) | | 订单/审批/物流/系统 |
| title | VARCHAR(200) | | 标题 |
| content | TEXT | | 内容 |
| channel | VARCHAR(20) | | 站内/短信/微信 |
| read_flag | TINYINT(1) | DEFAULT 0 | 已读 |
| biz_link | VARCHAR(500) | | 业务链接 |
| send_time | DATETIME | | 发送时间 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`receiver_id`(普通), `read_flag`(普通)

---

## 四、原表字段补充（ALTER）

```sql
-- 商品税制与采购属性
ALTER TABLE t_mall_product ADD COLUMN tax_rate DECIMAL(5,2) DEFAULT 13.00 COMMENT '税率%';
ALTER TABLE t_mall_product ADD COLUMN unit VARCHAR(10) COMMENT '计量单位';
ALTER TABLE t_mall_product ADD COLUMN moq INT DEFAULT 1 COMMENT '最小起订量';
ALTER TABLE t_mall_product ADD COLUMN lead_time INT COMMENT '货期(天)';
ALTER TABLE t_mall_product ADD COLUMN approval_required_flag TINYINT(1) DEFAULT 1 COMMENT '是否需审批';
ALTER TABLE t_mall_product ADD COLUMN price_effective_from DATE COMMENT '价格生效';
ALTER TABLE t_mall_product ADD COLUMN price_effective_to DATE COMMENT '价格失效';

-- SKU税制
ALTER TABLE t_mall_sku ADD COLUMN tax_rate DECIMAL(5,2) DEFAULT 13.00;
ALTER TABLE t_mall_sku ADD COLUMN moq INT DEFAULT 1;
ALTER TABLE t_mall_sku ADD COLUMN lead_time INT;
ALTER TABLE t_mall_sku ADD COLUMN price_effective_date DATE;

-- 订单开票/集成/审批
ALTER TABLE t_mall_order ADD COLUMN invoice_title_id CHAR(32) COMMENT '发票抬头';
ALTER TABLE t_mall_order ADD COLUMN erp_po_no VARCHAR(50) COMMENT 'ERP采购订单号';
ALTER TABLE t_mall_order ADD COLUMN approval_flow_id CHAR(32) COMMENT '审批流ID';
ALTER TABLE t_mall_order ADD COLUMN budget_code VARCHAR(50) COMMENT '预算科目';
ALTER TABLE t_mall_order ADD COLUMN delivery_type VARCHAR(20) COMMENT '配送方式';
ALTER TABLE t_mall_order ADD COLUMN expect_date DATE COMMENT '期望到货';
ALTER TABLE t_mall_order ADD COLUMN cancel_reason VARCHAR(500) COMMENT '取消原因';
ALTER TABLE t_mall_order ADD COLUMN currency_rate DECIMAL(10,4) DEFAULT 1 COMMENT '汇率';

-- 订单明细税额/集成
ALTER TABLE t_mall_order_item ADD COLUMN tax_rate DECIMAL(5,2) COMMENT '税率';
ALTER TABLE t_mall_order_item ADD COLUMN tax_amount DECIMAL(18,2) COMMENT '税额';
ALTER TABLE t_mall_order_item ADD COLUMN cost_center VARCHAR(50) COMMENT '成本中心';
ALTER TABLE t_mall_order_item ADD COLUMN erp_po_item_id CHAR(32) COMMENT 'ERP订单行';
ALTER TABLE t_mall_order_item ADD COLUMN delivery_date DATE COMMENT '期望到货';

-- 合同ERP集成/补充
ALTER TABLE t_ecp_contract ADD COLUMN erp_po_no VARCHAR(50) COMMENT 'ERP采购订单号';
ALTER TABLE t_ecp_contract ADD COLUMN parent_contract_id CHAR(32) COMMENT '父合同(补充协议)';
ALTER TABLE t_ecp_contract ADD COLUMN contract_pdf_hash VARCHAR(100) COMMENT '合同PDF哈希';

-- 投标技术/商务标分离
ALTER TABLE t_ecp_bid ADD COLUMN tech_bid_url VARCHAR(500) COMMENT '技术标URL';
ALTER TABLE t_ecp_bid ADD COLUMN biz_bid_url VARCHAR(500) COMMENT '商务标URL';
ALTER TABLE t_ecp_bid ADD COLUMN bid_file_name VARCHAR(200) COMMENT '文件名';
ALTER TABLE t_ecp_bid ADD COLUMN late_flag TINYINT(1) DEFAULT 0 COMMENT '是否迟到';
ALTER TABLE t_ecp_bid ADD COLUMN withdraw_status VARCHAR(20) COMMENT '撤标状态';
ALTER TABLE t_ecp_bid ADD COLUMN encrypt_algo VARCHAR(20) DEFAULT 'SM4' COMMENT '加密算法';

-- 统一审计字段（建议加到所有业务表）
-- ALTER TABLE <t_xxx> ADD COLUMN created_by CHAR(32) COMMENT '创建人';
-- ALTER TABLE <t_xxx> ADD COLUMN is_deleted TINYINT(1) DEFAULT 0 COMMENT '逻辑删除';
```

---

## 五、细化后总表清单

| 域 | 原表 | 新增 | 合计 |
|----|------|------|------|
| MDM主数据 | 5 | 0 | 5 |
| ECP交易域 | 15 | +10 (E1~E10) | 25 |
| 国网商城电商域 | 18 | +10 (M1~M10) | 28 |
|| 合计 | **38** | **+20** | **58** |

> 审查细化后，数据架构从38张表扩展至58张（原38 + 新增20：E1~E10、M1~M10），覆盖招投标法强制流程（异议投诉）、等保2.0三级（审计日志）、B2B电商计税开票（税率/发票）、ERP集成（采购订单号/收货凭证）、框架协议执行（采购目录）等完整业务闭环。
> 注：前文"63张"为笔误，正确为 38+20=58张。配套SQL(v2)已含58表CREATE，校验通过。
