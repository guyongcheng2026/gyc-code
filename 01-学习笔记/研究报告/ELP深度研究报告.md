# 国网ELP深度研究报告

> "逐一研究"系列第四篇 — ELP的物流全流程建模、三级仓储体系、GPS+IoT数据模型及与ECP的协同。
> 元信息：创建时间2026-07-20

---

## 一、核心业务流程建模

### 1.1 大件电力物资运输全流程

```mermaid
sequenceDiagram
    participant ECP
    participant ELP
    participant 运输车辆
    participant 仓库
    participant 采购方

    Note over ECP: 合同签署/发货通知
    ECP->>ELP: 发货清单（物料/数量/到货地址/预计到货）
    ELP->>ELP: 运输方案评估（大件/超限/路况）
    ELP->>ELP: 车辆调度（平板车/特种车/低平板）
    ELP->>运输车辆: 下达运单+路径规划
    运输车辆->>运输车辆: GPS装车确认+拍照+加固检查
    运输车辆->>ELP: 启运（GPS+北斗开始跟踪）
    
    loop 运输途中（每10秒）
        运输车辆->>ELP: 位置+速度+振动+温湿度
        ELP->>ELP: 电子围栏检查（偏离路线？逗留？）
        ELP->>ECP: 物流状态更新（在途/预计到达）
        ELP->>采购方: 短信/APP推送物流状态
    end
    
    Note over 运输车辆, 仓库: 到达现场
    运输车辆->>仓库: 到货（GPS定位+拍照+双人签字）
    仓库->>ECP: 到货确认反馈
    ELP->>ELP: 运费计算（里程+车型+保险）
    ELP->>ECP: 物流费用结算单
    ECP->>ECP: 运费结算流程（→ERP付款）
```

### 1.2 三级仓储体系流转

```mermaid
flowchart LR
    subgraph L1[一级·区域中心库]
        A1[省级集中存储<br/>500km辐射]
    end
    subgraph L2[二级·周转库]
        B1[地市级中转<br/>200km辐射]
    end
    subgraph L3[三级·现场库]
        C1[变电站/施工现场<br/>临时存放]
    end
    subgraph 供应商
        S1[装备制造商]
    end

    S1 -->|干线运输| A1
    A1 -->|质检/暂存| A1
    A1 -->|分拣/配送| B1
    B1 -->|最后一公里| C1
    C1 -->|领用/安装| D1[工程项目]
    C1 -.->|余料退回| B1
    B1 -.->|余料调拨| A1
```

---

## 二、核心数据实体

**运单（Shipment Order）**
```
id              CHAR(32)          PK
shipment_no     VARCHAR(50)       运单号
ecp_order_no    VARCHAR(50)       ECP订单号（关联）
supplier_id     CHAR(32)          FK→供应商
from_warehouse  VARCHAR(50)       起运仓库
to_location     VARCHAR(200)      到货地址（详细）
contact_person  VARCHAR(50)       收货联系人
contact_phone   VARCHAR(20)       联系电话
planned_departure DATETIME        计划发运时间
planned_arrival  DATETIME         计划到达时间
actual_departure DATETIME         实际发运时间
actual_arrival   DATETIME         实际到达时间
vehicle_id      VARCHAR(50)       车辆ID
driver_id       VARCHAR(50)       司机ID
status          VARCHAR(20)       状态（待调度/运输中/已签收/异常）
estimated_cost  DECIMAL(10,2)     预估运费
actual_cost     DECIMAL(10,2)     实际运费
```

**GPS轨迹点（GPS Track Point）**
```
id              CHAR(32)          PK
shipment_id     CHAR(32)          FK→运单
timestamp       DATETIME          采集时间
latitude        DECIMAL(10,6)     纬度
longitude       DECIMAL(10,6)     经度
speed           DECIMAL(5,2)      速度 km/h
direction       DECIMAL(5,2)      方向角
vibration       DECIMAL(5,2)      振动幅度（g）
temperature     DECIMAL(5,2)      温湿度（℃）
humidity       DECIMAL(5,2)       湿度（%）
fence_status    VARCHAR(10)       围栏状态（IN/OUT）
battery_level   INT               车载终端电量
```

---

## 三、与ECP协同序列图

```mermaid
sequenceDiagram
    participant ECP
    participant ELP
    participant 供应商
    participant 采购方

    Note over ECP, 供应商: 合同签署
    ECP->>供应商: 发货通知（含ECP订单号/到货信息）
    供应商->>ELP: 创建运输任务（发货清单）
    ELP->>ELP: 调度车辆+路径规划
    ELP->>ECP: 运单号+预计到达时间
    
    loop 运输追踪
        ELP->>ELP: GPS位置采集（10秒）
        ELP->>ECP: 物流状态（在途/异常/到达）
        采购方->>ECP: 查看实时物流
    end
    
    Note over 供应商, 采购方: 到货
    供应商->>采购方: 现场签收（拍照+GPS+签字）
    采购方->>ECP: 到货确认
    ECP->>ELP: 签收确认反馈
    ELP->>ECP: 运费结算单
    ECP->>ERP: 运费付款申请
```

---

## 四、对ECP的差异化机会

| ELP能力 | 远光ECP轻量方案 | 优先级 |
|---------|---------------|--------|
| GPS全程跟踪 | 对接快递100/菜鸟API，自动获取轨迹 | P0 |
| 三级仓储 | 如不涉及实物，可不建；如涉及，先做二级（中心+现场） | P3 |
| 电子围栏 | 地图API（高德/百度）+ 规则引擎 | P2 |
| 异常处理 | 物流异常自动告警（超时/偏航） | P1 |
| 运费结算 | 与订单关联，统一结算视图 | P2 |

> 📋 本文基于国网ELP公开论文《电力物流服务平台"四共融"架构设计》及行业通用物流平台实践编制。
> 下一篇预告：e物资深度研究报告
