import { Effect } from "effect"
import { it } from "vitest"
import { expectFinalizationBarrier, runFamilyInvalidation, runQueryIntegration } from "./shared/harness.ts"
import { solidRenderer } from "./shared/renderers.ts"

it("Solid observers share one load, reflect mutation invalidation, and finalize on teardown", async () => {
  expectFinalizationBarrier(await Effect.runPromise(runQueryIntegration(solidRenderer)))
})

it("Solid observers each revalidate once on family-level invalidation", async () => {
  await Effect.runPromise(runFamilyInvalidation(solidRenderer))
})
