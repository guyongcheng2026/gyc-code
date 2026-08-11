# ECP与国网商城实体关系图（ER图）

> 基于《ECP交易域数据架构设计》《国网商城电商域数据架构设计》绘制的Mermaid ER图。
> 元信息：2026-07-20

---

## 一、ECP交易域 ER图

```mermaid
erDiagram
    t_mdm_supplier ||--o{ t_ecp_purchase_req : "申请单位供应商"
    t_mdm_organization ||--o{ t_ecp_purchase_req : "申请单位"
    t_mdm_person ||--o{ t_ecp_purchase_req : "申请人"
    t_mdm_project ||--o{ t_ecp_purchase_req : "关联项目"

    t_ecp_purchase_req ||--o| t_ecp_purchase_plan : "生成方案"
    t_mdm_organization ||--o{ t_ecp_purchase_plan : "采购单位"
    t_mdm_supplier ||--o{ t_ecp_purchase_plan : "代理机构"

    t_ecp_purchase_plan ||--o| t_ecp_project : "生成项目"
    t_mdm_person ||--o{ t_ecp_project : "创建人"

    t_ecp_project ||--o{ t_ecp_package : "包含分包"
    t_ecp_project ||--o{ t_ecp_clarification : "澄清"
    t_ecp_package ||--o{ t_ecp_clarification : "分包澄清"
    t_ecp_project ||--o{ t_ecp_notice : "发布公吿"
    t_ecp_package ||--o{ t_ecp_notice : "分包公告"

    t_mdm_supplier ||--o{ t_ecp_bid : "投标"
    t_ecp_project ||--o{ t_ecp_bid : "项目投标"
    t_ecp_package ||--o{ t_ecp_bid : "分包投标"
    t_ecp_bid ||--o| t_ecp_bid_bond : "保证金"

    t_mdm_person ||--o{ t_ecp_expert_draw : "专家"
    t_ecp_project ||--o{ t_ecp_expert_draw : "项目抽取"
    t_ecp_package ||--o{ t_ecp_expert_draw : "分包抽取"

    t_ecp_bid ||--o{ t_ecp_evaluation : "评标"
    t_mdm_person ||--o{ t_ecp_evaluation : "专家评分"

    t_ecp_bid ||--o| t_ecp_award : "定标"
    t_ecp_project ||--o{ t_ecp_award : "项目定标"
    t_ecp_package ||--o{ t_ecp_award : "分包定标"
    t_mdm_supplier ||--o{ t_ecp_award : "中标方"

    t_ecp_award ||--o| t_ecp_contract : "生成合同"
    t_ecp_project ||--o{ t_ecp_contract : "项目合同"
    t_mdm_supplier ||--o{ t_ecp_contract : "合同乙方"
    t_ecp_contract ||--o{ t_ecp_contract_exec : "履约节点"
    t_ecp_contract ||--o{ t_ecp_mall_order : "框架执行单"

    t_mdm_supplier ||--o{ t_ecp_supplier_eval : "绩效"
```

**关系说明**：
- `||--o{` 表示一端对多端（1:N），如一个项目包含多个分包
- `||--o|` 表示一对一或一对零一（1:1/1:0..1），如方案生成项目
- 主数据（supplier/org/person/project）为各业务表的公共外键来源

---

## 二、国网商城电商域 ER图

```mermaid
erDiagram
    t_mdm_supplier ||--o| t_mall_shop : "开店"
    t_mall_category ||--o{ t_mall_category : "父子类目"
    t_mall_category ||--o{ t_mall_product : "归类"
    t_mdm_material ||--o{ t_mall_product : "关联物料"

    t_mall_shop ||--o{ t_mall_product : "上架商品"
    t_mall_shop ||--o{ t_mall_shop_cat : "类目授权"
    t_mall_category ||--o{ t_mall_shop_cat : "授权类目"
    t_mall_product ||--o{ t_mall_product_tag : "标签"
    t_mall_product ||--o{ t_mall_sku : "多个SKU"
    t_mall_sku ||--o{ t_mall_cart : "加入购物车"

    t_mdm_person ||--o{ t_mall_cart : "购物车"
    t_mdm_organization ||--o{ t_mall_order : "采购单位"
    t_mdm_person ||--o{ t_mall_order : "下单人"
    t_mall_shop ||--o{ t_mall_order : "店铺订单"

    t_mall_cart ||--o{ t_mall_order : "生成订单"
    t_mall_order ||--o{ t_mall_order_item : "订单明细"
    t_mall_sku ||--o{ t_mall_order_item : "SKU快照"
    t_mall_product ||--o{ t_mall_order_item : "商品快照"
    t_mall_order ||--o| t_mall_payment : "支付"
    t_mall_order ||--o| t_mall_shipment : "发货"
    t_mall_shipment ||--o{ t_mall_shipment_track : "轨迹"

    t_mall_order ||--o{ t_mall_aftersale : "售后"
    t_mall_order_item ||--o{ t_mall_aftersale : "明细售后"
    t_mdm_person ||--o{ t_mall_aftersale : "申请人"
    t_mall_order_item ||--o| t_mall_review : "评价"
    t_mdm_person ||--o{ t_mall_review : "评价人"

    t_mall_coupon ||--o{ t_mall_user_coupon : "发放"
    t_mdm_person ||--o{ t_mall_user_coupon : "领取"
    t_mall_user_coupon ||--o| t_mall_order : "抵扣"
    t_mdm_person ||--o{ t_mall_favorite : "收藏"
    t_mall_product ||--o{ t_mall_favorite : "被收藏"
    t_mdm_person ||--o{ t_mall_search_log : "搜索"
```

**关系说明**：
- 商品（SPU）与SKU为一对多（1:N），一个商品多个规格
- 购物车→订单为生成关系（结算时购物车项转为订单明细）
- 订单与支付、物流、售后均为一对零一（1:0..1）
- 优惠券通过用户券中间表与订单关联

---

## 三、ECP交易域 × 商城域 跨域关系

```mermaid
erDiagram
    t_ecp_contract ||--o{ t_ecp_mall_order : "框架协议下单"
    t_ecp_mall_order ||--o| t_mall_order : "转为商城订单"
    t_mdm_supplier ||--o| t_mall_shop : "供应商开店"
    t_mdm_material ||--o{ t_mall_product : "物料上架商品"
    t_mdm_organization ||--o{ t_mall_order : "商城采购单位"
    t_mdm_person ||--o{ t_ecp_project : "ECP人员"
    t_mdm_person ||--o{ t_mall_order : "商城人员"
```

**闭环说明**：
1. ECP合同（框架协议）→ `t_ecp_mall_order` 框架执行单 → `t_mall_order` 商城实际订单
2. MDM供应商/物料主数据被两个域共享，保证数据一致性

---

> 📋 三张ER图覆盖ECP交易域（15表）、国网商城电商域（18表）及跨域关系。
> 在 Obsidian/VS Code 中可直接渲染。如需导入PowerDesigner，可将本图转换为物理模型导入。
