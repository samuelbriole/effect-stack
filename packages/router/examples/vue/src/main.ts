import { AtomRegistry, registryKey } from "@effect/atom-vue"
import { createApp } from "vue"
import App from "./App.vue"
import "./styles.css"

const root = document.querySelector("#root")

if (root === null) {
  throw new Error("Missing #root element")
}

const registry = AtomRegistry.make()
const app = createApp(App)

app.provide(registryKey, registry)
app.onUnmount(() => registry.dispose())
app.mount(root)
