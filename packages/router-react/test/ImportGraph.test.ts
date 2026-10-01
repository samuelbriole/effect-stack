import { fileURLToPath } from "node:url"
import { build, type Rollup } from "vite"
import { describe, expect, it } from "vitest"

/**
 * Bundler-graph evidence that the type-only navigation helper has no runtime
 * dependency on application assembly or route definition modules. The helper
 * module type-imports the application, so the emitted chunk must not include any
 * application/route/lazy module id — not merely omit their string literals.
 */
const chunkOf = (result: Awaited<ReturnType<typeof build>>): { code: string; moduleIds: ReadonlyArray<string> } => {
  const bundles = (Array.isArray(result) ? result : [result]) as ReadonlyArray<
    Rollup.RollupOutput | Rollup.RollupWatcher
  >
  for (const bundle of bundles) {
    if ("output" in bundle && Array.isArray(bundle.output)) {
      const chunks = bundle.output.filter((chunk): chunk is Rollup.OutputChunk => chunk.type === "chunk")
      return {
        code: chunks.map((chunk) => chunk.code).join("\n"),
        moduleIds: chunks.flatMap((chunk) => chunk.moduleIds ?? Object.keys(chunk.modules ?? {}))
      }
    }
  }
  return { code: "", moduleIds: [] }
}

describe("navigation import graph", () => {
  it("bundles shared target resolution without app assembly or route definition modules", async () => {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        ssr: true,
        rollupOptions: {
          input: fileURLToPath(new URL("./fixture/nav/navigation.tsx", import.meta.url)),
          external: [/^react(\/|$)/, /^react-dom(\/|$)/, /^effect(\/|$)/, "@effect/atom-react"],
          output: { format: "es", entryFileNames: "out.js" }
        }
      }
    })
    const { code, moduleIds } = chunkOf(result)
    expect(code.length).toBeGreaterThan(0)
    // The navigation helper itself is bundled...
    expect(moduleIds.some((id) => id.includes("internal/navigation"))).toBe(true)
    // ...but no application assembly, route module, or lazily imported target
    // is part of the emitted module graph.
    const forbidden = [
      "fixture/nav/app",
      "fixture/nav/routes",
      "fixture/nav/project",
      "fixture/nav/foreign-app",
      "lazy-target"
    ]
    for (const id of moduleIds) {
      for (const marker of forbidden) {
        expect(id).not.toContain(marker)
      }
    }
    // String-level guard as well, in case a module was inlined without an id.
    expect(code).not.toContain("NavBoundary")
    expect(code).not.toContain("Projects layout")
    expect(code).not.toContain("Lazy page")
    expect(code).toContain("resolveNavigationTarget")
    expect(moduleIds.some((id) => id.includes("router/src/internal/destinations"))).toBe(true)
  })
})
