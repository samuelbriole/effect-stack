import { startExample } from "./start.ts"
import "./styles.css"

const root = document.querySelector("#root")

if (root === null || !(root instanceof HTMLElement)) {
  throw new Error("Missing #root element")
}

startExample(root)
