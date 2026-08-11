# CodeGeeX — AI 编程助手安装使用指南

> 研究日期：2026-08-01
> 来源：https://codegeex.cn | https://z.ai | https://github.com/zai-org/CodeGeeX
> 说明：CodeGeeX 是智谱 AI（Z.ai）旗下的 AI 编程助手

---

## 一、是什么

**CodeGeeX** 是智谱 AI（Zhipu AI，出品 GLM 大模型的公司）推出的 **AI 编程助手**，覆盖代码补全、生成、解释、注释、重构等场景。

- 定位：**IDE 内嵌入式的编程助手**（对标 GitHub Copilot）
- 底层模型：GLM / CodeGeeX 系列（开源 CodeGeeX4-ALL-9B 等）
- 主要形态：
  - **VS Code 插件**（官方：`CodeGeeX/codegeex-vscode-extension` ⭐333）
  - **JetBrains 系列插件**（IntelliJ/PyCharm/GoLand等）
  - **CodeGeeX4 开源模型**（可在本地部署，⭐2,573，CodeGeeX4-ALL-9B）
  - **官网编辑器插件**（codegeex.cn）

## 二、跟 Pi Agent 的区别

| 维度 | CodeGeeX | Pi Agent |
|------|---------|---------|
| 形态 | IDE 插件（嵌入 VS Code/JetBrains） | 独立终端 CLI |
| 核心场景 | 代码补全/生成/对话（跟随编辑器） | 交互式 Agent 干活 |
| 平台 | VS Code / JetBrains | 终端 |
| 底层 | 智谱 GLM/CodeGeeX | 多提供商（Anthropic/OpenAI等） |
| 免费度 | 有免费额度 | 用自己的 Key |

**一句话：CodeGeeX 是"Copilot 式"IDE 助手；Pi 是"终端 Agent"。**

## 三、安装（IDE 插件版）

### VS Code
```
1. 打开 VS Code
2. 扩展市场搜索 "CodeGeeX"
3. 安装官方扩展（作者：CodeGeeX/智谱AI）
4. 登录智谱账号（需注册 codeggex.cn）
5. 开始使用（写代码时自动补全）
```

### JetBrains（IntelliJ IDEA / PyCharm / GoLand 等）
```
1. File → Settings → Plugins
2. 搜索 "CodeGeeX"
3. 安装后重启 IDE
4. 登录账号
```

## 四、核心功能

- **代码补全**：边写边补全（对标 Copilot）
- **代码生成**：自然语言描述 → 生成代码
- **代码解释**：选中代码 → 解释它做什么
- **代码注释**：自动加注释/文档
- **Chat 对话**：在编辑器内与 AI 对话（针对当前项目上下文）
- **多语言**：支持 100+ 编程语言

## 五、CodeGeeX4 开源模型（本地部署）

如果你要自己部署模型（适合 ECP 信创/私有化场景）：

```bash
# CodeGeeX4-ALL-9B（通用全场景模型）
git clone https://huggingface.co/THUDM/codegeex4-all-9b
# 或用 transformers 加载
from transformers import AutoModel, AutoTokenizer
```

模型特点：9B 参数，覆盖 AI 软件开发全场景，开源。

## 六、渠道

- 官网：https://codeggex.cn / https://z.ai
- 开源模型仓库：`zai-org/CodeGeeX`、`CodeGeeX2`、`CodeGeeX4`
- 插件：VS Code 扩展市场 / JetBrains 插件市场

## 七、适用性小结

### 对谷工场景
- **若你想在 VS Code/JetBrains 里写代码时自动补全** → CodeGeeX 合适（免费、中文友好、智谱出品可靠）
- **若你想要一个终端里自主干活的 Agent** → Pi Agent / Claude Code / Codex 更合适

**两者互补，一个跟进编辑器，一个进终端。**

---

*研究：小翎 | 2026-08-01*