import { RegistryProvider } from "@effect/atom-solid"
import { render } from "solid-js/web"
import { App } from "./App.tsx"
import "./styles.css"

const root = document.querySelector("#root")

if (root === null) {
  throw new Error("Missing #root element")
}

render(() => (
  <RegistryProvider>
    <App />
  </RegistryProvider>
), root)
