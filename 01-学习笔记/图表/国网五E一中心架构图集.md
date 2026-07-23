# 国网五E一中心架构图集

> 本文使用 Mermaid 语法绘制五E一中心体系架构图，支持在 Obsidian/GitHub/VS Code 等支持 Mermaid 的编辑器中渲染。
> 元信息：创建时间2026-07-20

---

## 一、五E一中心总架构图

```mermaid
flowchart BT
    subgraph 数据汇聚层
        ECP[ECP 电子商务平台<br/>采购交易/供应商/合同]
        ERP[ERP 企业资源计划<br/>财务/库存/项目成本]
        EIP[EIP 电工装备智慧物联<br/>质量数据采集/监控]
        ELP[ELP 电力物流服务<br/>运输/仓储/配送]
        e物资[e物资 移动物资管理<br/>扫码/离线/移动操作]
    end

    subgraph 运营决策层
        ESC[ESC 供应链运营中心<br/>数据汇聚→智能监控→风险预警→运营决策→应急调度]
    end

    subgraph AI赋能层
        AI[光明大模型<br/>预测/异常检测/NLP/推理]
    end

    ECP -->|采购数据| ESC
    ERP -->|财务库存| ESC
    EIP -->|质量数据| ESC
    ELP -->|物流数据| ESC
    e物资 -->|操作日志| ESC
    AI --->|模型推理| ESC

    ECP <-->|PO/收货/发票| ERP
    ECP <-->|生产进度/质量报告| EIP
    ECP <-->|物流指令/状态| ELP
    e物资 <-->|库存操作| ERP
    e物资 <-->|现场签收| ECP
    EIP -->|质量趋势| ESC
```

---

## 二、各中心四层架构图

### 2.1 ECP（电子商务平台）

```mermaid
flowchart LR
    subgraph B[业务架构]
        B1[招标采购<br/>公开招标/竞谈/询价] --> B2[框架协议采购<br/>协议库存/竞价]
        B2 --> B3[合同管理<br/>起草/签署/执行/变更]
        B3 --> B4[供应商管理<br/>注册/绩效/分级]
    end
    subgraph A[应用架构]
        A1[采购管理后台] --> A2[投标工具U+]
        A2 --> A3[供应商门户]
        A3 --> A4[评标系统]
    end
    subgraph D[数据架构]
        D1[供应商主数据] --- D2[物料主数据]
        D2 --- D3[采购项目数据]
        D3 --- D4[合同/订单数据]
    end
    subgraph T[技术架构]
        T1[Nuxt.js前端<br/>+Element UI] --> T2[微服务集群<br/>Spring Cloud Alibaba]
        T2 --> T3[MySQL+Redis<br/>+RocketMQ+ES]
        T3 --> T4[国网云<br/>Docker+K8s]
    end
    B --> A --> D --> T
```

### 2.2 EIP（电工装备智慧物联）

```mermaid
flowchart LR
    subgraph B[业务架构]
        B1[质量数据采集<br/>多协议适配] --> B2[生产进度监控<br/>排产→入库]
        B2 --> B3[质量试验管理<br/>出厂试验/型式试验]
        B3 --> B4[质量协同<br/>不合格处理/改进闭环]
    end
    subgraph A[应用架构]
        A1[设备管理<br/>企业/产线/网关] --> A2[数据采集<br/>实时监控/历史查询]
        A2 --> A3[质量管控<br/>SPC/不合格品]
        A3 --> A4[协同服务<br/>数据开放/报告推送]
    end
    subgraph D[数据架构]
        D1[制造企业档案] --- D2[质量试验数据]
        D2 --- D3[生产节点数据]
        D3 --- D4[原材料批次数据]
    end
    subgraph T[技术架构]
        T1[边缘网关<br/>OPC UA/Modbus/MQTT] --> T2[云端核心<br/>设备注册/数据接收]
        T2 --> T3[时序数据库<br/>InfluxDB]
        T3 --> T4[数据开放API<br/>REST/JSON]
    end
    B --> A --> D --> T
```

### 2.3 ERP（企业资源计划）

```mermaid
flowchart LR
    subgraph B[业务架构]
        B1[物资管理<br/>采购/库存/仓储] --> B2[财务管理<br/>总账/应付/资产/成本]
        B2 --> B3[项目管理<br/>WBS/预算/决算]
        B3 --> B4[设备管理<br/>工单/检修/费用]
    end
    subgraph A[应用架构]
        A1[SAP MM<br/>物资管理] --> A2[SAP FI/CO<br/>财务管理]
        A2 --> A3[SAP PS<br/>项目管理]
        A3 --> A4[SAP PM<br/>设备管理]
    end
    subgraph D[数据架构]
        D1[物料主数据MDM] --- D2[供应商主数据]
        D2 --- D3[总账/成本数据]
        D3 --- D4[项目WBS数据]
    end
    subgraph T[技术架构]
        T1[SAP S/4HANA<br/>1909+] --> T2[HANA内存DB]
        T2 --> T3[SAP PO/PI<br/>集成中间件]
        T3 --> T4[IDoc/RFC<br/>+Fiori前端]
    end
    B --> A --> D --> T
```

### 2.4 ELP（电力物流服务）

```mermaid
flowchart LR
    subgraph B[业务架构]
        B1[运输管理<br/>计划/调度/运单] --> B2[仓储管理<br/>入库/出库/盘点]
        B2 --> B3[配送管理<br/>路径优化/签收]
        B3 --> B4[物流可视化<br/>实时跟踪/态势]
    end
    subgraph A[应用架构]
        A1[三级仓储体系<br/>中心库/周转库/现场库] --> A2[运输调度系统<br/>GPS+北斗+电子围栏]
        A2 --> A3[物流可视化看板<br/>轨迹回放/异常告警]
        A3 --> A4[费用结算<br/>运费计算/对账/支付]
    end
    subgraph D[数据架构]
        D1[车辆/司机档案] --- D2[运单/轨迹数据]
        D2 --- D3[仓储出入库数据]
        D3 --- D4[费用结算数据]
    end
    subgraph T[技术架构]
        T1[四共融架构<br/>云化中台+云边协同] --> T2[IoT传感器<br/>GPS/温湿度/振动]
        T2 --> T3[北斗+GPS双模<br/>+RFID+PDA]
        T3 --> T4[时序+GIS数据库<br/>轨迹/地图]
    end
    B --> A --> D --> T
```

### 2.5 e物资（移动物资管理）

```mermaid
flowchart LR
    subgraph B[业务架构]
        B1[移动收货<br/>扫码确认/触发ERP] --> B2[库存查询<br/>物料/库位/批次]
        B2 --> B3[领料出库<br/>扫描/拣货/出库]
        B3 --> B4[现场签收<br/>拍照+GPS+签字]
    end
    subgraph A[应用架构]
        A1[混合APP<br/>网上国网嵌入式] --> A2[扫码引擎<br/>条码/二维码/RFID]
        A2 --> A3[离线同步引擎<br/>SQLite+断点续传]
        A3 --> A4[定位/拍照/推送<br/>北斗/GPS/推送通道]
    end
    subgraph D[数据架构]
        D1[本地缓存数据<br/>SQLite] --- D2[离线操作队列<br/>GUID保障幂等]
        D2 --- D3[同步状态日志<br/>操作+拍照]
    end
    subgraph T[技术架构]
        T1[混合APP<br/>Flutter/Native+H5] --> T2[离线存储<br/>SQLite+文件缓存]
        T2 --> T3[同步服务<br/>REST API→RFC到SAP]
        T3 --> T4[消息推送<br/>i国网通道]
    end
    B --> A --> D --> T
```

### 2.6 ESC（供应链运营中心）

```mermaid
flowchart LR
    subgraph B[业务架构]
        B1[数据汇聚<br/>五端数据接入] --> B2[智能监控<br/>可视化大屏]
        B2 --> B3[风险预警<br/>供应商/价格/质量/物流]
        B3 --> B4[运营决策<br/>AI预测/画像/评估]
        B4 --> B5[应急调度<br/>供应链中断恢复]
    end
    subgraph A[应用架构]
        A1[监控大屏<br/>ECharts/GIS] --> A2[风险预警引擎<br/>规则+AI]
        A2 --> A3[决策支持系统<br/>光明大模型接入]
        A3 --> A4[报告系统<br/>自动生成NLP]
    end
    subgraph D[数据架构]
        D1[数据湖<br/>Hudi/Iceberg] --- D2[实时数仓<br/>Flink]
        D2 --- D3[OLAP引擎<br/>ClickHouse/Druid]
        D3 --- D4[时序数据库<br/>InfluxDB]
    end
    subgraph T[技术架构]
        T1[接入层<br/>Kafka/RocketMQ] --> T2[计算层<br/>Flink实时+Hive批量]
        T2 --> T3[AI层<br/>光明大模型GPU集群]
        T3 --> T4[展示层<br/>DataV/Grafana]
    end
    B --> A --> D --> T
```

---

## 三、跨中心数据流总图

```mermaid
flowchart TD
    ECP[ECP 电子商务平台<br/>采购/供应商/合同] -->|PO推送| ERP[ERP SAP<br/>采购订单/收货/发票]
    ECP -->|订单信息| EIP[EIP 质量平台<br/>生产订单/质量要求]
    ECP -->|发货通知| ELP[ELP 物流平台<br/>运单/配送指令]
    ECP -->|采购数据| ESC[ESC 运营中心<br/>交易额/供应商/履约]
    
    EIP -->|质量报告| ECP[ECP 采购方核验]
    EIP -->|质量趋势| ESC
    
    ERP -->|收货确认| ECP
    ERP -->|发票校验| ECP
    ERP -->|财务数据| ESC
    
    ELP -->|物流状态| ECP
    ELP -->|GPS轨迹| ESC
    
    e物资[e物资 移动端] -->|扫码收货| ERP
    e物资 -->|现场签收| ECP
    e物资 -->|操作日志| ESC

    ESC -->|预警/指令| ECP
    ESC -->|供应商风险| ECP
    ESC -->|优化决策| ELP
    ESC -->|AI报告| 各端

    style ECP fill:#4A90D9,color:#fff
    style ERP fill:#7B68EE,color:#fff
    style EIP fill:#2ECC71,color:#fff
    style ELP fill:#F39C12,color:#fff
    style e物资 fill:#E74C3C,color:#fff
    style ESC fill:#9B59B6,color:#fff
```

---

> 📋 本图集（architecture-diagrams.md）配合六篇深度技术说明使用，建议在支持 Mermaid 的编辑器中打开查看渲染效果。
> 如需要在 PPT 中使用，可将 Mermaid 代码复制到 <https://mermaid.live> 等在线工具导出 SVG/PNG。
