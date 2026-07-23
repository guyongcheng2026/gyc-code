# 国网ERP深度研究报告

> "逐一研究"系列第三篇 — ERP的核心流程建模（P2P、MRP、维修工单）、关键SAP事务代码、与ECP的交互细节。
> 元信息：创建时间2026-07-20

---

## 一、核心业务流程建模

### 1.1 采购到付款（P2P）全流程

```mermaid
sequenceDiagram
    participant 需求部门
    participant ECP
    participant ERP
    participant 供应商
    participant 财务

    Note over 需求部门: 产生物资需求
    需求部门->>ERP: 创建采购申请（ME51N）
    ERP->>ERP: 审批流（部门→财务→采购部）
    需求部门->>ECP: 发起采购需求（如为公开招标）
    Note over ECP: 通过ECP完成招标/定标
    ECP->>ECP: 合同签署（CA签章）
    ECP->>ERP: 推送采购订单PO（IDoc ORDERS05）
    ERP->>ERP: 接收PO，生成采购订单（ME21N）
    Note over ERP: PO自动过账→生成GR/IR预提
    ERP->>供应商: 下达PO（纸质/邮件/EDI）
    
    Note over 供应商: 发货
    供应商->>ERP: 发货通知
    仓库->>ERP: 收货（MIGO，移动类型101）
    ERP->>ERP: 质检（移动类型101→质检库存）
    ERP->>ERP: 质检通过（移动类型321→可用库存）
    ERP->>ECP: 收货确认反馈
    
    Note over 供应商: 开票
    供应商->>ERP: 提交发票（纸质/电子）
    财务->>ERP: 发票校验（MIRO）
    ERP->>ERP: GR/IR清账
    ERP->>ERP: 生成应付账款
    
    Note over 财务: 付款
    财务->>ERP: 付款运行（F110）
    ERP->>银行: 付款文件
    银行->>供应商: 付款
    ERP->>ECP: 付款状态反馈
```

### 1.2 库存管理与MRP（物料需求计划）

```mermaid
flowchart TB
    subgraph 需求端
        D1[独立需求<br/>项目用量+维护备件+营销]
        D2[相关需求<br/>装配件子件]
    end
    subgraph MRP运算
        MRP[MRP运行<br/>MD01/MD02]
    end
    subgraph 供应端
        S1[现有库存<br/>MB52]
        S2[在途PO<br/>ME2L]
        S3[计划订单<br/>MD04]
        S4[安全库存]
        S5[采购申请<br/>ME5A]
    end
    subgraph 输出
        O1[采购建议<br/>→转为PO]
        O2[生产订单<br/>→下达生产]
        O3[库存调拨<br/>→转储]
    end

    D1 --> MRP
    D2 --> MRP
    S1 --> MRP
    S2 --> MRP
    S3 --> MRP
    S4 --> MRP
    MRP --> O1
    MRP --> O2
    MRP --> O3
    O1 -->|自动/手动| ECP
    O2 -->|生产执行| MES
```

### 1.3 设备维修工单流程

```mermaid
sequenceDiagram
    participant 运维人员
    participant ERP(PM)
    participant 仓库
    participant ECP

    运维人员->>ERP(PM): 创建维修通知单（IW21）
    Note over ERP(PM): 故障描述/优先级/位置
    ERP(PM)->>ERP(PM): 评估→转为维修工单（IW31）
    ERP(PM)->>ERP(PM): 工单计划（工序/物料/人工）
    Note over ERP(PM): 预留物料（MB21）
    仓库->>仓库: 按照预留备料
    运维人员->>仓库: 领料出库（261移动类型）
    Note over 运维人员: 现场维修执行
    运维人员->>ERP(PM): 工单完工确认（IW41）
    ERP(PM)->>ERP(PM): 技术完成标记
    ERP(PM)->>ERP(PM): 结算（KO88→项目成本/资产）
    Note over 运维人员: 如需要更换备件
    ERP(PM)->>ECP: 备件采购需求（→ECP采购订单）
```

---

## 二、关键SAP事务代码清单

| TCode | 功能 | 模块 | 使用频率 |
|-------|------|------|---------|
| ME21N | 创建采购订单 | MM | ⭐⭐⭐⭐⭐ |
| ME22N | 修改采购订单 | MM | ⭐⭐⭐⭐ |
| MIGO | 收货/发货/转储（综合事务） | MM | ⭐⭐⭐⭐⭐ |
| MIRO | 发票校验 | MM-FI | ⭐⭐⭐⭐⭐ |
| ME5A | 显示采购申请清单 | MM | ⭐⭐⭐⭐ |
| MB52 | 库存概览 | MM | ⭐⭐⭐⭐⭐ |
| MB1B | 转储过账 | MM | ⭐⭐⭐ |
| MD04 | 库存/需求清单（MRP视图） | MM-PP | ⭐⭐⭐⭐⭐ |
| FBL1N | 供应商行项目 | FI | ⭐⭐⭐⭐ |
| F110 | 自动付款 | FI | ⭐⭐⭐ |
| IW31 | 创建维修工单 | PM | ⭐⭐⭐⭐ |
| CJ20N | 项目预算/成本 | PS | ⭐⭐⭐ |
| KO88 | 订单结算 | CO | ⭐⭐⭐ |

---

## 三、ERP与各中心的接口数据字典

### 3.1 ERP → ECP（回传接口）

| 数据项 | IDoc类型 | 字段数 | 触发时机 |
|--------|---------|-------|---------|
| 收货确认 | DESADV05 | ~30 | MIGO收货过账后 |
| 发票校验 | INVOIC02 | ~25 | MIRO过账后 |
| 付款状态 | REMADV | ~15 | F110付款执行后 |
| 物料主数据更新 | MATMAS05 | ~50 | 物料创建/变更时 |
| 供应商主数据更新 | CREMAS | ~40 | 供应商创建/变更时 |

### 3.2 ECP → ERP（下发接口）

| 数据项 | IDoc类型 | 字段数 | 触发时机 |
|--------|---------|-------|---------|
| 采购订单 | ORDERS05 | ~40 | ECP合同签署后 |
| 订单变更 | ORDCHG | ~30 | 合同变更后 |
| 订单取消 | — | ~10 | 合同终止后 |

---

## 四、ERP与ECP集成关键差异点

| 场景 | ECP视角 | ERP视角 | 集成要点 |
|------|---------|---------|---------|
| **PO创建** | 合同签署后即确认 | 需要预算检查+供应商主数据校验 | ECP需要先同步供应商/物料主数据 |
| **收货** | 到货验收是采购环节结束 | MIGO收货是库存/财务起点 | 数据需实时双向同步 |
| **发票** | 供应商提交发票即完成 | MIRO校验后才确认 | 发票状态回传ECP供供应商查看 |
| **退货** | 生成退换货单 | 退货PO+质检判定 | 退货流程需跨系统一致性 |
| **付款** | 供应商最关心的问题 | F110批量运行+银企直连 | 付款计划/状态透明化 |

> 📋 本文基于SAP行业标准功能、已入库的《SAP MM电力行业应用知识笔记》及国网ERP通用实践编制。
> 下一篇预告：ELP深度研究报告
