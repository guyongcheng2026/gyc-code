# 高级LSP特性 (advanced-lsp)

## 功能概述
这个技能展示了如何增强pi agent的代码编辑能力，通过提供高级的语言服务器协议(LSP)特性来提供：
1. 高级重构工具（提取方法、移动类、更改签名等）
2. 代码操作和快速修复（生成代码、添加缺失的导入等）
3. 高级导航和搜索（层次结构视图、类型定义、实现等）
4. 代码生成和模板
5. 诊断和错误修复的增强功能
6. 与现有编辑工具和架构的集成

## 当前限制
pi agent目前的LSP能力基础：
- 基本的自动补全
- 基本的转到定义
- 基本的悬停信息
- 基本的诊断显示
- 缺少高级重构和代码操作功能
- 缺少代码生成和模板功能
- 缺少高级导航特性（如类型层次结构、实现列表等）

## 增强功能

### 1. 高级重构工具
提供强大的代码重构能力：
- **提取方法**：将选定的代码块提取为新方法
- **内联方法**：将方法调用替换为其实现
- **移动成员**：将方法或字段移动到另一个类
- **更改签名**：修改方法的参数、返回值等
- **重命名**：安全地重命名变量、方法、类等（更新所有引用）
- **提取接口**：从类中提取接口
- **实现接口**：自动实现接口方法
- **包装 try/catch**：将代码块包装在try/catch中
- **封装字段**：将公共字段封装为带getter/setter的私有字段

### 2. 代码操作和快速修复
提供智能的代码生成和修复建议：
- **生成构造函数**：根据字段生成构造函数
- **生成Getter/Setter**：根据字段生成访问器方法
- **实现抽象方法**：自动实现抽象类或接口的方法
- **添加缺失的导入**：自动添加未导入但使用的类型
- **移除未使用的导入**：清理不再需要的导入
- **添加缺失的案例**：在switch语句中添加缺失的case
- **合并相邻的条件**：合并可以合并的if语句
- **分解长表达式**：将复杂表达式分解为多个步骤
- **替换三元运算符**：在适用时将三元运算符替换为if/else
- **包装/解包**：在表达式周围添加或移除括号

### 3. 高级导航和搜索
提供超越基本定义和引用的导航功能：
- **类型层次结构**：显示类型的继承和子类关系
- **方法层次结构**：显示方法的重写和实现关系
- **调用层次结构**：显示谁调用了此方法以及此方法调用了谁
- **类型定义**：跳转到类型的定义（而非仅仅是声明）
- **实现列表**：查找接口或抽象方法的所有实现
- **引用搜索**：高级的引用搜索，带过滤和分组
- **符号搜索**：在工作区中搜索符号（按类型、名称等）
- **文件搜索**：按名称搜索文件（支持通配符）

### 4. 代码生成和模板
提供智能的代码生成能力：
- **基于模板的生成**：使用自定义或内置模板生成代码
- **构造函数生成**：根据字段生成构造函数
- **TOString生成**：生成对象的字符串表示方法
- **哈希和相等生成**：生成hashCode和equals方法
- **访问者模式生成**：生成访问者模式相关代码
- **委托模式生成**：生成委托模式相关代码
- **getter/setter生成**：根据字段生成访问器方法
- **接口生成**：根据类生成相应的接口
- **包装类生成**：根据基本类型生成包装类

### 5. 增强的诊断和错误修复
提供更智能的错误检查和修复建议：
- **错误解释**：提供详细的错误原因和解决方案
- **多种修复选项**：为同一错误提供多种可能的修复
- **上下文感知的修复**：根据周围代码提供更好的修复建议
- **自动错误修复**：在安全的情况下自动应用修复
- **错误趋势分析**：识别重复出现的错误模式
- **预防性建议**：基于常见错误提供预防性建议

### 6. 与架构和工具的集成
- 与协调者-工作者模式集成：
  - 高级LSP特性可以用于规划代理进行代码分析
  - 验证代理可以利用高级导航进行深入检查
  - 工作者可以使用重构工具进行安全的代码修改
- 与编辑工具集成：
  - 高级LSP特性直接增强编辑体验
  - 重构和代码操作可以通过编辑工具的界面访问
  - 导航功能可以与文件搜索和内容搜索集成
- 与任务管理集成：
  - 重构操作可以作为任务执行
  - 代码生成可以作为后台任务运行
  - 大规模代码更改可以分解为多个任务

## 实现方法

这个技能提供了一个如何实现这些增强功能的蓝图。实际的实现需要：
1. 增强LSP客户端以支持高级特性
2. 实施重构引擎和代码操作处理器
3. 添加高级导航和搜索功能
4. 实现代码生成和模板系统
5. 增强诊断和错误修复能力
6. 与现有编辑工具、架构和任务管理系统集成
7. 提供用于配置LSP行为和特性的选项

然而，这个技能可以通过以下方式使用：
1. 作为参考文档，用于了解应该实现什么
2. 作为教学工具，帮助用户理解高级LSP特性的好处
3. 作为原型，这些增强功能可以在此基础上进行构建

## 使用示例

### 示例1：安全的重构操作
用户想要提取一个复杂的代码块为新方法：

高级LSP响应：
```
选中要提取的代码块：
    double total = 0;
    for (Item item : items) {
        if (item.isActive()) {
            total += item.getPrice() * item.getQuantity();
        }
    }
    return total;

高级LSP建议：
- 方法名称：calculateTotalPrice
- 参数：List<Item> items
- 返回类型：double
- 修改影响：1处调用将被替换为新方法调用
- 预览：
  新方法：
  private double calculateTotalPrice(List<Item> items) {
      double total = 0;
      for (Item item : items) {
          if (item.isActive()) {
              total += item.getPrice() * item.getQuantity();
          }
      }
      return total;
  }

  原始位置：
  double total = calculateTotalPrice(items);
  return total;

是否应用此重构？(y/n)
```

### 示例2：智能代码操作
用户在使用未导入的类时：

高级LSP响应：
```
代码：List<String> names = new ArrayList<>();
      names.add("John");
      names.add("Jane");

诊断：未导入类型 'List' 和 'ArrayList'
快速修复选项：
1. 导入 java.util.List 和 java.util.ArrayList
2. 将 List<String> 更改为 ArrayList<String> 并仅导入 java.util.ArrayList
3. 使用数组初始化器：String[] names = {"John", "Jane"}

选项1预览：
import java.util.List;
import java.util.ArrayList;

List<String> names = new ArrayList<>();
names.add("John");
names.add("Jane");

是否应用选项1？(y/n)
```

### 示例3：高级导航
用户想要查看一个方法的所有实现：

高级LSP响应：
```
方法：processPayment(Payment payment)
位置：src/payment/PaymentProcessor.java:45

查找实现...
找到 3 个实现：

1. CreditCardPaymentProcessor.processPayment()
   位置：src/payment/creditcard/CreditCardPaymentProcessor.java:32
   描述：处理信用卡支付，包括验证和授权步骤

2. PayPalPaymentProcessor.processPayment()
   位置：src/payment/paypal/PayPalPaymentProcessor.java:28
   描述：通过PayPal API处理支付，包含错误处理和重试逻辑

3. BankTransferPaymentProcessor.processPayment()
   位置：src/payment/banktransfer/BankTransferPaymentProcessor.java:41
   描述：处理银行转账，包括银行验证和结算步骤

导航选项：
- 查看特定实现的源码
- 比较所有实现的相似ities和差异
- 生成实现关系图
```

### 示例4：代码生成
用户想要根据字段生成构造函数：

高级LSP响应：
```
类：User
字段：
- private String userId;
- private String email;
- private LocalDateTime createdAt;

代码生成选项：
1. 生成包含所有字段的构造函数
2. 生成仅包含必填字段的构造函数
3. 生成构造函数和Getter/Setter
4. 使用Builder模式生成构造函数

选项1预览：
public User(String userId, String email, LocalDateTime createdAt) {
    this.userId = userId;
    this.email = email;
    this.createdAt = createdAt;
}

是否生成选项1？(y/n)
```

## 与pi agent的集成

要将这些增强功能集成到pi agent中：
1. 增强LSP客户端以支持高级特性
2. 实施重构引擎和代码操作处理器
3. 添加高级导航和搜索功能
4. 实现代码生成和模板系统
5. 增强诊断和错误修复能力
6. 与现有编辑工具、架构和任务管理系统集成
7. 提供用于配置LSP行为和特性的选项
8. 确保适当的错误处理和后备机制

此技能作为实施这些更改的规范和参考。
