# arXiv 是什么与使用方法

> 研究日期：2026-08-01
> 说明：含实测验证的 API 用法与教训（限流处理）

---

## 一、arXiv 是什么

**arXiv**（读作 "archive"，X 代表希腊字母 chi）是**免费开放获取的学术论文预印本（preprint）存档库**，1991 年由 Paul Ginsparg 在洛斯阿拉莫斯国家实验室创建，现由康奈尔大学运营（2024 年起独立非营利机构）。

### 核心事实

| 项目 | 数据 |
|------|------|
| 论文总量 | **近 240 万篇**（官网首页明确标注 "nearly 2.4 million"） |
| 覆盖领域 | 物理、数学、计算机科学、量化生物、量化金融、统计、电气工程与系统科学、经济学 |
| 是否同行评审 | **否**（预印本，发布前无评审，但多数论文后续会发表在正式期刊/会议） |
| 免费 | 完全免费，任何人都可以浏览、下载 |
| 提交 | 研究者可以自由提交论文（部分领域需要 endorsement 背书） |

### 为什么重要
- **AI/计算机领域的事实标准**：最新研究成果通常先发 arXiv，比正式发表早几个月到一年
- 我们刚研究的 DeepSeek-R1（2025-01-22）、Kimi K1.5（同日）都在 arXiv 首发
- 引用格式示例：`arXiv:2503.15113`

### 与 GitHub 的关系
- GitHub 存代码，arXiv 存论文——很多 AI 论文在 arXiv 发文章 + GitHub 放代码
- 例：DeepSeek-R1 论文在 arXiv，代码/模型在 GitHub/HuggingFace

---

## 二、怎么用（四种方式实测）

### 方式1：网页浏览（最简单）

- **主页**：https://arxiv.org — 按领域浏览最新论文
- **搜索**：https://arxiv.org/list/cs.AI/recent（AI 领域最新）或顶部搜索框
- **单篇页面**：https://arxiv.org/abs/<编号> — 查看摘要、作者、下载 PDF
- **编号规则**：`YYMM.NNNNN` 或老式 `YY.NNNNN`，如 `2503.15113` = 2025年3月第15113篇

### 方式2：API 搜索（程序化，实测可用 ✅）

```python
import urllib.request, urllib.parse, re

def search_arxiv(query, max_results=5):
    q = urllib.parse.quote(query)
    url = f'http://export.arxiv.org/api/query?search_query={q}&start=0&max_results={max_results}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        xml = resp.read().decode('utf-8')
    for e in re.findall(r'<entry>(.*?)</entry>', xml, re.S):
        title = re.search(r'<title>(.*?)</title>', e, re.S)
        link = re.search(r'<id>(.*?)</id>', e)
        print(f'- {title.group(1).strip()[:90]}')
        print(f'  {link.group(1) if link else ""}')

search_arxiv('all:"reasoning effort"')
```

**实测结果**（2026-08-01，搜索 "reasoning effort"）：
1. *Reasoning Effort and Problem Complexity: A Scaling Analysis in LLMs*（2025-03）→ arXiv:2503.15113
2. *Ares: Adaptive Reasoning Effort Selection for Efficient LLM Agents*（2026-03）→ arXiv:2603.07915
3. *The Impact of LLM Self-Consistency and Reasoning Effort on Automated Scoring*（2026-04）

### 方式3：直接抓取 abs 页面（无 API 限流，更稳 ✅）

```bash
curl -sL "https://arxiv.org/abs/2503.15113" | grep -E "citation_title|citation_author|citation_date"
```

实测：abs 页面可正常抓取标题/作者/日期/摘要，**没有 API 的 429 限流问题**。

### 方式4：命令行工具（推荐日常用）

```bash
# pip 安装
pip install arxiv

# 基本搜索
python3 -c "
import arxiv
client = arxiv.Client()
search = arxiv.Search(query='all:\"reasoning effort\"', max_results=5)
for r in client.results(search):
    print(r.title, '|', r.entry_id)
"
```

---

## 三、搜索语法速查（API 支持）

| 语法 | 含义 | 示例 |
|------|------|------|
| `all:` | 全字段搜索 | `all:"reasoning effort"` |
| `ti:` | 标题搜索 | `ti:"chain of thought"` |
| `au:` | 作者搜索 | `au:raschka` |
| `abs:` | 摘要搜索 | `abs:reinforcement learning` |
| `cat:` | 领域分类 | `cat:cs.AI`（人工智能）、`cat:cs.CL`（计算语言）、`cat:cs.LG`（机器学习） |
| `AND/OR/NOT` | 逻辑组合 | `ti:agent AND cat:cs.AI` |
| 通配符 | 模糊匹配 | `all:reasoning*` |

### 常用领域分类
- **cs.AI** — 人工智能
- **cs.CL** — 计算与语言（NLP/大模型）
- **cs.LG** — 机器学习
- **cs.SE** — 软件工程
- **cs.CR** — 密码学与安全
- **quant-ph** — 量子物理

---

## 四、实际应用建议（谷工场景）

### 对 ECP/产品研究
1. **竞品技术追踪**：用 `cat:cs.AI AND all:"procurement"` 搜采购智能化论文
2. **AI 落地参考**：搜 `all:"supply chain" AND cat:cs.LG` 看供应链 AI 研究
3. **政策-技术对照**：53 号文的数字化采购要求，可在 arXiv 找技术实现佐证

### 对 Hermes/个人学习
1. **每日前沿**：订阅 cs.AI 的 RSS（https://rss.arxiv.org/rss/cs.AI）自动跟进
2. **研究深挖**：我们刚研究的推理档位主题，arXiv 上已有 3 篇直接相关论文（含 Ares 自适应档位选择——正是文章结尾说的"未来方向"）
3. **可保存为技能**：本研究的 API 脚本可固化为 `arxiv-search` 技能，下次直接调用

### ⚠️ 关键教训（限流）
- **API 限流极严格**：官方要求每 3 秒最多 1 个请求；实测同一 IP 连发 2-3 次就被 429 封锁（可能持续 30-60 秒）
- **正确姿势**：①每次请求间隔 ≥5 秒；②设置 `User-Agent` 标识；③批量抓取用 abs 页面而非 API；④脚本内加重试机制
- **备选方案**：abs 页面直抓、RSS 订阅、`pip install arxiv` 库（自带限流处理）

---

## 五、一句话总结

> **arXiv 是 AI 研究的"新闻联播"——最新成果先在这里发布。**
> 用法四选一：网页逛（懒人）、API 搜（程序）、abs 直抓（稳定）、pip 库（正式）。
> 记住限流纪律：**慢一点，稳一点**。

---

*研究：小翎 | 2026-08-01*
