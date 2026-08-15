import { createRoot } from "react-dom/client"
import { App } from "./app/App"
import "./index.css"

// monaco 由 FileViewer/DiffView 按需动态加载（见 ../monaco/setup 与各自组件），
// 避免打开页面即下载 2.7MB 编辑器内核。
createRoot(document.getElementById("root")!).render(<App />)
