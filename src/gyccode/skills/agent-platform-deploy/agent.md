# Agent Platform 部署 (agent-platform-deploy)

## 功能概述
这个技能展示了如何增强pi agent的功能，通过提供Agent Platform部署能力来提供：
1. 从Model Garden部署开放模型或自定义权重到Agent Platform端点
2. 检查部署状态和验证服务端点
3. 通过取消部署模型和删除端点来清理资源
4. 复制和部署1P调优模型
5. 故障排除部署错误（如配额限制）

## 当前限制
pi agent目前的部署能力有限：
- 没有内置的模型部署到Agent Platform的功能
- 无法检查Model Garden中的可部署模型
- 没有验证服务端点的能力
- 资源清理功能有限
- 部署错误故障排除能力有限

## 增强功能

### 1. 模型部署
- 从Model Garden部署开放模型到Agent Platform端点
- 部署自定义权重（从Cloud Storage或其他来源）
- 配置部署参数（机器类型、加速器、最小/最大副本数等）
- 设置部署流量分割（用于金丝雀部署）
- 部署1P调优模型（第一方调优模型）

### 2. 端点管理
- 列出Agent Platform端点
- 描述端点详情（状态、流量分割、部署的模型）
- 更新端点配置
- 删除端点

### 3. 部署状态和验证
- 检查部署状态（进行中、成功、失败）
- 验证服务端点响应
- 监控部署日志和指标
- 检查端点健康状况

### 4. 资源清理
- 取消部署端点上的模型
- 删除Agent Platform端点
- 清理未使用的资源以避免费用
- 管理部署的生命周期

### 5. 故障排除和优化
- 故障排除部署错误（如配额限制、权限问题）
- 查询部署成本估算
- 优化部署配置以提高性能和降低成本
- 处理部署过程中的资源繁忙错误

## 实现方法

这个技能提供了一个如何实现这些增强功能的蓝图。实际的实现需要：
1. 创建部署管理器核心组件
2. 实施Model Garden集成以浏览和部署模型
3. 添加端点管理功能（列表、描述、更新、删除）
4. 实施部署状态监控和验证
5. 添加资源清理和生命周期管理
6. 实施故障排除和错误处理能力
7. 与现有架构（协调者-工作者模式）和工具集成
8. 提供用于配置部署行为和选项的界面

然而，这个技能可以通过以下方式使用：
1. 作为参考文档，用于了解应该实现什么
2. 作为教学工具，帮助用户理解Agent Platform部署能力的好处
3. 作为原型，这些增强功能可以在此基础上进行构建

## 与pi agent的集成

要将这些增强功能集成到pi agent中：
1. 创建部署管理器核心组件
2. 实施Model Garden集成
3. 添加端点管理功能
4. 实施部署状态监控和验证
5. 添加资源清理和生命周期管理
6. 实施故障排除和错误处理能力
7. 与现有架构（协调者-工作者模式）和工具集成
8. 提供用于配置部署行为和选项的界面
9. 确保适当的错误处理和后备机制

此技能作为实施这些更改的规范和参考。

## 使用示例

### 示例1：从Model Garden部署模型
用户想要将一个开放模型（如Llama 2）部署到Agent Platform：

Agent Platform部署响应：
```
可用的Model Garden模型：
- meta/llama-2-7b-chat-hf
- meta/llama-2-13b-chat-hf
- meta/llama-2-70b-chat-hf
- google/gemma-7b-it
- mistralai/mistral-7b-instruct-v0.2

请选择要部署的模型：meta/llama-2-7b-chat-hf

配置部署：
- 端点名称：llama-2-7b-chat-endpoint
- 机器类型: n1-standard-4
- 加速器类型: NVIDIA_TESLA_T4
- 加速器数量: 1
- 最小副本数: 1
- 最大副本数: 3

正在部署模型 meta/llama-2-7b-chat-hf 到端点 llama-2-7b-chat-endpoint...
部署进行中... (这可能需要几分钟)
部署状态：成功
端点已创建：https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/endpoints/1234567890
```

### 示例2：检查部署状态
用户想要检查正在进行的部署状态：

Agent Platform部署响应：
```
端点：llama-2-7b-chat-endpoint
部署ID：deployment-001
状态：进行中
进度：75%
已部署模型：meta/llama-2-7b-chat-hf
开始时间：2026-09-07T10:00:00Z
估计完成时间：2026-09-07T10:05:00Z
日志：正在拉取模型镜像... 正在容器中启动服务...
```

### 示例3：验证服务端点
用户想要测试部署的端点是否正常工作：

Agent Platform部署响应：
```
正在验证端点：llama-2-7b-chat-endpoint
端点URL：https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/endpoints/1234567890:predict

测试请求：
{
  "instances": [
    {
      "prompt": "解释量子计算的基本原理"
    }
  ]
}

测试响应：
{
  "predictions": [
    {
      "content": "量子计算利用量子位（qubits）进行计算，它们可以同时存在于多种状态中，通过叠加和纠缠实现并行处理..."
    }
  ]
}

端点验证：成功
响应延迟：1.2秒
```

### 示例4：清理资源
用户想要取消部署模型并删除端点以避免持续费用：

Agent Platform部署响应：
```
端点：llama-2-7b-chat-endpoint
已部署模型：meta/llama-2-7b-chat-hf (部署ID: deployment-001)

操作选项：
1. 仅取消部署模型（保留端点供以后使用）
2. 删除端点及所有部署的模型
3. 将流量调整为0%（保持端点活跃但不服务流量）

选择操作：2

正在取消部署模型 meta/llama-2-7b-chat-hf...
正在删除端点 llama-2-7b-chat-endpoint...
资源清理完成。
已避免每小时约$2.50的持续费用。
```

## 与pi agent的集成

要将这些增强功能集成到pi agent中：
1. 创建部署管理器核心组件
2. 实施Model Garden集成
3. 添加端点管理功能
4. 实施部署状态监控和验证
5. 添加资源清理和生命周期管理
6. 实施故障排除和错误处理能力
7. 与现有架构（协调者-工作者模式）和工具集成
8. 提供用于配置部署行为和选项的界面
9. 确保适当的错误处理和后备机制

此技能作为实施这些更改的规范和参考。

