# 五E一中心数据架构设计（上篇）

> 本文设计五E一中心体系的整体数据架构，包含分层模型、主数据（MDM）层、ECP/EIP/ERP 三中心的核心业务表及字段定义。
> 设计目标：字段定义足以支撑各中心主要功能落地（采购交易、质量物联、企业资源计划）。
> 元信息：创建时间2026-07-20
> 命名规范：表名 `t_<中心>_<实体>`；字段 `snake_case`；主键 `id CHAR(32) UUID`；时间戳 `DATETIME`；金额 `DECIMAL(18,2)`

---

## 一、整体数据架构分层

```
┌──────────────────────────────────────────────────────────────┐
│                      应用层（各中心业务系统）                    │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│  1. 主数据层（MDM）— 跨中心共享，一处维护多处使用              │
│     supplier / material / organization / person / project       │
├──────────────────────────────────────────────────────────────┤
│  2. 业务交易层（各中心私有）                                    │
│     ECP：采购项目/招标/投标/评标/合同/订单                      │
│     EIP：制造企业/产线/网关/生产订单/质量试验                   │
│     ERP：PO/收货/发票/库存/财务凭证/项目WBS                     │
│     ELP：运单/车辆/轨迹/仓储/费用                              │
│     e物资：移动操作日志/离线队列/设备                          │
│     ESC：汇聚数据/指标/预警/画像/报告                          │
├──────────────────────────────────────────────────────────────┤
│  3. 集成交换层（跨中心接口表）                                  │
│     接口日志 / 同步状态 / IDoc映射 / 主数据分发                 │
├──────────────────────────────────────────────────────────────┤
│  4. 分析层（数据中台 / ESC底座）                                │
│     维度表（DIM）/ 事实表（FACT）/ 指标表（KPI）/ 汇总表（ADS） │
└──────────────────────────────────────────────────────────────┘
```

**存储技术选型建议**：
- 业务交易层：MySQL 8.0（分库分表，按省/年分区）
- 主数据层：MySQL + 读写分离（强一致要求）
- 分析层：ClickHouse（OLAP）+ Hudi（数据湖）+ Kafka（实时流）
- 时序数据：InfluxDB（GPS轨迹、质量试验时序）
- 缓存：Redis（会话、热点数据、接口限流）
- 检索：Elasticsearch（招标公告、供应商档案全文检索）

---

## 二、主数据层（MDM）

> 主数据是跨中心共享的核心实体，由源头系统维护，通过主数据分发服务同步到各中心。

### 2.1 供应商主数据 `t_mdm_supplier`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | UUID |
| unified_code | VARCHAR(18) | UNIQUE, NOT NULL | 统一社会信用代码（18位） |
| name | VARCHAR(200) | NOT NULL | 企业名称 |
| short_name | VARCHAR(100) | | 简称 |
| legal_person | VARCHAR(50) | | 法定代表人 |
| reg_capital | DECIMAL(18,2) | | 注册资本（万元） |
| reg_date | DATE | | 成立日期 |
| reg_address | VARCHAR(300) | | 注册地址 |
| biz_scope | TEXT | | 经营范围 |
| industry_code | VARCHAR(20) | FK→t_mdm_industry | 行业分类编码 |
| province_code | VARCHAR(10) | FK→t_mdm_region | 省份编码 |
| ca_cert_sn | VARCHAR(100) | | CA证书序列号（SM2） |
| ca_expire_date | DATE | | CA证书有效期 |
| qual_level | VARCHAR(10) | DEFAULT 'C' | 资质等级 AAA/AA/A/B/C |
| credit_code | VARCHAR(10) | | 信用等级 |
| blacklist_flag | TINYINT(1) | DEFAULT 0 | 黑名单标志 0/1 |
| blacklist_reason | VARCHAR(500) | | 黑名单原因 |
| status | VARCHAR(20) | NOT NULL | 状态 注册/审核中/通过/暂停/注销 |
| source_system | VARCHAR(20) | | 数据来源 ECP |
| created_at | DATETIME | NOT NULL | 创建时间 |
| updated_at | DATETIME | NOT NULL | 更新时间 |
| version | INT | DEFAULT 1 | 乐观锁版本号 |

**索引**：`unified_code`(唯一), `name`(普通), `qual_level`(普通), `status`(普通)

### 2.2 物料主数据 `t_mdm_material`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | UUID |
| material_code | VARCHAR(30) | UNIQUE, NOT NULL | 物料编码（国网23位ID+短描述） |
| material_name | VARCHAR(200) | NOT NULL | 物料名称 |
| spec_model | VARCHAR(200) | | 规格型号 |
| category_l1 | VARCHAR(20) | FK→t_mdm_material_cat | 大类编码 |
| category_l2 | VARCHAR(20) | FK→t_mdm_material_cat | 中类编码 |
| category_l3 | VARCHAR(20) | FK→t_mdm_material_cat | 小类编码 |
| unit | VARCHAR(10) | | 计量单位（台/套/米/千克） |
| material_type | VARCHAR(20) | | 类型 设备/材料/软件/服务 |
| tech_condition_no | VARCHAR(50) | | 技术条件书编号 |
| brand_flag | TINYINT(1) | DEFAULT 0 | 是否品牌物资 |
| hazardous_flag | TINYINT(1) | DEFAULT 0 | 危险品标志 |
| shelf_life | INT | | 保质期（天，0=无） |
| standard_price | DECIMAL(18,2) | | 参考价（元） |
| source_system | VARCHAR(20) | | 数据来源 ERP/ECP |
| status | VARCHAR(20) | NOT NULL | 状态 有效/停用 |
| created_at | DATETIME | NOT NULL | |
| updated_at | DATETIME | NOT NULL | |

**索引**：`material_code`(唯一), `category_l3`(普通), `material_name`(全文)

### 2.3 组织主数据 `t_mdm_organization`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| org_code | VARCHAR(20) | UNIQUE | 组织机构编码 |
| org_name | VARCHAR(200) | NOT NULL | 组织名称 |
| org_type | VARCHAR(20) | | 类型 省公司/市公司/县公司/部门/班组 |
| parent_id | CHAR(32) | FK→自身 | 上级组织 |
| province_code | VARCHAR(10) | | 省份 |
| level | INT | | 层级 1-5 |
| manager_id | CHAR(32) | FK→t_mdm_person | 负责人 |
| status | VARCHAR(20) | | 有效/停用 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 2.4 人员主数据 `t_mdm_person`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| emp_code | VARCHAR(20) | UNIQUE | 工号 |
| name | VARCHAR(50) | NOT NULL | 姓名 |
| id_card | VARCHAR(18) | | 身份证 |
| org_id | CHAR(32) | FK→t_mdm_organization | 所属组织 |
| position | VARCHAR(50) | | 岗位 |
| phone | VARCHAR(20) | | 手机 |
| email | VARCHAR(100) | | 邮箱 |
| role_codes | VARCHAR(200) | | 角色编码列表（逗号分隔） |
| ca_cert_sn | VARCHAR(100) | | CA证书序列号 |
| status | VARCHAR(20) | | 在职/离职 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 2.5 项目主数据 `t_mdm_project`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_code | VARCHAR(50) | UNIQUE | 项目编码 |
| project_name | VARCHAR(300) | NOT NULL | 项目名称 |
| project_type | VARCHAR(20) | | 基建/技改/大修/营销/信息化 |
| org_id | CHAR(32) | FK→t_mdm_organization | 项目单位 |
| budget_total | DECIMAL(18,2) | | 总预算（元） |
| start_date | DATE | | 开工日期 |
| end_date | DATE | | 竣工日期 |
| wbs_root | VARCHAR(50) | | 顶层WBS元素 |
| status | VARCHAR(20) | | 前期/在建/竣工/决算 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 2.6 辅助编码表

| 表名 | 用途 |
|------|------|
| `t_mdm_industry` | 行业分类（国标GB/T 4754） |
| `t_mdm_region` | 行政区划（省/市/县） |
| `t_mdm_material_cat` | 物料分类（国网物资分类标准 23/489/3387） |
| `t_mdm_currency` | 币种表 |
| `t_mdm_uom` | 计量单位表 |

---

## 三、ECP（电子商务平台）核心表

### 3.1 采购项目 `t_ecp_project`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_no | VARCHAR(50) | UNIQUE | 采购项目编号 SG-YYYY-NN-NNN |
| project_name | VARCHAR(300) | NOT NULL | 项目名称 |
| purchase_type | VARCHAR(20) | NOT NULL | 公开招标/竞争性谈判/询价/单一来源/竞价/框架协议 |
| purchase_mode | VARCHAR(20) | | 招标/非招标 |
| org_id | CHAR(32) | FK→t_mdm_organization | 采购单位 |
| budget_amount | DECIMAL(18,2) | | 预算金额 |
| currency | VARCHAR(3) | DEFAULT 'CNY' | 币种 |
| tech_book_no | VARCHAR(50) | | 技术条件书编号 |
| bid_open_date | DATETIME | | 开标时间 |
| bid_open_addr | VARCHAR(300) | | 开标地点 |
| package_count | INT | | 分包数量 |
| evaluate_method | VARCHAR(20) | | 评审办法 综合评估/经评审最低价 |
| agency_id | CHAR(32) | FK→t_mdm_supplier | 招标代理（如有） |
| status | VARCHAR(20) | NOT NULL | 方案中/公告中/投标中/评标中/已定标/已终止 |
| create_by | CHAR(32) | FK→t_mdm_person | 创建人 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`project_no`(唯一), `purchase_type`(普通), `status`(普通), `org_id`(普通)

### 3.2 采购分包 `t_ecp_package`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | 所属项目 |
| package_no | VARCHAR(20) | | 包号 001/002 |
| package_name | VARCHAR(200) | | 包名称 |
| material_codes | TEXT | | 包含物料编码列表 |
| estimate_amount | DECIMAL(18,2) | | 估算金额 |
| supplier_qual_req | TEXT | | 供应商资格要求 |
| tech_req | TEXT | | 技术要求 |
| status | VARCHAR(20) | | 待招标/招标中/已定标 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 3.3 招标公告 `t_ecp_notice`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| notice_type | VARCHAR(20) | | 招标公告/变更公告/中标公示/中标公告 |
| title | VARCHAR(300) | NOT NULL | 标题 |
| content | LONGTEXT | | 公告正文（HTML） |
| publish_date | DATETIME | | 发布时间 |
| end_bid_date | DATETIME | | 投标截止时间 |
| file_url | VARCHAR(500) | | 招标文件URL |
| view_count | INT | DEFAULT 0 | 浏览次数 |
| status | VARCHAR(20) | | 草稿/已发布/已撤消 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`project_id`(普通), `notice_type`(普通), `publish_date`(普通)

### 3.4 供应商投标 `t_ecp_bid`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | 投标供应商 |
| bid_file_url | VARCHAR(500) | | 加密投标文件URL |
| bid_file_hash | VARCHAR(100) | | 文件哈希（SM3） |
| bid_amount | DECIMAL(18,2) | | 投标报价 |
| bid_date | DATETIME | | 上传时间 |
| decrypt_status | VARCHAR(20) | DEFAULT 'PENDING' | 待解密/已解密/解密失败 |
| evaluate_score | DECIMAL(10,2) | | 评标得分 |
| rank_no | INT | | 排名 |
| is_winner | TINYINT(1) | DEFAULT 0 | 是否中标 |
| status | VARCHAR(20) | | 已提交/已开标/已评标/已定标 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`project_id`+`package_id`(组合), `supplier_id`(普通), `is_winner`(普通)

### 3.5 评标专家抽取 `t_ecp_expert_draw`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| expert_id | CHAR(32) | FK→t_mdm_person | 专家（从专家库抽取） |
| draw_time | DATETIME | | 抽取时间 |
| avoid_reason | VARCHAR(200) | | 回避原因（如利益相关） |
| confirm_status | VARCHAR(20) | | 待确认/已确认/已拒绝 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 3.6 合同 `t_ecp_contract`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| contract_no | VARCHAR(50) | UNIQUE | 合同编号 |
| project_id | CHAR(32) | FK→t_ecp_project | |
| package_id | CHAR(32) | FK→t_ecp_package | |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | |
| contract_name | VARCHAR(300) | NOT NULL | 合同名称 |
| total_amount | DECIMAL(18,2) | NOT NULL | 合同总额 |
| currency | VARCHAR(3) | DEFAULT 'CNY' | |
| sign_date | DATE | | 签署日期 |
| effective_date | DATE | | 生效日期 |
| delivery_date | DATE | | 约定交货日期 |
| contract_type | VARCHAR(20) | | 买卖合同/框架协议/服务合同 |
| payment_terms | VARCHAR(200) | | 付款条件 |
| framework_flag | TINYINT(1) | DEFAULT 0 | 是否框架协议 |
| framework_valid_from | DATE | | 框架有效期起 |
| framework_valid_to | DATE | | 框架有效期止 |
| file_url | VARCHAR(500) | | 合同PDF路径 |
| ca_sign_supplier | VARCHAR(100) | | 供应商CA签章值 |
| ca_sign_buyer | VARCHAR(100) | | 采购方CA签章值 |
| status | VARCHAR(20) | NOT NULL | 起草/签署中/已签署/执行中/已完成/已终止/已变更 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`contract_no`(唯一), `supplier_id`(普通), `status`(普通), `framework_flag`(普通)

### 3.7 合同履约跟踪 `t_ecp_contract_exec`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| contract_id | CHAR(32) | FK→t_ecp_contract | |
| node_type | VARCHAR(20) | | 发货/到货/验收/发票/付款/质保 |
| plan_date | DATE | | 计划完成日 |
| actual_date | DATE | | 实际完成日 |
| progress | DECIMAL(5,2) | | 节点进度% |
| remark | VARCHAR(500) | | 备注 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 3.8 供应商绩效评价 `t_ecp_supplier_eval`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | |
| eval_period | VARCHAR(10) | | 评价周期 2026Q1 |
| delivery_score | DECIMAL(5,2) | | 交付准时率得分 |
| quality_score | DECIMAL(5,2) | | 质量合格率得分 |
| service_score | DECIMAL(5,2) | | 服务得分 |
| price_score | DECIMAL(5,2) | | 价格得分 |
| hse_score | DECIMAL(5,2) | | 安全环保得分 |
| total_score | DECIMAL(5,2) | | 综合得分 |
| grade | VARCHAR(10) | | AAA/AA/A/B/C |
| eval_by | CHAR(32) | FK→t_mdm_person | 评价人 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`supplier_id`+`eval_period`(组合唯一)

---

## 四、EIP（电工装备智慧物联）核心表

### 4.1 接入企业 `t_eip_manufacturer`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | 关联主数据 |
| unified_code | VARCHAR(18) | | 统一社会信用代码 |
| name | VARCHAR(200) | NOT NULL | 企业名称 |
| province_code | VARCHAR(10) | | 省份 |
| product_categories | VARCHAR(500) | | 产品品类（变压器/开关柜...） |
| gateway_count | INT | DEFAULT 0 | 网关数量 |
| access_date | DATE | | 接入日期 |
| access_status | VARCHAR(20) | | 试运行/正式/暂停 |
| quality_grade | VARCHAR(10) | | 质量评级 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 4.2 产线与设备 `t_eip_production_line`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| manufacturer_id | CHAR(32) | FK→t_eip_manufacturer | |
| line_code | VARCHAR(50) | UNIQUE | 产线编码 |
| line_name | VARCHAR(100) | | 产线名称 |
| product_types | VARCHAR(200) | | 生产产品类型 |
| gateway_id | CHAR(32) | FK→t_eip_gateway | 关联网关 |
| status | VARCHAR(20) | | 运行/停机/维护 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 4.3 边缘网关 `t_eip_gateway`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| gateway_sn | VARCHAR(50) | UNIQUE | 网关序列号 |
| manufacturer_id | CHAR(32) | FK→t_eip_manufacturer | |
| model | VARCHAR(50) | | 型号 |
| firmware_version | VARCHAR(20) | | 固件版本 |
| protocol_list | VARCHAR(200) | | 支持协议 OPC UA/Modbus/MQTT |
| network_status | VARCHAR(20) | | 在线/离线/异常 |
| last_heartbeat | DATETIME | | 最后心跳时间 |
| cert_sn | VARCHAR(100) | | 国密证书序列号 |
| install_addr | VARCHAR(300) | | 安装位置 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`gateway_sn`(唯一), `network_status`(普通)

### 4.4 生产订单 `t_eip_production_order`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| order_no | VARCHAR(50) | UNIQUE | 生产订单号 |
| ecp_order_no | VARCHAR(50) | FK→t_ecp_project或合同 | 关联ECP订单 |
| manufacturer_id | CHAR(32) | FK→t_eip_manufacturer | |
| material_code | VARCHAR(30) | FK→t_mdm_material | 产品物料编码 |
| product_name | VARCHAR(200) | | 产品名称 |
| quantity | INT | | 数量 |
| tech_book_no | VARCHAR(50) | | 技术条件书编号 |
| plan_start | DATETIME | | 计划开工 |
| plan_finish | DATETIME | | 计划完工 |
| actual_start | DATETIME | | 实际开工 |
| actual_finish | DATETIME | | 实际完工 |
| current_node | VARCHAR(20) | | 当前工序 排产/投料/装配/调试/试验/入库 |
| quality_status | VARCHAR(20) | | 待检/合格/不合格 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`order_no`(唯一), `ecp_order_no`(普通), `manufacturer_id`(普通)

### 4.5 质量试验数据 `t_eip_quality_test`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| production_order_id | CHAR(32) | FK→t_eip_production_order | |
| product_serial | VARCHAR(100) | | 产品序列号 |
| test_item_code | VARCHAR(50) | | 试验项目编码 |
| test_item_name | VARCHAR(100) | | 试验项目名称 |
| test_value | DECIMAL(18,4) | | 实测值 |
| unit | VARCHAR(20) | | 单位 |
| lower_limit | DECIMAL(18,4) | | 下规范限 |
| upper_limit | DECIMAL(18,4) | | 上规范限 |
| result | VARCHAR(10) | | PASS/FAIL |
| test_time | DATETIME | | 试验时间 |
| test_device_id | VARCHAR(50) | | 试验设备ID |
| operator | VARCHAR(50) | | 操作人 |
| report_url | VARCHAR(500) | | 试验报告URL |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`production_order_id`(普通), `result`(普通), `test_time`(分区键)

> ⚠ 此表为高频写入表，建议按 `test_time` 月度分区，数据量大时可归档至时序库。

### 4.6 原材料批次 `t_eip_material_batch`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| production_order_id | CHAR(32) | FK→t_eip_production_order | |
| batch_no | VARCHAR(50) | | 批次号 |
| material_name | VARCHAR(200) | | 原材料名称 |
| supplier_name | VARCHAR(200) | | 原材料供应商 |
| inbound_check | VARCHAR(10) | | 进场检验 PASS/FAIL |
| check_report_url | VARCHAR(500) | | 检验报告 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

---

## 五、ERP（企业资源计划）核心表

> ERP以SAP S/4HANA为参照，此处设计为等效关系模型，便于非SAP技术栈落地。

### 5.1 采购订单 `t_erp_po`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| po_no | VARCHAR(50) | UNIQUE | 采购订单号 |
| ecp_contract_no | VARCHAR(50) | FK→t_ecp_contract | 关联ECP合同 |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | 供应商 |
| org_id | CHAR(32) | FK→t_mdm_organization | 采购组织 |
| po_type | VARCHAR(10) | | NB标准/UB转储/FO外协 |
| total_amount | DECIMAL(18,2) | | 订单总额 |
| currency | VARCHAR(3) | | 币种 |
| plant | VARCHAR(10) | | 工厂（库存地点上级） |
| status | VARCHAR(20) | | 创建/已审批/部分收货/完全收货/已结算 |
| grir_status | VARCHAR(20) | | GR/IR未清/已清 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`po_no`(唯一), `ecp_contract_no`(普通), `supplier_id`(普通)

### 5.2 采购订单行项 `t_erp_po_item`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| po_id | CHAR(32) | FK→t_erp_po | |
| line_no | INT | | 行项目号 10/20/30 |
| material_code | VARCHAR(30) | FK→t_mdm_material | 物料 |
| material_desc | VARCHAR(200) | | 物料描述 |
| quantity | DECIMAL(10,3) | | 数量 |
| unit | VARCHAR(10) | | 单位 |
| unit_price | DECIMAL(18,2) | | 单价 |
| delivery_date | DATE | | 交货日期 |
| plant | VARCHAR(10) | | 工厂 |
| storage_loc | VARCHAR(10) | | 库存地点 |
| gr_quantity | DECIMAL(10,3) | DEFAULT 0 | 已收货数量 |
| iv_quantity | DECIMAL(10,3) | DEFAULT 0 | 已发票数量 |
| status | VARCHAR(20) | | 开放/部分/完成 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 5.3 库存收货 `t_erp_gr`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| gr_no | VARCHAR(50) | UNIQUE | 收货凭证号 |
| po_id | CHAR(32) | FK→t_erp_po | |
| po_item_id | CHAR(32) | FK→t_erp_po_item | |
| material_code | VARCHAR(30) | FK→t_mdm_material | |
| quantity | DECIMAL(10,3) | | 收货数量 |
| move_type | VARCHAR(3) | | 移动类型 101收货/103冻结 |
| plant | VARCHAR(10) | | 工厂 |
| storage_loc | VARCHAR(10) | | 库存地点 |
| post_date | DATETIME | | 过账日期 |
| qc_status | VARCHAR(20) | DEFAULT 'PENDING' | 待检/合格/不合格 |
| ecp_order_no | VARCHAR(50) | | 回传ECP用 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 5.4 发票校验 `t_erp_invoice`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| invoice_no | VARCHAR(50) | UNIQUE | 发票号 |
| po_id | CHAR(32) | FK→t_erp_po | |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | |
| invoice_amount | DECIMAL(18,2) | | 发票金额 |
| tax_amount | DECIMAL(18,2) | | 税额 |
| gr_ir_clear | TINYINT(1) | DEFAULT 0 | GR/IR是否清账 |
| verify_status | VARCHAR(20) | | 待校验/已校验/差异 |
| payment_status | VARCHAR(20) | DEFAULT 'UNPAID' | 未付/部分付/已付 |
| ecp_contract_no | VARCHAR(50) | | 回传ECP用 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 5.5 库存地点 `t_erp_storage_loc`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| storage_loc_code | VARCHAR(10) | UNIQUE | 库存地点编码 |
| plant_code | VARCHAR(10) | | 所属工厂 |
| loc_name | VARCHAR(100) | | 名称 |
| loc_type | VARCHAR(20) | | 中心库/周转库/现场库/虚拟库 |
| manager_id | CHAR(32) | FK→t_mdm_person | 库管员 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 5.6 库存余额 `t_erp_stock`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| material_code | VARCHAR(30) | FK→t_mdm_material | |
| plant | VARCHAR(10) | | 工厂 |
| storage_loc | VARCHAR(10) | | 库存地点 |
| batch_no | VARCHAR(50) | | 批次 |
| stock_qty | DECIMAL(10,3) | DEFAULT 0 | 库存数量 |
| stock_type | VARCHAR(20) | | 自有/寄售/冻结/质检 |
| val_price | DECIMAL(18,2) | | 评估单价 |
| last_move_date | DATETIME | | 最后移动日 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`material_code`+`plant`+`storage_loc`+`batch_no`(组合唯一)

### 5.7 财务凭证 `t_erp_fi_doc`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| fi_doc_no | VARCHAR(50) | UNIQUE | 凭证号 |
| doc_type | VARCHAR(10) | | 凭证类型 SA/KR/KZ |
| posting_date | DATE | | 过账日期 |
| fiscal_year | INT | | 会计年度 |
| company_code | VARCHAR(10) | | 公司代码 |
| amount | DECIMAL(18,2) | | 金额 |
| debit_credit | VARCHAR(1) | | D借/C贷 |
| gl_account | VARCHAR(20) | | 总账科目 |
| vendor_id | CHAR(32) | FK→t_mdm_supplier | 供应商 |
| reference | VARCHAR(50) | | 参考（PO号/发票号） |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 5.8 项目WBS `t_erp_wbs`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| wbs_element | VARCHAR(50) | UNIQUE | WBS元素 |
| project_id | CHAR(32) | FK→t_mdm_project | |
| wbs_name | VARCHAR(200) | | 名称 |
| parent_wbs | VARCHAR(50) | | 上级WBS |
| budget | DECIMAL(18,2) | | 预算 |
| actual_cost | DECIMAL(18,2) | DEFAULT 0 | 实际成本 |
| start_date | DATE | | 开始 |
| end_date | DATE | | 结束 |
| status | VARCHAR(20) | | 创建/释放/结算/关闭 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

---

> 📋 上篇完。包含：整体分层架构、主数据层（6张表）、ECP（8张表）、EIP（6张表）、ERP（8张表）。
> 下篇将覆盖：ELP（5张表）、e物资（4张表）、ESC（6张表）、跨中心集成交换层（4张表）、分析层（DIM/FACT/KPI/ADS 共12张表）。
> 所有表字段设计均基于前期业务流程研究，可直接作为数据库DDL落地参考。
