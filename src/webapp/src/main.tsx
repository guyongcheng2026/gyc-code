import { createRoot } from "react-dom/client"
import "./monaco/setup"
import { App } from "./app/App"
import "./index.css"

createRoot(document.getElementById("root")!).render(<App />)
