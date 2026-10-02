/**
 * 免费模型清单与零配置回退（A-29-1）。
 *
 * 背景：此前「无需 key 即可跑」的路径只在 gyccode 自有 provider 内隐式成立——
 * provider.ts 会删掉所有 cost.input !== 0 的模型再以 { apiKey: "public" } 匿名调用。
 * 但有两个问题：
 *  1. 用户没有渠道知道自己拿到的是哪些模型（UI 的「免费」标注要逐个模型翻）。
 *  2. 没有配置模型时没有兜底，用户装完仍必须先走 /connect，PLG 第一道门槛没跨过去。
 *
 * 这里把「哪些模型免费」显式化，并提供无配置时的回退选择。
 */

/**
 * 已知可匿名调用的免费模型，按推荐优先级排列（顺序即回退优先级）。
 * 仅为「兜底首选」用；实际可用集合仍以 provider 在无凭据时暴露的模型为准，
 * 避免清单与上游实际能力脱节时把用户指向不可用的模型。
 */
export const FREE_MODELS: ReadonlyArray<string> = [
  "gyccode/glm-4.5-air",
  "gyccode/deepseek-v3.2",
]

/** 最小模型信息形状：只需要知道定价，用于判断免费 */
type CostLike = { cost?: { input?: number } }
type ModelsLike = Record<string, CostLike>

/** 该模型是否免费：定价输入价为 0（priced=false 即价格未知，不在此列） */
function isFreeByCost(model: CostLike | undefined): boolean {
  return model?.cost?.input === 0
}

/** 是否在显式清单内 */
export function isFreeModel(modelID: string): boolean {
  return FREE_MODELS.includes(modelID)
}

/**
 * 在可用模型中挑一个免费模型作为零配置默认值。
 * 优先按 FREE_MODELS 清单顺序，其次按传入顺序兜底。
 * 没有免费模型时返回 undefined —— 不硬凑一个付费模型冒充免费。
 */
export function pickDefaultFreeModel(models: ModelsLike): string | undefined {
  for (const preferred of FREE_MODELS) {
    const model = models[preferred]
    if (model !== undefined && isFreeByCost(model)) return preferred
  }
  return Object.keys(models).find((id) => isFreeByCost(models[id]))
}