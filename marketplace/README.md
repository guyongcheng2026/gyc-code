# gyc 插件市场

gyc-code 的自研插件市场。registry 地址：`https://plugins.gyc-code.dev`（客户端可用 `GYCCODE_PLUGIN_REGISTRY` 覆盖指向镜像/本地）。

## 目录结构

```
marketplace/
├── index.json            # 市场索引（PluginEntry 数组，客户端 fetchIndex 读取）
├── pkg/
│   ├── <name>/<version>.tgz   # 插件包（npm pack 格式，客户端 install 下载）
└── plugins/
    ├── gyc-hello/        # 示例插件：hello 工具
    └── gyc-workspace-stats/   # 实用插件：工作区文件/行数统计
```

## 命令

```bash
# 构建市场内容（npm pack + 生成 index.json）
bun scripts/build-marketplace.mjs

# 本地托管市场（默认 8790 端口）
bun scripts/serve-marketplace.mjs [端口]

# 客户端使用（指向本地市场）
GYCCODE_PLUGIN_REGISTRY=http://localhost:8790/index.json gyc plugin search stats
GYCCODE_PLUGIN_REGISTRY=http://localhost:8790/index.json gyc plugin list
```

## 发布新插件

1. 在 `marketplace/plugins/<name>/` 下创建插件：`package.json`（`engines.gyccode` 声明兼容版本）+ 入口文件（`export default` 插件对象，可注册 `tool`/`event`/`chat.*` 等 hook）
2. 运行 `bun scripts/build-marketplace.mjs` 打包并刷新索引
3. 部署：将 `marketplace/` 目录托管为静态站点（GitHub Pages / Cloudflare Pages / 自建 Nginx），确保 `plugins.gyc-code.dev` 解析到该站点
4. 可选：`npm publish` 同名包，支持 `gyc plugin <name>` 直接 npm 安装

## 插件接口

插件为 npm 包格式，入口默认导出 `Plugin`（见 `src/protocol/plugin/index.d.ts`）：

```js
import { tool } from "@gyccode/protocol/plugin/tool"

export default async function myPlugin() {
  return {
    tool: {
      my_tool: tool({
        description: "工具说明",
        args: { keyword: tool.schema.string().describe("关键词") },
        async execute(args, ctx) {
          return { title: "my_tool", output: `结果：${args.keyword}` }
        },
      }),
    },
  }
}
```

- `ctx.worktree` / `ctx.directory`：项目根/会话目录，优先于 `process.cwd()`
- 常用 hook：`tool`（自定义工具）、`event`（会话事件）、`chat.params`（改写 LLM 参数）、`permission.ask`（权限拦截）
