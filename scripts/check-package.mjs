import { execFileSync } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const packageRoot = resolve(import.meta.dirname, "../packages/router")
const root = resolve(packageRoot, "dist")
const publicModules = ["index", "Route", "History", "BrowserHistory", "MemoryHistory", "Router"]

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

const forbidden = ["react", "solid-js", "vue", "@effect/atom-react", "@effect/atom-solid"]
for (const dependency of forbidden) {
  if (source.includes(`from "${dependency}`) || source.includes(`from '${dependency}`)) {
    throw new Error(`Renderer dependency found in router output: ${dependency}`)
  }
}
