import { MemoryHistory, Router, RouteTree } from "@effect-stack/router"
import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"

describe("navigation review regressions", () => {
  it.effect("publishes self-interruption as a terminal branch failure", () =>
    Effect.gen(function*() {
      const tree = RouteTree.root({ loader: () => Effect.interrupt })
      const router = Router.fromTree({ routeTree: tree, layer: MemoryHistory.layer() })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      yield* AtomRegistry.mount(registry, router.branch)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(Effect.exit)
      const result = registry.get(router.branch).matches[0].result
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") expect(Cause.hasInterruptsOnly(result.cause)).toBe(true)
      expect(result.waiting).toBe(false)
    }))
})
