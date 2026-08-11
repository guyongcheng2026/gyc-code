# ECP（电子商务平台）交易域数据架构设计（重点深化）

> 聚焦国网ECP2.0电子商务平台**交易域**的表结构与字段设计，覆盖从采购申请→采购方案→项目→招标/非招标→投标→评标→定标→合同→订单→履约的全流程。
> 目标：字段足以支撑ECP系统主要功能落地。
> 元信息：2026-07-20 | 命名：`t_ecp_<实体>` | 主键 `CHAR(32)` | 字段 `snake_case`
> 关联：本设计与《五E一中心数据架构设计》中的MDM主数据层共用（supplier/material/org/person/project）。

---

## 一、采购申请与方案

### 1.1 采购申请 `t_ecp_purchase_req`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| req_no | VARCHAR(50) | UNIQUE | 采购申请编号 |
| title | VARCHAR(300) | NOT NULL | 申请标题 |
| apply_org_id | CHAR(32) | FK→t_mdm_organization | 申请单位 |
| apply_user_id | CHAR(32) | FK→t_mdm_person | 申请人 |
| budget_amount | DECIMAL(18,2) | | 预算金额 |
| budget_source | VARCHAR(50) | | 预算来源（成本/资本/专项） |
| purchase_type | VARCHAR(20) | NOT NULL | 招标/竞谈/询价/单一来源/竞价/商城采购 |
| urgency | VARCHAR(10) | DEFAULT 'NORMAL' | 紧急/正常 |
| reason | TEXT | | 采购理由 |
| project_id | CHAR(32) | FK→t_mdm_project | 关联项目（如有） |
| status | VARCHAR(20) | NOT NULL | 草稿/审批中/已批准/已驳回 |
| approve_flow_id | CHAR(32) | | 审批流实例ID |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`req_no`(唯一), `apply_org_id`(普通), `status`(普通)

### 1.2 采购方案 `t_ecp_purchase_plan`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| plan_no | VARCHAR(50) | UNIQUE | 采购方案编号 |
| req_id | CHAR(32) | FK→t_ecp_purchase_req | 关联申请 |
| title | VARCHAR(300) | NOT NULL | 方案标题 |
| org_id | CHAR(32) | FK→t_mdm_organization | 采购单位 |
| purchase_type | VARCHAR(20) | NOT NULL | 采购方式 |
| estimate_amount | DECIMAL(18,2) | | 估算金额 |
| package_strategy | TEXT | | 分包策略说明 |
| evaluate_method | VARCHAR(20) | | 综合评估法/经评审最低投标价法 |
| scoring_rule | MEDIUMTEXT | | 评分细则JSON（商务/技术/价格权重） |
| agency_flag | TINYINT(1) | DEFAULT 0 | 是否委托代理 |
| agency_id | CHAR(32) | FK→t_mdm_supplier | 代理机构 |
| tech_book_no | VARCHAR(50) | | 技术条件书编号 |
| plan_begin | DATE | | 计划开始 |
| plan_end | DATE | | 计划完成 |
| status | VARCHAR(20) | NOT NULL | 编制中/审批中/已批准/已驳回 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`plan_no`(唯一), `req_id`(普通), `status`(普通)

---

## 二、采购项目与分包

### 2.1 采购项目 `t_ecp_project`（扩展版）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_no | VARCHAR(50) | UNIQUE | 采购项目编号 |
| project_name | VARCHAR(300) | NOT NULL | 项目名称 |
| plan_id | CHAR(32) | FK→t_ecp_purchase_plan | 关联方案 |
| purchase_type | VARCHAR(20) | NOT NULL | 采购方式 |
| purchase_mode | VARCHAR(20) | | 招标/非招标 |
| org_id | CHAR(32) | FK→t_mdm_organization | 采购单位 |
| budget_amount | DECIMAL(18,2) | | 预算金额 |
| currency | VARCHAR(3) | DEFAULT 'CNY' | 币种 |
| tech_book_no | VARCHAR(50) | | 技术条件书 |
| bid_open_date | DATETIME | | 开标时间 |
| bid_open_addr | VARCHAR(300) | | 开标地点 |
| bid_open_mode | VARCHAR(20) | DEFAULT 'ONLINE' | 在线/现场 |
| package_count | INT | | 分包数 |
| evaluate_method | VARCHAR(20) | | 评审办法 |
| agency_id | CHAR(32) | FK→t_mdm_supplier | 代理机构 |
| open_flag | TINYINT(1) | DEFAULT 0 | 是否公开（公开招标=1） |
| status | VARCHAR(20) | NOT NULL | 方案中/公告中/投标中/评标中/已定标/已终止 |
| create_by | CHAR(32) | FK→t_mdm_person | 创建人 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`project_no`(唯一), `purchase_type`(普通), `status`(普通), `org_id`(普通)

### 2.2 采购分包 `t_ecp_package`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_no | VARCHAR(20) | | 包号 |
| package_name | VARCHAR(200) | | 包名称 |
| material_codes | TEXT | | 物料编码列表（JSON数组） |
| estimate_amount | DECIMAL(18,2) | | 估算金额 |
| supplier_qual_req | TEXT | | 资格要求 |
| tech_req | TEXT | | 技术要求 |
| bidder_limit | INT | | 最多中标家数 |
| status | VARCHAR(20) | | 待招标/招标中/已定标 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`project_id`(普通)

### 2.3 澄清答疑 `t_ecp_clarification`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| ask_user_id | CHAR(32) | FK→t_mdm_person | 提问人（供应商） |
| ask_content | TEXT | NOT NULL | 提问内容 |
| ask_time | DATETIME | | 提问时间 |
| answer_content | TEXT | | 答复内容 |
| answer_user_id | CHAR(32) | FK→t_mdm_person | 答复人（采购方） |
| answer_time | DATETIME | | 答复时间 |
| is_public | TINYINT(1) | DEFAULT 1 | 是否公开（所有投标人可见） |
| status | VARCHAR(20) | DEFAULT 'PENDING' | 待答复/已答复 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`project_id`(普通), `status`(普通)

---

## 三、公告与投标

### 3.1 采购公告 `t_ecp_notice`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| notice_type | VARCHAR(20) | | 招标公告/变更/中标公示/中标公告/失败公告 |
| title | VARCHAR(300) | NOT NULL | 标题 |
| content | LONGTEXT | | 正文（HTML） |
| publish_date | DATETIME | | 发布时间 |
| end_bid_date | DATETIME | | 投标截止 |
| file_url | VARCHAR(500) | | 招标文件URL |
| file_hash | VARCHAR(100) | | 文件SM3哈希 |
| view_count | INT | DEFAULT 0 | 浏览数 |
| download_count | INT | DEFAULT 0 | 下载数 |
| status | VARCHAR(20) | | 草稿/已发布/已撤销 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`project_id`(普通), `notice_type`(普通), `publish_date`(普通)

### 3.2 供应商投标 `t_ecp_bid`（扩展版）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | 投标供应商 |
| bid_file_url | VARCHAR(500) | | 加密投标文件URL |
| bid_file_hash | VARCHAR(100) | | 文件哈希 |
| bid_amount | DECIMAL(18,2) | | 投标总价 |
| bid_detail | MEDIUMTEXT | | 分项报价JSON |
| bid_date | DATETIME | | 上传时间 |
| bid_tool_version | VARCHAR(20) | | 投标工具U+版本 |
| decrypt_status | VARCHAR(20) | DEFAULT 'PENDING' | 待解密/已解密/失败 |
| decrypt_time | DATETIME | | 解密时间 |
| evaluate_score | DECIMAL(10,2) | | 总评分 |
| price_score | DECIMAL(10,2) | | 价格分 |
| tech_score | DECIMAL(10,2) | | 技术分 |
| biz_score | DECIMAL(10,2) | | 商务分 |
| rank_no | INT | | 排名 |
| is_winner | TINYINT(1) | DEFAULT 0 | 是否中标 |
| reject_reason | VARCHAR(500) | | 废标原因 |
| status | VARCHAR(20) | | 已提交/已开标/已评标/已定标/已废标 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`project_id`+`package_id`(组合), `supplier_id`(普通), `is_winner`(普通)

### 3.3 投标保证金 `t_ecp_bid_bond`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| bid_id | CHAR(32) | FK→t_ecp_bid | 关联投标 |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | |
| bond_amount | DECIMAL(18,2) | | 保证金金额 |
| bond_type | VARCHAR(20) | | 电汇/保函/保险 |
| pay_status | VARCHAR(20) | DEFAULT 'UNPAID' | 未付/已付/已退 |
| pay_time | DATETIME | | 支付时间 |
| pay_cert_url | VARCHAR(500) | | 支付凭证 |
| refund_status | VARCHAR(20) | DEFAULT 'NONE' | 未退/退款中/已退 |
| refund_time | DATETIME | | 退款时间 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`bid_id`(普通), `supplier_id`(普通)

---

## 四、评标与定标

### 4.1 评标专家抽取 `t_ecp_expert_draw`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| expert_id | CHAR(32) | FK→t_mdm_person | 专家 |
| expert_cat | VARCHAR(20) | | 专家类别（商务/技术/经济） |
| draw_time | DATETIME | | 抽取时间 |
| avoid_reason | VARCHAR(200) | | 回避原因 |
| confirm_status | VARCHAR(20) | | 待确认/已确认/已拒绝 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 4.2 评标打分 `t_ecp_evaluation`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| bid_id | CHAR(32) | FK→t_ecp_bid | 关联投标 |
| expert_id | CHAR(32) | FK→t_mdm_person | 评标专家 |
| package_id | CHAR(32) | FK→t_ecp_package | |
| tech_score | DECIMAL(10,2) | | 技术分 |
| biz_score | DECIMAL(10,2) | | 商务分 |
| price_score | DECIMAL(10,2) | | 价格分 |
| total_score | DECIMAL(10,2) | | 总分 |
| comment | TEXT | | 评语 |
| submit_time | DATETIME | | 提交时间 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`bid_id`+`expert_id`(组合唯一)

### 4.3 定标结果 `t_ecp_award`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| bid_id | CHAR(32) | FK→t_ecp_bid | 中标投标 |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | 中标供应商 |
| award_amount | DECIMAL(18,2) | | 中标金额 |
| rank_no | INT | | 排名 |
| award_reason | TEXT | | 定标理由 |
| public_flag | TINYINT(1) | DEFAULT 1 | 是否公示 |
| status | VARCHAR(20) | | 待审批/已审批/已公示 |
| approve_by | CHAR(32) | FK→t_mdm_person | 审批人 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`project_id`+`package_id`(组合), `supplier_id`(普通)

---

## 五、合同与订单

### 5.1 合同 `t_ecp_contract`（扩展版）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| contract_no | VARCHAR(50) | UNIQUE | 合同编号 |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| award_id | CHAR(32) | FK→t_ecp_award | 关联定标 |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | |
| contract_name | VARCHAR(300) | NOT NULL | 合同名称 |
| total_amount | DECIMAL(18,2) | NOT NULL | 合同总额 |
| currency | VARCHAR(3) | DEFAULT 'CNY' | |
| sign_date | DATE | | 签署日期 |
| effective_date | DATE | | 生效日期 |
| delivery_date | DATE | | 约定交货 |
| contract_type | VARCHAR(20) | | 买卖合同/框架协议/服务合同 |
| payment_terms | VARCHAR(200) | | 付款条件 |
| framework_flag | TINYINT(1) | DEFAULT 0 | 是否框架协议 |
| framework_valid_from | DATE | | 框架起 |
| framework_valid_to | DATE | | 框架止 |
| file_url | VARCHAR(500) | | 合同PDF |
| ca_sign_supplier | VARCHAR(100) | | 供应商CA签章 |
| ca_sign_buyer | VARCHAR(100) | | 采购方CA签章 |
| status | VARCHAR(20) | NOT NULL | 起草/签署中/已签署/执行中/已完成/已终止/已变更 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`contract_no`(唯一), `supplier_id`(普通), `status`(普通), `framework_flag`(普通)

### 5.2 合同履约节点 `t_ecp_contract_exec`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| contract_id | CHAR(32) | FK→t_ecp_contract | |
| node_type | VARCHAR(20) | | 发货/到货/验收/发票/付款/质保 |
| plan_date | DATE | | 计划完成 |
| actual_date | DATE | | 实际完成 |
| progress | DECIMAL(5,2) | | 进度% |
| remark | VARCHAR(500) | | 备注 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`contract_id`(普通)

### 5.3 商城采购订单 `t_ecp_mall_order`（框架协议下的执行订单）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| order_no | VARCHAR(50) | UNIQUE | 商城订单号 |
| contract_id | CHAR(32) | FK→t_ecp_contract | 关联框架协议 |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | 供应商 |
| org_id | CHAR(32) | FK→t_mdm_organization | 采购单位 |
| total_amount | DECIMAL(18,2) | | 订单金额 |
| currency | VARCHAR(3) | DEFAULT 'CNY' | |
| delivery_addr | VARCHAR(300) | | 交货地址 |
| expect_date | DATE | | 期望到货 |
| approve_status | VARCHAR(20) | DEFAULT 'PENDING' | 审批中/已批准/已驳回 |
| order_status | VARCHAR(20) | | 待发货/已发货/已收货/已验收/已结算 |
| created_by | CHAR(32) | FK→t_mdm_person | 下单人 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`order_no`(唯一), `contract_id`(普通), `supplier_id`(普通)

### 5.4 供应商绩效 `t_ecp_supplier_eval`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | |
| eval_period | VARCHAR(10) | | 2026Q1 |
| delivery_score | DECIMAL(5,2) | | 交付准时率得分 |
| quality_score | DECIMAL(5,2) | | 质量合格率得分 |
| service_score | DECIMAL(5,2) | | 服务得分 |
| price_score | DECIMAL(5,2) | | 价格得分 |
| hse_score | DECIMAL(5,2) | | 安全环保得分 |
| total_score | DECIMAL(5,2) | | 综合 |
| grade | VARCHAR(10) | | AAA/AA/A/B/C |
| eval_by | CHAR(32) | FK→t_mdm_person | |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`supplier_id`+`eval_period`(组合唯一)

---

## 六、ECP交易域总表清单

| 序号 | 表名 | 功能 |
|------|------|------|
| 1 | t_ecp_purchase_req | 采购申请 |
| 2 | t_ecp_purchase_plan | 采购方案 |
| 3 | t_ecp_project | 采购项目 |
| 4 | t_ecp_package | 采购分包 |
| 5 | t_ecp_clarification | 澄清答疑 |
| 6 | t_ecp_notice | 采购公告 |
| 7 | t_ecp_bid | 供应商投标 |
| 8 | t_ecp_bid_bond | 投标保证金 |
| 9 | t_ecp_expert_draw | 评标专家抽取 |
| 10 | t_ecp_evaluation | 评标打分 |
| 11 | t_ecp_award | 定标结果 |
| 12 | t_ecp_contract | 合同 |
| 13 | t_ecp_contract_exec | 合同履约节点 |
| 14 | t_ecp_mall_order | 商城采购订单（框架执行） |
| 15 | t_ecp_supplier_eval | 供应商绩效 |

> 共15张表（不含MDM主数据层6张），覆盖ECP交易域主要功能：申请→方案→项目→招标/非招标→投标→评标→定标→合同→订单→履约→评价。
> 下篇将设计国网商城电商域表结构。
