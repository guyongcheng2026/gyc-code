# 国网EIP深度研究报告

> "逐一研究"系列第二篇 —  EIP的数据采集流程建模、边缘计算架构、质量数据实体关系及与ECP的深度集成。
> 元信息：创建时间2026-07-20

---

## 一、核心业务流程建模

### 1.1 质量数据采集全流程

```mermaid
sequenceDiagram
    participant 制造企业MES
    participant EIP边缘网关
    participant EIP云端
    participant ECP
    participant ESC

    Note over 制造企业MES: 订单排产后
    制造企业MES->>EIP边缘网关: 生产排程数据（计划开工/完工日）
    EIP边缘网关->>EIP云端: 同步排程数据
    
    Note over 制造企业MES: 生产过程中
    制造企业MES->>EIP边缘网关: 关键工序完成信号（投料/装配/调试/试验）
    EIP边缘网关->>EIP边缘网关: 本地规则引擎检查（工序是否在阈值范围内）
    EIP边缘网关->>EIP云端: 工序节点数据实时上报（10秒级）
    EIP云端->>ECP: 生产进度状态更新（排产→生产中→完工待检→已试验→已入库）
    
    Note over 制造企业MES: 出厂试验完成后
    制造企业MES->>EIP边缘网关: 试验数据（试验项目/值/结论）
    EIP边缘网关->>EIP边缘网关: 自动判定（Pass/Fail，依据技术条件书）
    EIP边缘网关->>EIP云端: 试验报告上传（含签章）
    EIP云端->>ECP: 推送试验报告（结构性数据+PDF）
    EIP云端->>ESC: 质量数据流（SPC分析/质量趋势）
    
    Note over ECP, EIP: 到货验收时
    ECP->>EIP: 到货抽检结果回传
    EIP->>EIP: 出厂试验数据 vs 到货抽检数据对照
    EIP->>ECP: 对照结论（一致/偏差/异常）
```

### 1.2 接入网关注册流程

```mermaid
flowchart TB
    M1[制造企业申请接入EIP] --> M2{资质审核<br/>企业资质/生产能力}
    M2 -->|通过| M3[部署边缘网关<br/>现场安装+网络配置]
    M2 -->|驳回| M1
    M3 --> M4[产线设备对接<br/>配置采集点位+协议]
    M4 --> M5{联调测试}
    M5 -->|通过| M6[试运行<br/>7-14天数据验证]
    M5 -->|失败| M4
    M6 --> M7{数据完整性<br/>>95%?}
    M7 -->|是| M8[正式接入<br/>进入ECP可查看名单]
    M7 -->|否| M4
    M8 --> M9[定期质量评估<br/>月度/季度]
```

---

## 二、边缘网关架构

### 2.1 硬件配置（推断）

| 组件 | 配置 | 说明 |
|------|------|------|
| **CPU** | ARM Cortex-A72 / x86 四核 | 工业级，低功耗 |
| **内存** | 4-8GB | 支撑本地缓存和数据预处理 |
| **存储** | 64-128GB SSD | 断网时可缓存7天数据 |
| **通信** | 4G/5G + 以太网 | 双链路冗余 |
| **工业接口** | RS485 / RJ45 / USB | 对接PLC/检测设备 |
| **安全芯片** | 国密SM2/SM4 | 数据加密传输 |

### 2.2 软件栈

```
应用层: 数据采集Agent / 本地规则引擎 / 远程配置Agent
中间层: MQTT Client / OPC UA Client / Modbus TCP Stack
系统层: Linux (Yocto/Ubuntu Core) / Docker容器
安全层: 国密SDK / VPN Client / 防火墙
```

---

## 三、核心数据实体

**制造企业（Manufacturer）**
```
id              CHAR(32)          PK
name            VARCHAR(200)      企业名称
unified_code    VARCHAR(18)       统一社会信用代码
province        VARCHAR(50)       所属省份
product_categories VARCHAR(500)   产品品类（变压器/开关柜/电缆...）
gateway_count   INT               边缘网关数量
access_date     DATE              接入日期
status          VARCHAR(20)       状态（试运行/正式/暂停）
quality_grade   VARCHAR(10)       质量评级
```

**质量试验数据（TestData）**
```
id              CHAR(32)          PK
order_no        VARCHAR(50)       ECP/PO订单号
product_code    VARCHAR(50)       产品物料编码
serial_no       VARCHAR(100)      产品序列号
test_item_code  VARCHAR(50)       试验项目编码
test_item_name  VARCHAR(100)      试验项目名称
test_value      DECIMAL(18,4)     试验值
unit            VARCHAR(20)       单位
lower_limit     DECIMAL(18,4)     下规范限
upper_limit     DECIMAL(18,4)     上规范限
result          VARCHAR(10)       PASS/FAIL
test_time       DATETIME          试验时间
test_device_id  VARCHAR(50)       试验设备ID
operator        VARCHAR(50)       试验操作人
report_url      VARCHAR(500)      试验报告PDF路径
```

---

## 四、与各中心的集成序列

```mermaid
sequenceDiagram
    participant ECP
    participant EIP
    participant ESC

    Note over ECP, EIP: 合同签署后
    ECP->>EIP: 订单信息（物料/数量/技术条件书编号）
    
    Note over EIP: 生产企业确认排产
    EIP->>ECP: 生产排产确认
    EIP->>ESC: 排产状态（可用做履约预警输入）
    
    Note over EIP: 生产过程
    EIP->>ECP: 生产进度更新（每工序节点）
    EIP->>ESC: 生产过程数据流
    
    Note over EIP: 出厂试验
    EIP->>ECP: 试验报告推送
    EIP->>ESC: 质量数据流（SPC分析）
    
    Note over ECP: 到货验收
    ECP->>EIP: 抽检结果回传
    EIP->>EIP: 出厂与到货数据对比
    EIP->>ESC: 质量匹配结论
    
    Note over ESC: 供应商质量画像
    ESC->>ECP: 供应商质量等级/风险标识
    ECP->>ECP: 后续采购中考虑质量因素
```

---

## 五、对ECP产品规划的关键洞察

| EIP能力 | 远光ECP可借鉴的轻量化方案 | 技术难度 |
|---------|------------------------|---------|
| 边缘数据采集 | 供应商Web填报+拍照上传（代替硬件网关） | 低 |
| 质量数据自动比对 | 出厂报告与到货照片的人工+AI辅助比对 | 中 |
| 产线进度透明 | 供应商在Web端手动更新关键节点（5-8个里程碑） | 低 |
| 质量趋势分析 | 基于Excel/轻量BI的数据分析模板 | 低 |
| 试验报告核验 | PDF上传+关键字段提取（OCR/NLP） | 中 |

> 📋 本文基于EIP平台公开资料、专利分析和行业通用物联网架构编制。
> 下一篇预告：ERP深度研究报告
