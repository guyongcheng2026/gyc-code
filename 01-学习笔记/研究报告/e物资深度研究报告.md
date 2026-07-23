# 国网e物资深度研究报告

> "逐一研究"系列第五篇 — e物资的移动端交互流程、离线同步机制、扫码操作序列及与ERP/ECP的协同。
> 元信息：创建时间2026-07-20

---

## 一、核心交互流程建模

### 1.1 移动端收货流程（离线优先）

```mermaid
sequenceDiagram
    participant 仓库员
    participant e物资APP
    participant 本地SQLite
    participant ECP
    participant ERP

    仓库员->>e物资APP: 打开APP，选择"收货"
    e物资APP->>e物资APP: 检查网络状态
    
    alt 网络在线
        仓库员->>e物资APP: 扫描送货单条码
        e物资APP->>ECP: 实时调取采购订单
        ECP->>e物资APP: 返回订单明细（物料/数量）
        仓库员->>e物资APP: 逐项扫描物料确认数量
        e物资APP->>ERP: 实时触发MIGO收货（RFC）
        ERP->>e物资APP: 收货凭证号
        e物资APP->>仓库员: 显示成功，打印标签
    else 网络离线
        仓库员->>e物资APP: 扫描送货单条码
        e物资APP->>本地SQLite: 本地缓存（从预载数据匹配）
        仓库员->>e物资APP: 逐项扫描物料确认数量
        e物资APP->>本地SQLite: 写入操作日志（GUID唯一）
        仓库员->>e物资APP: 离线完成，等待网络
        Note over 本地SQLite: 网络恢复后自动同步
        本地SQLite->>ERP: 批量触发MIGO收货
        ERP->>e物资APP: 收货凭证号回传
    end
    
    e物资APP->>ECP: 到货确认状态（含照片+GPS）
```

### 1.2 现场领料流程

```mermaid
sequenceDiagram
    participant 项目专责
    participant e物资APP
    participant 仓库员
    participant ERP
    participant 项目成本

    项目专责->>e物资APP: 提交领料申请（物料/数量/用途）
    e物资APP->>仓库员: 推送领料通知
    仓库员->>e物资APP: 按领料单拣货（扫码确认）
    仓库员->>e物资APP: 现场领料员扫码签收
    e物资APP->>e物资APP: GPS定位+拍照+电子签名
    e物资APP->>ERP: 触发出库（移动类型201/261）
    ERP->>ERP: 库存扣减
    ERP->>项目成本: WBS元素成本归集
```

### 1.3 库存盘点流程

```mermaid
sequenceDiagram
    participant 盘点员
    participant e物资APP
    participant 本地SQLite
    participant ERP

    盘点员->>e物资APP: 选择盘点任务
    e物资APP->>e物资APP: 显示账存数量
    loop 逐物扫描
        盘点员->>e物资APP: 扫描物料条码
        e物资APP->>e物资APP: 录入实盘数量
    end
    盘点员->>e物资APP: 提交盘点结果
    e物资APP->>本地SQLite: 缓存盘点差异
    e物资APP->>ERP: 上传盘点差异（批量）
    ERP->>ERP: 生成盘点凭证（差异调整）
```

---

## 二、离线同步架构

### 2.1 同步状态机

```mermaid
stateDiagram-v2
    [*] --> 在线: 网络可用
    [*] --> 离线: 网络不可用
    
    在线 --> 操作中: 用户发起操作
    操作中 --> 已同步: 服务端ACK确认
    操作中 --> 离线队列: 超时/断网
    
    离线 --> 离线队列: 操作写入本地
    离线队列 --> 同步中: 网络恢复
    同步中 --> 已同步: 服务端处理成功
    同步中 --> 离线队列: 部分失败（重试）
    
    已同步 --> 在线: 继续操作
```

### 2.2 冲突解决策略

| 冲突场景 | 解决策略 | 说明 |
|---------|---------|------|
| 同一物料被多人同时盘点 | 以最后上传为准，服务端版本号控制 | 乐观锁 |
| 离线操作重复上传 | GUID去重，服务端幂等处理 | 唯一约束 |
| 网络抖动导致半完成 | 本地事务+服务端确认机制 | 两阶段 |
| 数据版本过期 | 服务端返回新版本，客户端重新拉取 | 版本校验 |

---

## 三、核心数据实体

**移动操作日志（Mobile Op Log）**
```
id              CHAR(32)          PK, UUID（GUID保证幂等）
user_id         CHAR(32)          FK→用户
op_type         VARCHAR(20)       操作类型（RECEIVE/DELIVER/COUNT/SIGN）
order_no        VARCHAR(50)       关联单据号
material_code   VARCHAR(50)       物料编码
quantity        DECIMAL(10,3)     操作数量
photo_url       VARCHAR(500)      现场照片路径
gps_lat         DECIMAL(10,6)     纬度
gps_lng         DECIMAL(10,6)     经度
sign_data       VARCHAR(500)      电子签名数据
local_time      DATETIME          本地操作时间
sync_status     VARCHAR(10)       同步状态（PENDING/DONE/FAILED）
sync_time       DATETIME          同步时间
```

---

## 四、对ECP的差异化机会

| e物资能力 | 远光ECP方案 | 优先级 |
|---------|------------|--------|
| 微信小程序 | 基于企业微信/微信小程序开发，免安装 | P0 |
| 扫码驱动 | 微信原生扫码API+二维码标准 | P0 |
| 离线优先 | 小程序Storage+断点续传 | P1 |
| 移动审批 | 微信模板消息推送+审批按钮 | P0 |
| 拍照+GPS+签字 | 微信JS-SDK能力 | P1 |
| AI辅助 | 拍照识别物料铭牌（OCR） | P2 |

> 📋 本文基于"网上国网"APP公开功能、通用移动物资管理实践及混合APP技术架构编制。
> 下一篇预告：ESC深度研究报告
