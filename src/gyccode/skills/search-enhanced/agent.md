# 增强搜索工具 (search-enhanced)

## 工具概述
这个技能展示了如何增强pi agent的文件搜索能力，通过添加：
1. GlobTool - 用于强大的文件模式匹配
2. GrepTool - 用于正则表达式内容搜索
3. 高级过滤和选项
4. 嵌入式搜索引擎选项（bfs/ugrep）以提高性能

## 当前限制
pi agent目前没有专门的文件搜索工具。用户必须使用基本的bash命令：
- `find` 用于文件模式匹配
- `grep` 用于内容搜索
这些命令工作正常，但缺少：
- 集成的工具接口
- 高级选项和过滤器
- 性能优化
- 一致的输出格式

## 增强功能

### 1. GlobTool - 文件模式匹配
提供强大的文件路径匹配能力：
- 支持标准glob模式（*, ?, [], **等）
- 递归和非递归搜索选项
- 排除模式支持（！排除）
- 结果排序选项（按名称、修改时间、大小等）
- 输出格式选项（列表、详细信息、仅路径等）

### 2. GrepTool - 内容搜索
提供强大的文件内容搜索能力：
- 正则表达式支持（基本和扩展）
- 大小写敏感/不敏感选项
- 全词匹配选项
- 上下文行显示（显示匹配行前后的行）
- 文件过滤（按文件类型、名称模式等）
- 计数模式（仅显示匹配数量）
- 二进制文件处理选项

### 3. 高级特性
- 嵌入式搜索引擎选项：对于支持的构置，使用bfs/ugrep以提高性能
- 并行搜索：利用多核处理器加速大规模搜索
- 缓存：频繁搜索的结果缓存以提高重复搜索的性能
- 进度指示：长时间搜索的进度反馈
- 中断支持：安全地中断长时间运行的搜索

### 4. 集成优势
- 一致的输出格式，易于机器解析
- 与pi agent工具链的无缝集成
- 与其他工具（如文件编辑、读取）的协同工作
- 错误处理和验证

## 实现方法

这个技能提供了一个如何实现这些增强功能的蓝图。实际的实现需要将GlobTool和GrepTool添加到pi agent的工具集中。

然而，这个技能可以通过以下方式使用：
1. 作为参考文档，用于了解应该实现什么
2. 作为教学工具，帮助用户理解增强的搜索功能
3. 作为原型，这些增强功能可以在此基础上进行构建

## 使用示例

### 示例1：查找特定类型的文件
用户输入：查找src目录下所有的TypeScript文件

GlobTool响应：
```
模式：src/**/*.ts
选项：递归搜索，排除node_modules
结果：
src/components/User.ts
src/services/api.ts
src/utils/helpers.ts
src/components/AdminPanel.tsx
```

### 示例2：带有上下文的内容搜索
用户输入：搜索包含“TODO”或“FIXME”的所有JavaScript文件，显示每个匹配项前后2行

GrepTool响应：
```
模式：(TODO|FIXME)
文件类型：*.js
上下文：2行
结果：
src/utils/helpers.ts:
  15:     // TODO: 添加错误处理
  16:     // 临时解决方案
  17:     return data;
  
  42:     // FIXME: 这个循环效率低下
  43:     for (let i = 0; i < data.length; i++) {
  44:         process(data[i]);
  45:     }
  
src/services/api.ts:
  8:    // TODO: 添加认证中间件
  9:    export const apiClient = axios.create({
  10:     baseURL: process.env.API_URL
  11:   }
```

### 示例3：复杂过滤搜索
用户输入：查找所有修改于过去一周内的Python测试文件，其中包含断言但不包含“skip”

组合响应：
首先使用GlobTool找到最近修改的Python文件：
```
模式：**/*.py
修改时间：过去7天内
结果：
tests/test_user.py
tests/test_api.py
tests/test_utils.py
```

然后在这些文件中使用GrepTool搜索：
```
模式：assert
排除模式：skip
文件列表：来自GlobTool的结果
结果：
tests/test_user.py:
  25:     assert user.is_active == True
  
  67:     assert len(items) > 0
  
tests/test_api.py:
  12:     assert response.status_code == 200
  
  89:     assert data.contains(expectedKey)
```

### 示例4：使用嵌入式搜索引擎
在支持的环境中，搜索自动使用更快的bfs/ugrep：
```
模式：src/**/*.{ts,tsx}
选项：使用嵌入式搜索引擎（bfs）
结果：[快速返回匹配的文件列表]
```

## 与pi agent的集成

要将这些增强功能集成到pi agent中：
1. 将GlobTool添加为一个首选工具
2. 将GrepTool添加为一个首选工具
3. 实施嵌入式搜索引擎选项（bfs/ugrep）以提高性能
4. 添加高级过滤和选项支持
5. 确保与现有工具链的一致输出格式
6. 提供适当的错误处理和验证

此技能作为实施这些更改的规范和参考。
