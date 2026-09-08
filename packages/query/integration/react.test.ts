import { Effect } from "effect"
import { it } from "vitest"
import { expectFinalizationBarrier, runFamilyInvalidation, runQueryIntegration } from "./shared/harness.ts"
import { reactRenderer } from "./shared/renderers.ts"

it("React observers share one load, reflect mutation invalidation, and finalize on teardown", async () => {
  expectFinalizationBarrier(await Effect.runPromise(runQueryIntegration(reactRenderer)))
})

it("React observers each revalidate once on family-level invalidation", async () => {
  await Effect.runPromise(runFamilyInvalidation(reactRenderer))
})
