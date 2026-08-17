import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { TooManyRequestsError } from "../errors"

/**
 * 全局限流中间件：按请求方（Basic 用户名，未认证记为 anonymous）做令牌桶限速。
 * Protocol 只负责声明与错误类型，具体限流参数由 Server 侧实现注入。
 */
export class RateLimit extends HttpApiMiddleware.Service<RateLimit>()("@gyccode/HttpApiRateLimit", {
  error: TooManyRequestsError,
}) {}
