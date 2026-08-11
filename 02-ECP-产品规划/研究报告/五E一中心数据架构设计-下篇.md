# 五E一中心数据架构设计（下篇）

> 本文为下篇，覆盖 ELP / e物资 / ESC 三中心核心业务表、跨中心集成交换层、以及分析层（数据中台底座）。
> 与上篇（主数据层 + ECP/EIP/ERP）共同构成五E一中心完整数据架构，足以支撑系统主要功能落地。
> 元信息：创建时间2026-07-20
> 命名规范延续上篇：`t_<中心>_<实体>`，`snake_case` 字段，主键 `CHAR(32)`。

---

## 六、ELP（电力物流服务）核心表

### 6.1 运单 `t_elp_shipment`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| shipment_no | VARCHAR(50) | UNIQUE | 运单号 |
| ecp_order_no | VARCHAR(50) | FK→t_ecp_project/合同 | 关联ECP订单 |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | 发货方 |
| from_warehouse | VARCHAR(50) | | 起运仓库 |
| to_location | VARCHAR(300) | | 到货地址 |
| contact_person | VARCHAR(50) | | 收货人 |
| contact_phone | VARCHAR(20) | | 收货电话 |
| planned_departure | DATETIME | | 计划发运 |
| planned_arrival | DATETIME | | 计划到达 |
| actual_departure | DATETIME | | 实际发运 |
| actual_arrival | DATETIME | | 实际到达 |
| vehicle_id | CHAR(32) | FK→t_elp_vehicle | 车辆 |
| driver_id | CHAR(32) | FK→t_mdm_person | 司机 |
| cargo_type | VARCHAR(20) | | 普通/大件/危险品 |
| total_weight | DECIMAL(10,2) | | 总重量（吨） |
| status | VARCHAR(20) | | 待调度/运输中/已签收/异常 |
| estimated_cost | DECIMAL(10,2) | | 预估运费 |
| actual_cost | DECIMAL(10,2) | | 实际运费 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`shipment_no`(唯一), `ecp_order_no`(普通), `status`(普通), `vehicle_id`(普通)

### 6.2 车辆 `t_elp_vehicle`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| plate_no | VARCHAR(20) | UNIQUE | 车牌号 |
| vehicle_type | VARCHAR(20) | | 平板/低平板/厢式/特种 |
| capacity_ton | DECIMAL(8,2) | | 载重（吨） |
| gps_device_id | VARCHAR(50) | | GPS设备ID |
| insurance_no | VARCHAR(50) | | 保险单号 |
| insurance_expire | DATE | | 保险到期 |
| status | VARCHAR(20) | | 可用/运输中/维修/停用 |
| carrier_id | CHAR(32) | FK→t_mdm_supplier | 承运商 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 6.3 GPS轨迹点 `t_elp_gps_track`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| shipment_id | CHAR(32) | FK→t_elp_shipment | |
| timestamp | DATETIME | NOT NULL | 采集时间 |
| latitude | DECIMAL(10,6) | | 纬度 |
| longitude | DECIMAL(10,6) | | 经度 |
| speed | DECIMAL(5,2) | | 速度 km/h |
| direction | DECIMAL(5,2) | | 方向角 |
| vibration | DECIMAL(5,2) | | 振动幅度（g） |
| temperature | DECIMAL(5,2) | | 温度（℃） |
| humidity | DECIMAL(5,2) | | 湿度（%） |
| fence_status | VARCHAR(10) | | IN/OUT 围栏状态 |
| battery_level | INT | | 终端电量% |
| created_at | DATETIME | | |

**索引**：`shipment_id`+`timestamp`(组合), `timestamp`(分区键)
**说明**：高频表，按月分区，热数据Redis缓存最新位置，冷数据归档至InfluxDB。

### 6.4 仓储库存 `t_elp_warehouse_stock`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| warehouse_code | VARCHAR(20) | FK→t_elp_warehouse | 仓库 |
| material_code | VARCHAR(30) | FK→t_mdm_material | 物料 |
| batch_no | VARCHAR(50) | | 批次 |
| quantity | DECIMAL(10,3) | | 数量 |
| stock_type | VARCHAR(20) | | 正常/暂存/待检/冻结 |
| location_code | VARCHAR(20) | | 库位 |
| inbound_date | DATE | | 入库日 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 6.5 仓库 `t_elp_warehouse`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| warehouse_code | VARCHAR(20) | UNIQUE | 仓库编码 |
| warehouse_name | VARCHAR(100) | | 名称 |
| warehouse_level | VARCHAR(10) | | 1/2/3 级 |
| province_code | VARCHAR(10) | | 省份 |
| addr | VARCHAR(300) | | 地址 |
| capacity_area | DECIMAL(10,2) | | 面积（㎡） |
| manager_id | CHAR(32) | FK→t_mdm_person | 仓管 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

---

## 七、e物资（移动物资管理）核心表

### 7.1 移动操作日志 `t_emobile_op_log`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK, UUID（幂等） | |
| user_id | CHAR(32) | FK→t_mdm_person | 操作人 |
| op_type | VARCHAR(20) | NOT NULL | RECEIVE/DELIVER/COUNT/SIGN/TRANSFER |
| biz_order_no | VARCHAR(50) | | 业务单据号（送货单/领料单/盘点单） |
| material_code | VARCHAR(30) | FK→t_mdm_material | 物料 |
| quantity | DECIMAL(10,3) | | 操作数量 |
| photo_url | VARCHAR(500) | | 现场照片 |
| gps_lat | DECIMAL(10,6) | | 纬度 |
| gps_lng | DECIMAL(10,6) | | 经度 |
| sign_data | VARCHAR(500) | | 电子签名数据 |
| local_time | DATETIME | | 本地操作时间 |
| sync_status | VARCHAR(10) | DEFAULT 'PENDING' | PENDING/DONE/FAILED |
| sync_time | DATETIME | | 同步时间 |
| device_id | VARCHAR(50) | | 设备ID |
| version | INT | DEFAULT 1 | 乐观锁 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`id`(唯一, 幂等去重), `user_id`(普通), `sync_status`(普通), `biz_order_no`(普通)

### 7.2 离线操作队列 `t_emobile_offline_queue`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| op_log_id | CHAR(32) | FK→t_emobile_op_log | 关联操作日志 |
| payload | MEDIUMTEXT | | 待同步请求体（JSON） |
| target_service | VARCHAR(50) | | 目标服务 ERP-MIGO/SAP-RFC |
| retry_count | INT | DEFAULT 0 | 重试次数 |
| next_retry | DATETIME | | 下次重试时间 |
| status | VARCHAR(10) | DEFAULT 'QUEUED' | QUEUED/PROCESSING/DONE/FAILED |
| error_msg | VARCHAR(500) | | 错误信息 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 7.3 移动设备 `t_emobile_device`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| device_id | VARCHAR(50) | UNIQUE | 设备唯一标识 |
| user_id | CHAR(32) | FK→t_mdm_person | 绑定用户 |
| device_model | VARCHAR(50) | | 机型 |
| os_version | VARCHAR(20) | | 系统版本 |
| app_version | VARCHAR(20) | | APP版本 |
| last_active | DATETIME | | 最后活跃 |
| push_token | VARCHAR(200) | | 推送令牌 |
| status | VARCHAR(10) | | 活跃/停用 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 7.4 扫码记录 `t_emobile_scan_log`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| user_id | CHAR(32) | FK→t_mdm_person | |
| scan_type | VARCHAR(20) | | 物料码/单据码/库位码/设备码 |
| scan_value | VARCHAR(100) | | 扫码内容 |
| biz_context | VARCHAR(100) | | 业务上下文 |
| scan_time | DATETIME | | 扫码时间 |
| device_id | VARCHAR(50) | | 设备 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

---

## 八、ESC（供应链运营中心）核心表

### 8.1 数据汇聚台账 `t_esc_data_ingest`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| source_system | VARCHAR(20) | | ECP/ERP/EIP/ELP/e物资/EXTERNAL |
| data_type | VARCHAR(50) | | 采购项目/质量试验/GPS轨迹/库存... |
| record_count | INT | | 本批次记录数 |
| ingest_mode | VARCHAR(20) | | 实时流/批量ETL/API拉取 |
| status | VARCHAR(20) | | 接收中/解析中/完成/失败 |
| error_msg | VARCHAR(500) | | 错误 |
| batch_id | VARCHAR(50) | | 批次号 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 8.2 供应商风险预警 `t_esc_supplier_risk`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | |
| risk_type | VARCHAR(20) | | 经营异常/司法诉讼/失信/质量/交付 |
| risk_level | VARCHAR(10) | | 红/橙/黄/蓝 |
| risk_score | DECIMAL(5,2) | | 风险分值 |
| trigger_source | VARCHAR(50) | | 工商变更/法院判决/抽检不合格 |
| detail | TEXT | | 风险详情 |
| handle_status | VARCHAR(20) | DEFAULT 'OPEN' | OPEN/处理中/已闭环 |
| handle_by | CHAR(32) | FK→t_mdm_person | 处理人 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`supplier_id`+`risk_type`(组合), `risk_level`(普通)

### 8.3 采购指标快照 `t_esc_purchase_kpi`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| stat_date | DATE | NOT NULL | 统计日期 |
| org_id | CHAR(32) | FK→t_mdm_organization | 组织 |
| province_code | VARCHAR(10) | | 省份 |
| purchase_amount | DECIMAL(18,2) | | 采购额 |
| contract_count | INT | | 合同数 |
| supplier_count | INT | | 参与供应商数 |
| save_amount | DECIMAL(18,2) | | 节约金额 |
| ontime_rate | DECIMAL(5,2) | | 准时交付率 |
| qualify_rate | DECIMAL(5,2) | | 质量合格率 |
| avg_cycle_days | DECIMAL(5,2) | | 平均采购周期（天） |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`stat_date`+`org_id`(组合)

### 8.4 供应商画像 `t_esc_supplier_profile`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| supplier_id | CHAR(32) | FK→t_mdm_supplier | UNIQUE |
| total_contract_amount | DECIMAL(18,2) | | 历史合同总额 |
| total_contract_count | INT | | 历史合同数 |
| avg_delivery_score | DECIMAL(5,2) | | 平均交付得分 |
| avg_quality_score | DECIMAL(5,2) | | 平均质量得分 |
| avg_price_score | DECIMAL(5,2) | | 平均价格得分 |
| lawsuit_count | INT | | 诉讼次数 |
| negative_news_count | INT | | 负面舆情数 |
| cooperation_years | INT | | 合作年限 |
| profile_tags | VARCHAR(500) | | 画像标签（JSON数组） |
| risk_level | VARCHAR(10) | | 综合风险等级 |
| last_calc_time | DATETIME | | 最后计算时间 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 8.5 预警事件 `t_esc_alert_event`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| alert_type | VARCHAR(20) | | 供应商风险/价格异常/物流异常/质量异常 |
| source_system | VARCHAR(20) | | 触发源 |
| ref_id | VARCHAR(50) | | 关联业务ID |
| alert_level | VARCHAR(10) | | 紧急/重要/普通 |
| title | VARCHAR(200) | | 标题 |
| content | TEXT | | 内容 |
| notify_channels | VARCHAR(100) | | 通知渠道 微信/短信/邮件 |
| handle_status | VARCHAR(20) | DEFAULT 'UNREAD' | UNREAD/已读/处理中/已闭环 |
| handle_by | CHAR(32) | FK→t_mdm_person | |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

**索引**：`alert_type`+`alert_level`(组合), `handle_status`(普通)

### 8.6 运营报告 `t_esc_report`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| report_type | VARCHAR(20) | | 日报/周报/月报/季报/专题 |
| title | VARCHAR(300) | | 标题 |
| period_start | DATE | | 周期起 |
| period_end | DATE | | 周期止 |
| content | LONGTEXT | | 报告正文（AI生成+人工修订） |
| generator | VARCHAR(20) | | AUTO/人工 |
| ai_model | VARCHAR(50) | | 生成模型（光明大模型） |
| approve_status | VARCHAR(20) | DEFAULT 'DRAFT' | 草稿/已审核/已发布 |
| created_by | CHAR(32) | FK→t_mdm_person | |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

---

## 九、跨中心集成交换层

### 9.1 接口调用日志 `t_intf_log`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| interface_id | VARCHAR(50) | | 接口标识 ECP_PO_CREATE / ERP_GR / EIP_TEST_PUSH |
| source_system | VARCHAR(20) | | 调用方 |
| target_system | VARCHAR(20) | | 被调方 |
| req_msg_id | VARCHAR(50) | | 请求消息ID（幂等） |
| req_body | MEDIUMTEXT | | 请求报文 |
| resp_body | MEDIUMTEXT | | 响应报文 |
| status | VARCHAR(20) | | SUCCESS/FAILED/TIMEOUT |
| duration_ms | INT | | 耗时（ms） |
| error_code | VARCHAR(20) | | 错误码 |
| created_at | DATETIME | | |

**索引**：`interface_id`+`req_msg_id`(组合唯一), `created_at`(分区)

### 9.2 主数据分发记录 `t_intf_mdm_dist`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| mdm_type | VARCHAR(20) | | supplier/material/org/person/project |
| mdm_id | CHAR(32) | | 主数据ID |
| target_system | VARCHAR(20) | | 分发目标 ECP/ERP/EIP/ELP |
| action | VARCHAR(10) | | CREATE/UPDATE/DELETE |
| dist_status | VARCHAR(20) | DEFAULT 'PENDING' | PENDING/DONE/FAILED |
| retry_count | INT | DEFAULT 0 | |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 9.3 数据同步状态 `t_intf_sync_state`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| biz_type | VARCHAR(50) | | 业务类型 |
| biz_id | VARCHAR(50) | | 业务ID |
| source_system | VARCHAR(20) | | 源 |
| target_system | VARCHAR(20) | | 目标 |
| sync_status | VARCHAR(20) | | SYNCED/PENDING/FAILED |
| last_sync_time | DATETIME | | 最后同步 |
| version | INT | | 数据版本 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

### 9.4 IDoc映射配置 `t_intf_idoc_map`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | CHAR(32) | PK | |
| idoc_type | VARCHAR(20) | | ORDERS05/DESADV05/INVOIC02/MATMAS05/CREMAS |
| direction | VARCHAR(10) | | INBOUND/OUTBOUND |
| target_table | VARCHAR(50) | | 目标表 |
| field_mapping | MEDIUMTEXT | | 字段映射JSON |
| transform_script | TEXT | | 转换脚本 |
| created_at | DATETIME | | |
| updated_at | DATETIME | | |

---

## 十、分析层（数据中台底座）

### 10.1 维度表 DIM

| 表名 | 用途 |
|------|------|
| `dim_supplier` | 供应商维度（含等级/风险标签/行业） |
| `dim_material` | 物料维度（含分类/品牌/危险标识） |
| `dim_org` | 组织维度（省/市/县层级） |
| `dim_time` | 时间维度（年/季/月/周/日） |
| `dim_project` | 项目维度（类型/状态/WBS） |
| `dim_geography` | 地理维度（省/市/坐标） |

### 10.2 事实表 FACT

| 表名 | 粒度 | 用途 |
|------|------|------|
| `fact_purchase_txn` | 采购项目×月 | 采购交易事实（金额/数量/节约） |
| `fact_quality_test` | 试验记录 | 质量试验事实（合格率/不合格项） |
| `fact_logistics_track` | 运单×轨迹点 | 物流轨迹事实（里程/停留/偏航） |
| `fact_inventory_snapshot` | 库存×日 | 库存快照事实（数量/金额/周转） |
| `fact_supplier_perf` | 供应商×周期 | 供应商绩效事实（交付/质量/价格） |

### 10.3 指标表 KPI

| 表名 | 用途 |
|------|------|
| `kpi_purchase` | 采购类指标（采购额/节约率/集中度） |
| `kpi_supplier` | 供应商类指标（注册数/等级分布/淘汰率） |
| `kpi_quality` | 质量类指标（批次合格率/主要缺陷） |
| `kpi_logistics` | 物流类指标（准时率/异常率/成本） |
| `kpi_risk` | 风险类指标（红橙黄蓝分布/处置时效） |

### 10.4 汇总/应用表 ADS

| 表名 | 用途 |
|------|------|
| `ads_purchase_dashboard` | 采购驾驶舱聚合（按组织/品类/时间） |
| `ads_supplier_360` | 供应商360视图（绩效+风险+合作） |
| `ads_qual_trend` | 质量趋势分析（月度/品类） |
| `ads_logistics_map` | 物流态势地图（在途/异常/分布） |
| `ads_risk_monitor` | 风险监控看板（实时预警） |
| `ads_exec_report` | 高管运营月报底稿 |

---

## 十一、数据架构落地建议

### 11.1 分库分表策略

| 数据库 | 包含表 | 规模策略 |
|--------|--------|---------|
| `db_mdm` | 主数据层6表 | 单库，读写分离 |
| `db_ecp` | ECP 8表 | 按 `org_id` 或 `project_no` 哈希分8库 |
| `db_eip` | EIP 6表 | `t_eip_quality_test` 按月分区 |
| `db_erp` | ERP 8表 | 按公司代码/年分库 |
| `db_elp` | ELP 5表 | `t_elp_gps_track` 时序分离至InfluxDB |
| `db_emobile` | e物资 4表 | 单库，Redis缓存离线队列 |
| `db_esc` | ESC 6表 + 分析层 | ClickHouse OLAP + Hudi湖 |

### 11.2 关键约束与一致性

1. **主数据强一致**：supplier/material 以 MDM 为源头，各中心只读副本通过分发服务同步
2. **跨中心事务**：ECP→ERP 的 PO 推送采用"本地事务 + 接口日志 + 重试 + 对账"的最终一致模式
3. **幂等设计**：`t_intf_log.req_msg_id` 唯一约束防止重复处理
4. **时序数据**：GPS轨迹、质量试验等高频数据独立存储，业务表仅保留聚合/最新值

### 11.3 数据安全与合规

| 要求 | 实现 |
|------|------|
| 传输加密 | TLS 1.3 + 国密SM2/SM3（对外接口） |
| 存储加密 | 敏感字段（身份证/证书）AES-256 |
| 审计留痕 | 所有写操作记录 `created_at`/`updated_at` + 操作人 |
| 权限隔离 | 供应商间数据行级隔离（RBS策略） |
| 等保合规 | 满足网络安全等级保护2.0三级 |

---

## 十二、总表清单（上+下篇合计）

| 层 | 表数 | 表名 |
|----|------|------|
| 主数据层 | 6 | supplier / material / organization / person / project + 4辅助编码表 |
| ECP | 8 | project / package / notice / bid / expert_draw / contract / contract_exec / supplier_eval |
| EIP | 6 | manufacturer / production_line / gateway / production_order / quality_test / material_batch |
| ERP | 8 | po / po_item / gr / invoice / storage_loc / stock / fi_doc / wbs |
| ELP | 5 | shipment / vehicle / gps_track / warehouse_stock / warehouse |
| e物资 | 4 | op_log / offline_queue / device / scan_log |
| ESC | 6 | data_ingest / supplier_risk / purchase_kpi / supplier_profile / alert_event / report |
| 集成层 | 4 | intf_log / mdm_dist / sync_state / idoc_map |
| 分析层 | 27 | 6 DIM + 5 FACT + 5 KPI + 6 ADS + 5辅助 |
| **合计** | **74** | 支撑五E一中心全功能落地 |

> 📋 本文（下篇）与《五E一中心数据架构设计-上篇》共同构成完整数据库设计，字段定义可直接转化为 DDL（MySQL 8.0 语法）。
> 所有设计均基于前期业务流程研究（六篇深度技术说明 + 六篇流程研究报告），覆盖采购交易、质量物联、企业资源、物流、移动、运营六大域。
> 下一步可基于此设计输出：① 建表SQL脚本；② ER图（Mermaid/PowerDesigner）；③ 数据字典文档。
