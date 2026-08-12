# -*- coding: utf-8 -*-
"""阶段 3 品牌清理：替换品牌暴露字符串（字节级，不动换行符）"""
import io, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (文件相对路径, [(旧字节, 新字节)])
REPLACEMENTS = {
    # --- Referer 头（发给第三方 LLM 服务商的流量来源标识） ---
    "src/core/plugin/provider/kilo.ts":        [('"https://opencode.ai/"', '"https://gyccode.ai/"')],
    "src/core/plugin/provider/llmgateway.ts":  [('"https://opencode.ai/"', '"https://gyccode.ai/"')],
    "src/core/plugin/provider/nvidia.ts":      [('"https://opencode.ai/"', '"https://gyccode.ai/"')],
    "src/core/plugin/provider/openrouter.ts":  [('"https://opencode.ai/"', '"https://gyccode.ai/"')],
    "src/core/plugin/provider/vercel.ts":      [('"https://opencode.ai/"', '"https://gyccode.ai/"')],
    "src/core/plugin/provider/zenmux.ts":      [('"https://opencode.ai/"', '"https://gyccode.ai/"')],
    "src/gyccode/provider/provider.ts":        [('"https://opencode.ai/"', '"https://gyccode.ai/"')],
    # --- MCP OAuth 客户端标识 ---
    "src/gyccode/mcp/oauth-provider.ts":       [('client_uri: "https://opencode.ai"', 'client_uri: "https://gyccode.ai"')],
    # --- $schema（写入用户配置，用户可见） ---
    "src/gyccode/config/config.ts":            [('https://opencode.ai/config.json', 'https://gyccode.ai/config.json')],
    "src/gyccode/config/tui-migrate.ts":       [('https://opencode.ai/tui.json', 'https://gyccode.ai/tui.json')],
    # --- 注释/文案 ---
    "src/core/session/runner/publish-llm-event.ts": [('models.dev / opencode convention', 'models.dev convention')],
    "src/gyccode/provider/transform.ts":       [('(e.g. opencode) expose', '(e.g. gyccode) expose')],
    "src/gyccode/session/prompt.ts":           [('如 opencode 上的 gemini', '如 gyccode 上的 gemini')],
    "src/gyccode/session/retry.ts":            [('opencode 等免费模型', 'gyccode 等免费模型')],
    # --- v1 配置文档注释（用户可见） ---
    "src/core/v1/config/config.ts":            [('see https://opencode.ai/docs/commands', 'see gyccode docs'),
                                                ('see https://opencode.ai/docs/agents', 'see gyccode docs')],
}

total = 0
for rel, pairs in REPLACEMENTS.items():
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        print(f"[缺失] {rel}")
        continue
    with open(path, "rb") as f:
        data = f.read()
    for old, new in pairs:
        ob, nb = old.encode("utf-8"), new.encode("utf-8")
        n = data.count(ob)
        if n == 0:
            print(f"[未命中] {rel}: {old}")
            continue
        data = data.replace(ob, nb)
        total += n
        print(f"[OK] {rel}: {n} 处  {old} -> {new}")
    with open(path, "wb") as f:
        f.write(data)

print(f"\n合计替换 {total} 处")
