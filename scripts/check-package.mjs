import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(import.meta.dirname, "../packages/router/dist")
const publicModules = ["index", "Route", "History", "BrowserHistory", "MemoryHistory", "Router"]

await Promise.all(publicModules.map((module) => import(pathToFileURL(resolve(root, `${module}.js`)).href)))

const files = await readdir(root)
const source = (await Promise.all(
  files.filter((file) => file.endsWith(".js")).map((file) => readFile(resolve(root, file), "utf8"))
)).join("\n")

const forbidden = ["react", "solid-js", "vue", "@effect/atom-react", "@effect/atom-solid"]
for (const dependency of forbidden) {
  if (source.includes(`from "${dependency}`) || source.includes(`from '${dependency}`)) {
    throw new Error(`Renderer dependency found in router output: ${dependency}`)
  }
}
