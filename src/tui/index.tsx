import { forceWcwidth } from "./util/width-method"

// 必须先于任何 @opentui 渲染器创建：统一原生/JS 宽度口径，消除 CJK 乱码
forceWcwidth()

export { run, type TuiInput } from "./app"
