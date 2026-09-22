import { execFileSync } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Result, Schema } from "effect"

const decodePack = Schema.decodeResult(
  Schema.fromJsonString(Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })) }))
)

const forbiddenDependencies = {
  router: ["react", "solid-js", "vue", "@effect/atom-react", "@effect/atom-solid", "@effect/atom-vue"],
  "router-react": ["solid-js", "vue", "@effect/atom-solid", "@effect/atom-vue", "@tanstack/"],
  "router-solid": ["react", "vue", "@effect/atom-react", "@effect/atom-vue", "@tanstack/"],
  "router-vue": ["react", "solid-js", "@effect/atom-react", "@effect/atom-solid", "@tanstack/"]
}

/** @type {Array<[keyof typeof forbiddenDependencies, string[]]>} */
const packages = [
  ["router", ["index", "Router", "History", "BrowserHistory", "MemoryHistory", "AtomRouter"]],
  ["router-react", ["index"]],
  ["router-solid", ["index"]],
  ["router-vue", ["index"]]
]

await Promise.all(
  packages.map(async ([name, publicModules]) => {
    const packageRoot = resolve(import.meta.dirname, `../packages/${name}`)
    const root = resolve(packageRoot, "dist")

    const pack = Result.getOrThrow(
      decodePack(
        execFileSync("pnpm", ["pack", "--dry-run", "--json"], {
          cwd: packageRoot,
          encoding: "utf8"
        })
      )
    )
    const packedFiles = new Set(pack.files.map((file) => file.path))
    for (const file of packedFiles) {
      if (file.startsWith("examples/") || file.startsWith("test/") || file.startsWith("typetest/")) {
        throw new Error(`Development file included in ${name} package: ${file}`)
      }
    }
    const builtFiles = (await readdir(root, { recursive: true })).filter(
      (file) => file.endsWith(".js") || file.endsWith(".d.ts")
    )
    const requiredFiles = [
      "package.json",
      "README.md",
      "LICENSE",
      ...publicModules.flatMap((module) => [`dist/${module}.js`, `dist/${module}.d.ts`]),
      ...builtFiles.map((file) => `dist/${file}`)
    ]
    for (const file of requiredFiles) {
      if (!packedFiles.has(file)) {
        throw new Error(`Required file missing from package: ${file}`)
      }
    }

    JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"))

    await Promise.all(publicModules.map((module) => import(pathToFileURL(resolve(root, `${module}.js`)).href)))

    const source = (
      await Promise.all(
        builtFiles.filter((file) => file.endsWith(".js")).map((file) => readFile(resolve(root, file), "utf8"))
      )
    ).join("\n")

    const forbidden = forbiddenDependencies[name]
    for (const dependency of forbidden) {
      if (source.includes(`from "${dependency}`) || source.includes(`from '${dependency}`)) {
        throw new Error(`Renderer dependency found in ${name} output: ${dependency}`)
      }
    }
  })
)
