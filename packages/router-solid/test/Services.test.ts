import { MemoryHistory, Router } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter } from "@effect-stack/router-solid"
import { describe, expect, it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"

class Projects extends Context.Service<Projects, { readonly instance: number }>()("test/Projects") {}

describe("Solid Effect service injection", () => {
  it.effect("shares scoped services across matches and refreshes, isolates registries, and releases resources", () =>
    Effect.gen(function*() {
      let acquired = 0
      let released = 0
      const layer = Layer.effect(
        Projects,
        Effect.acquireRelease(
          Effect.sync(() => Projects.of({ instance: ++acquired })),
          () =>
            Effect.sync(() => {
              released++
            })
        )
      )
      const root = createRootRoute({ loader: () => Projects.use((projects) => Effect.succeed(projects.instance)) })
      const child = createRoute({
        getParentRoute: () => root,
        path: "child",
        loader: () => Projects.use((projects) => Effect.succeed(projects.instance))
      })
      const router = createRouter({
        routeTree: root.addChildren([child]),
        history: MemoryHistory.layer("/child"),
        layer
      })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      yield* AtomRegistry.mount(registry, router.core.branch)
      yield* AtomRegistry.mount(registry, router.core.navigation)
      yield* AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true })
      expect(
        registry.get(router.core.branch).matches.map((entry) =>
          entry.result._tag === "Success" ? entry.result.value.loaderData : undefined
        )
      ).toEqual([1, 1])
      yield* router.core.execute(Router.refresh).pipe(
        Effect.provideService(AtomRegistry.AtomRegistry, registry)
      )
      expect(acquired).toBe(1)
      expect(released).toBe(0)
      const other = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => other.dispose()))
      yield* AtomRegistry.mount(other, router.core.state)
      expect((yield* AtomRegistry.getResult(other, router.core.state, { suspendOnWaiting: true })).loaderData).toBe(2)
      registry.dispose()
      expect(released).toBe(1)
      expect((yield* AtomRegistry.getResult(other, router.core.state)).loaderData).toBe(2)
      other.dispose()
      expect(released).toBe(2)
    }))
})
