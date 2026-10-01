import { execFileSync } from "node:child_process"
import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Result, Schema } from "effect"

const decodePack = Schema.decodeResult(
  Schema.fromJsonString(Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })) }))
)

const forbiddenDependencies = {
  router: ["react", "solid-js", "vue", "foldkit", "@effect/atom-react", "@effect/atom-solid", "@effect/atom-vue"],
  "router-react": ["solid-js", "vue", "@effect/atom-solid", "@effect/atom-vue", "@tanstack/"],
  "router-solid": ["react", "vue", "@effect/atom-react", "@effect/atom-vue", "@tanstack/"],
  "router-vue": ["react", "solid-js", "@effect/atom-react", "@effect/atom-solid", "@tanstack/"],
  "router-foldkit": [
    "react",
    "solid-js",
    "vue",
    "@effect/atom-react",
    "@effect/atom-solid",
    "@effect/atom-vue",
    "@tanstack/"
  ]
}

/** @type {Array<[keyof typeof forbiddenDependencies, string[]]>} */
const packages = [
  [
    "router",
    ["index", "Adapter", "Router", "History", "BrowserHistory", "MemoryHistory", "AtomRouter", "Presentation"]
  ],
  ["router-react", ["index"]],
  ["router-solid", ["index"]],
  ["router-vue", ["index"]],
  ["router-foldkit", ["index"]]
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
    const developmentSegments = new Set(["test", "tests", "typetest", "examples", "dev"])
    for (const file of packedFiles) {
      const segments = file.split("/")
      if (segments.some((segment) => developmentSegments.has(segment))) {
        throw new Error(`Development file included in ${name} package: ${file}`)
      }
      if (file.endsWith(".tsbuildinfo") || file.includes(".tsbuildinfo.")) {
        throw new Error(`Build metadata included in ${name} package: ${file}`)
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
