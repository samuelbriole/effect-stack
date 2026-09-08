import { execFileSync } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

await Promise.all([
  ["query", ["index", "Query", "QueryClient", "Mutation", "QueryAtom"]],
  ["router", ["index", "Route", "RouteTree", "RenderPolicy", "History", "BrowserHistory", "MemoryHistory", "Router"]],
  ["router-react", ["index"]],
  ["router-solid", ["index"]],
  ["router-vue", ["index"]]
].map(async ([name, publicModules]) => {
const packageRoot = resolve(import.meta.dirname, `../packages/${name}`)
const root = resolve(packageRoot, "dist")

const pack = JSON.parse(execFileSync("pnpm", ["pack", "--dry-run", "--json"], {
  cwd: packageRoot,
  encoding: "utf8"
}))
const packedFiles = new Set(pack.files.map((file) => file.path))
for (const file of packedFiles) {
  if (
    file.startsWith("examples/") || file.startsWith("test/") || file.startsWith("typetest/") || file.startsWith("integration/")
  ) {
    throw new Error(`Development file included in ${name} package: ${file}`)
  }
}
const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  ...publicModules.flatMap((module) => [`dist/${module}.js`, `dist/${module}.d.ts`])
]
for (const file of requiredFiles) {
  if (!packedFiles.has(file)) {
    throw new Error(`Required file missing from package: ${file}`)
  }
}

JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"))

await Promise.all(publicModules.map((module) => import(pathToFileURL(resolve(root, `${module}.js`)).href)))

const files = await readdir(root, { recursive: true })
const source = (await Promise.all(
  files.filter((file) => file.endsWith(".js")).map((file) => readFile(resolve(root, file), "utf8"))
)).join("\n")

const forbidden = {
  query: ["react", "solid-js", "vue", "@effect/atom-react", "@effect/atom-solid", "@effect/atom-vue", "@tanstack/"],
  router: ["react", "solid-js", "vue", "@effect/atom-react", "@effect/atom-solid", "@effect/atom-vue"],
  "router-react": ["solid-js", "vue", "@effect/atom-solid", "@effect/atom-vue", "@tanstack/"],
  "router-solid": ["react", "vue", "@effect/atom-react", "@effect/atom-vue", "@tanstack/"],
  "router-vue": ["react", "solid-js", "@effect/atom-react", "@effect/atom-solid", "@tanstack/"]
}[name]
for (const dependency of forbidden) {
  if (source.includes(`from "${dependency}`) || source.includes(`from '${dependency}`)) {
    throw new Error(`Renderer dependency found in ${name} output: ${dependency}`)
  }
}
}))
