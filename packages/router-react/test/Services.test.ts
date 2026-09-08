import { MemoryHistory, Router } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter } from "@effect-stack/router-react"
import { describe, expect, it } from "@effect/vitest"
import { Context, Deferred, Effect, Layer } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"

class Connection extends Context.Service<Connection, { readonly name: string }>()("test/Connection") {}
class Projects extends Context.Service<Projects, { readonly getTitle: Effect.Effect<string> }>()("test/Projects") {}

const projectsLayer = Layer.effect(
  Projects,
  Effect.gen(function*() {
    const connection = yield* Connection
    return Projects.of({ getTitle: Effect.succeed(connection.name) })
  })
)

describe("Effect service injection", () => {
  it.effect("releases an idle runtime and constructs fresh services when remounted in the same registry", () =>
    Effect.gen(function*() {
      const released = yield* Deferred.make<void>()
      let acquired = 0
      const layer = Layer.effect(
        Projects,
        Effect.acquireRelease(
          Effect.sync(() => Projects.of({ getTitle: Effect.succeed(`instance-${++acquired}`) })),
          () => Deferred.succeed(released, undefined)
        )
      )
      const route = createRootRoute({ loader: () => Projects.use((projects) => projects.getTitle) })
      const router = createRouter({ routeTree: route, history: MemoryHistory.layer(), layer })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      const unmount = registry.mount(router.core.state)
      expect((yield* AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true })).loaderData).toBe(
        "instance-1"
      )
      unmount()
      yield* Deferred.await(released)
      const unmountAgain = registry.mount(router.core.state)
      expect((yield* AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true })).loaderData).toBe(
        "instance-2"
      )
      unmountAgain()
    }))

  it.effect("shares a composed Layer across ancestor and child loaders and refreshes, then releases it with the registry", () =>
    Effect.gen(function*() {
      let acquired = 0
      let released = 0
      const connectionLayer = Layer.effect(
        Connection,
        Effect.acquireRelease(
          Effect.sync(() => {
            acquired++
            return Connection.of({ name: `connection-${acquired}` })
          }),
          () =>
            Effect.sync(() => {
              released++
            })
        )
      )
      const root = createRootRoute({ loader: () => Connection.use((connection) => Effect.succeed(connection.name)) })
      const child = createRoute({
        getParentRoute: () => root,
        path: "projects",
        loader: () => Projects.use((projects) => projects.getTitle)
      })
      const router = createRouter({
        routeTree: root.addChildren([child]),
        history: MemoryHistory.layer("/projects"),
        layer: Layer.merge(connectionLayer, projectsLayer.pipe(Layer.provide(connectionLayer)))
      })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      yield* AtomRegistry.mount(registry, router.core.branch)
      yield* AtomRegistry.mount(registry, router.core.navigate)
      const resolved = yield* AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true })
      expect(resolved.loaderData).toBe("connection-1")
      expect(
        registry.get(router.core.branch).matches.map((match) =>
          match.result._tag === "Success" ? match.result.value.loaderData : undefined
        )
      ).toEqual(["connection-1", "connection-1"])
      registry.set(router.core.navigate, Router.refresh)
      yield* AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true })
      expect(acquired).toBe(1)
      expect(released).toBe(0)
      const otherRegistry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => otherRegistry.dispose()))
      yield* AtomRegistry.mount(otherRegistry, router.core.state)
      const other = yield* AtomRegistry.getResult(otherRegistry, router.core.state, { suspendOnWaiting: true })
      expect(other.loaderData).toBe("connection-2")
      expect(acquired).toBe(2)
      registry.dispose()
      expect(released).toBe(1)
      expect((yield* AtomRegistry.getResult(otherRegistry, router.core.state)).loaderData).toBe("connection-2")
      otherRegistry.dispose()
      expect(released).toBe(2)
    }))

  it.effect("substitutes service implementations at the composition root", () =>
    Effect.gen(function*() {
      const root = createRootRoute({ loader: () => Projects.use((projects) => projects.getTitle) })
      const router = createRouter({
        routeTree: root,
        history: MemoryHistory.layer(),
        layer: Layer.succeed(Projects, Projects.of({ getTitle: Effect.succeed("Test project") }))
      })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      yield* AtomRegistry.mount(registry, router.core.state)
      const resolved = yield* AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true })
      expect(resolved.loaderData).toBe("Test project")
    }))
})
