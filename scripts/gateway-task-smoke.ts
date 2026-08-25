// 冒烟：/run 真实任务执行链路（轻量任务，验证 spawn gyc run 全流程）
import { Replier } from "../src/gyccode/gateway/reply"

const replier = new Replier()
const result = await replier.reply("smoke-chat", "/run 用一句话回答：gyc-code 项目的 package.json 中 name 字段的值是什么")
console.log("[smoke] /run result:", JSON.stringify(result.slice(0, 300)))
