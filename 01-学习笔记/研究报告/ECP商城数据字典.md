# ECP与国网商城数据字典（数据架构说明）

> 本字典基于《ECP交易域数据架构设计》《国网商城电商域数据架构设计》及对应SQL生成。
> 完整字段491个、38张表。此处提供**表级清单 + 各表核心字段摘要**，完整逐字段CSV见临时文件 `ecp_mall_dictionary.csv`。
> 元信息：2026-07-20

---

## 一、MDM主数据层（5表）

| 表名 | 核心字段 | 说明 |
|------|---------|------|
| t_mdm_supplier | unified_code/name/legal_person/reg_capital/ca_cert_sn/qual_level/blacklist_flag/status | 供应商主数据，统一信用代码为唯一键 |
| t_mdm_material | material_code/material_name/category_l1~l3/unit/material_type/tech_condition_no | 物料主数据，国网23位编码体系 |
| t_mdm_organization | org_code/org_name/org_type/parent_id/province_code/level | 组织架构，省/市/县层级 |
| t_mdm_person | emp_code/name/id_card/org_id/position/ca_cert_sn/role_codes | 人员主数据 |
| t_mdm_project | project_code/project_name/project_type/org_id/budget_total/wbs_root/status | 项目主数据 |

---

## 二、ECP交易域（15表）

| 表名 | 核心字段 | 说明 |
|------|---------|------|
| t_ecp_purchase_req | req_no/title/apply_org_id/apply_user_id/budget_amount/purchase_type/status | 采购申请 |
| t_ecp_purchase_plan | plan_no/req_id/title/purchase_type/estimate_amount/evaluate_method/scoring_rule | 采购方案（含评分细则） |
| t_ecp_project | project_no/project_name/plan_id/purchase_type/budget_amount/bid_open_date/package_count/status | 采购项目 |
| t_ecp_package | project_id/package_no/package_name/material_codes/estimate_amount/bidder_limit | 采购分包 |
| t_ecp_clarification | project_id/ask_user_id/ask_content/answer_content/is_public/status | 澄清答疑 |
| t_ecp_notice | project_id/notice_type/title/content/publish_date/end_bid_date/file_url | 采购公告 |
| t_ecp_bid | project_id/package_id/supplier_id/bid_amount/bid_detail/decrypt_status/evaluate_score/rank_no/is_winner | 供应商投标 |
| t_ecp_bid_bond | bid_id/bond_amount/bond_type/pay_status/refund_status | 投标保证金 |
| t_ecp_expert_draw | project_id/package_id/expert_id/expert_cat/avoid_reason/confirm_status | 评标专家抽取 |
| t_ecp_evaluation | bid_id/expert_id/tech_score/biz_score/price_score/total_score/comment | 评标打分 |
| t_ecp_award | project_id/package_id/bid_id/supplier_id/award_amount/rank_no/status | 定标结果 |
| t_ecp_contract | contract_no/project_id/supplier_id/total_amount/framework_flag/ca_sign_supplier/ca_sign_buyer/status | 合同（CA双签） |
| t_ecp_contract_exec | contract_id/node_type/plan_date/actual_date/progress | 合同履约节点 |
| t_ecp_mall_order | order_no/contract_id/supplier_id/org_id/total_amount/approve_status/order_status | 框架协议执行订单 |
| t_ecp_supplier_eval | supplier_id/eval_period/delivery_score/quality_score/service_score/price_score/grade | 供应商绩效 |

---

## 三、国网商城电商域（18表）

| 表名 | 核心字段 | 说明 |
|------|---------|------|
| t_mall_category | cat_code/cat_name/parent_id/level/sort_order/status | 商品类目 |
| t_mall_product | spu_code/product_name/material_code/category_id/shop_id/status/audit_status | SPU商品 |
| t_mall_sku | sku_code/spu_id/spec_values/price/stock_qty/weight/barcode/status | SKU规格/库存 |
| t_mall_product_tag | product_id/tag_name/tag_type | 商品标签 |
| t_mall_shop | shop_code/shop_name/supplier_id/shop_type/service_score/logistics_score/status | 商城店铺 |
| t_mall_shop_cat | shop_id/category_id/status | 店铺类目授权 |
| t_mall_cart | user_id/sku_id/quantity/selected/shop_id | 购物车 |
| t_mall_order | order_no/user_id/org_id/shop_id/total_amount/pay_amount/order_status/pay_status/pay_type | 商城订单 |
| t_mall_order_item | order_id/sku_id/spu_id/product_name/spec_json/unit_price/quantity/item_amount | 订单明细 |
| t_mall_payment | pay_no/order_id/pay_amount/pay_channel/pay_status/trans_no | 支付流水 |
| t_mall_shipment | shipment_no/order_id/logistics_company/tracking_no/ship_status/sign_time | 物流单 |
| t_mall_shipment_track | shipment_id/track_time/track_desc/location/source | 物流轨迹 |
| t_mall_aftersale | as_no/order_id/order_item_id/as_type/as_reason/as_status/refund_amount | 售后单 |
| t_mall_review | order_item_id/user_id/product_id/star_level/content/reply_content | 商品评价 |
| t_mall_coupon | coupon_name/coupon_type/threshold_amount/discount_amount/discount_rate/valid_from/valid_to | 优惠券 |
| t_mall_user_coupon | user_id/coupon_id/status/used_order_id | 用户优惠券 |
| t_mall_search_log | user_id/keyword/result_count/search_time | 搜索日志 |
| t_mall_favorite | user_id/product_id | 商品收藏 |

---

## 四、字段命名与类型规范

| 规范项 | 约定 |
|--------|------|
| 表命名 | `t_<域>_<实体>`（ecp/mall/mdm） |
| 字段命名 | `snake_case` 小写下划线 |
| 主键 | `id CHAR(32)` UUID |
| 编码类 | `VARCHAR` 带长度（如 unified_code VARCHAR(18)） |
| 金额 | `DECIMAL(18,2)` |
| 数量 | `DECIMAL(10,3)` 或 `INT` |
| 时间 | `DATETIME`（含时分秒） / `DATE`（仅日期） |
| 布尔标志 | `TINYINT(1)` 0/1 |
| 状态 | `VARCHAR(20)` 枚举值 |
| 大文本 | `TEXT` / `MEDIUMTEXT` / `LONGTEXT` |
| 字符集 | `utf8mb4`（支持中文+表情） |
| 引擎 | `InnoDB`（支持事务/外键） |

---

## 五、完整CSV数据字典

逐字段（表名,字段名,数据类型,约束,说明）已导出至：
`C:\Users\谷勇成\AppData\Local\Temp\ecp_mall_dictionary.csv`

可直接用 Excel 打开（UTF-8-BOM 编码，中文不乱码），共 491 行字段定义。

---

> 📋 本字典与ER图、SQL脚本共同构成ECP与国网商城数据架构完整交付。
