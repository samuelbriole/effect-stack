import { execFileSync } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

await Promise.all([
  ["router", ["index", "Route", "RouteTree", "History", "BrowserHistory", "MemoryHistory", "Router"]],
  ["router-react", ["index"]]
].map(async ([name, publicModules]) => {
const packageRoot = resolve(import.meta.dirname, `../packages/${name}`)
const root = resolve(packageRoot, "dist")

const pack = JSON.parse(execFileSync("pnpm", ["pack", "--dry-run", "--json"], {
  cwd: packageRoot,
  encoding: "utf8"
}))
const packedFiles = new Set(pack.files.map((file) => file.path))
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

const files = await readdir(root)
const source = (await Promise.all(
  files.filter((file) => file.endsWith(".js")).map((file) => readFile(resolve(root, file), "utf8"))
)).join("\n")

const forbidden = name === "router" ? ["react", "solid-js", "vue", "@effect/atom-react", "@effect/atom-solid", "@effect/atom-vue"] : ["solid-js", "vue", "@tanstack/"]
for (const dependency of forbidden) {
  if (source.includes(`from "${dependency}`) || source.includes(`from '${dependency}`)) {
    throw new Error(`Renderer dependency found in ${name} output: ${dependency}`)
  }
}
}))
