import { createApp } from "vue"
import App from "./App.vue"
import "./styles.css"

const root = document.querySelector("#root")

if (root === null) {
  throw new Error("Missing #root element")
}

const app = createApp(App)

app.mount(root)
