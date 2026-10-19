# 2026-10-18 conditional-cache 路径修复与并发 body 独占

## 背景

`src/protocol/conditional-cache.ts` 是条件 GET 缓存 fetch 包装器（ETag/If-None-Match），
配合服务端 `GET /api/provider` 响应使用。

## 发现的两个缺陷

### 1. CACHEABLE_PATH 路径不匹配（缓存从未生效）

- 常量写的是 `"/provider"`，但生产实际路径是 `/api/provider`
- `url.pathname !== CACHEABLE_PATH` 恒为 true，所有请求直接透传 `fetchImpl`
- 条件缓存从未生效，供应商目录每次全量拉取
- 修复：常量改为 `"/api/provider"`

### 2. 并发 awaiter 共享 Response 导致 Body already read

- inFlight 去重让多个并发请求共享同一个 Response
- `Response.body` 是独占流，第二个消费方读 body 报 "Body already read"
- 修复：`return promise.then((res) => res.clone())`，每个 awaiter 持有独立 clone

### 3. stopRotationGuard 死代码

- `logging.ts` 中 `stopRotationGuard` 全仓零调用方
- 修复：移除，注释保留"不提供 clear 路径"的原设计说明

## 验证

- `conditional-cache.test.ts` 4 项：并发去重、缓存回放、304 路径、无 etag 去重
- `weixin-write-observability.test.ts` 2 项源码断言
- `bun run tsc --noEmit`：0 错误
- `bun run test`：2173 pass / 9 skip / 0 fail
- `bun run build`：dist 编译成功，补丁链 6/6 全绿
