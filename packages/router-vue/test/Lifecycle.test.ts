// @vitest-environment happy-dom
import { type History, MemoryHistory, Router } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@effect-stack/router-vue"
import { Context, Deferred, Effect, Layer } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { describe, expect, it } from "vitest"
import { h, nextTick, render, type VNode } from "vue"

describe.sequential("Vue runtime ownership", () => {
  it("interrupts nested lazy work on navigation and ignores late modules", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const stopped = Effect.runSync(Deferred.make<void>())
    let complete!: (value: { default: () => VNode }) => void
    const module = new Promise<{ default: () => VNode }>((resolve) => {
      complete = resolve
    })
    const root = createRootRoute({ component: () => h("main", [h("h1", "Shell"), h(Outlet)]) })
    const home = createRoute({ getParentRoute: () => root, path: "/", component: () => h("p", "Home") })
    const parent = createRoute({ getParentRoute: () => root, path: "parent", component: Outlet })
    const lazy = createRoute({
      getParentRoute: () => parent,
      path: "lazy",
      pendingComponent: () => h("p", "Pending"),
      lazy: () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => Deferred.succeed(stopped, undefined))
          yield* Deferred.succeed(started, undefined)
          return yield* Effect.promise(() => module)
        })
    })
    const router = createRouter({
      routeTree: root.addChildren([home, parent.addChildren([lazy])]),
      history: MemoryHistory.layer("/parent/lazy")
    })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    render(h(RouterProvider<typeof router.routeTree, History.HistoryError>, { router, registry }), container)
    try {
      await Effect.runPromise(Deferred.await(started))
      await nextTick()
      expect(container.textContent).toBe("ShellPending")
      await Effect.runPromise(
        router.core
          .execute(Router.push(home, { params: {}, search: {}, hash: "" }))
          .pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
      )
      await Effect.runPromise(Deferred.await(stopped))
      await nextTick()
      expect(container.textContent).toBe("ShellHome")
      complete({ default: () => h("p", "Stale") })
      await module
      await nextTick()
      expect(container.textContent).toBe("ShellHome")
    } finally {
      render(null, container)
      registry.dispose()
    }
  })

  it("disposes owned registries and finalizes pending loaders on unmount", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const finalized = Effect.runSync(Deferred.make<void>())
    const root = createRootRoute({
      loader: () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => Deferred.succeed(finalized, undefined))
          yield* Deferred.succeed(started, undefined)
          return yield* Effect.never
        })
    })
    const router = createRouter({ routeTree: root, history: MemoryHistory.layer() })
    const container = document.createElement("div")
    render(h(RouterProvider<typeof root, History.HistoryError>, { router }), container)
    try {
      await Effect.runPromise(Deferred.await(started))
    } finally {
      render(null, container)
    }
    await Effect.runPromise(Deferred.await(finalized))
  })

  it("shares scoped services, isolates registries, and remounts when router or registry changes", async () => {
    class Service extends Context.Service<Service, { readonly instance: number }>()("test/Service") {}
    let acquired = 0
    let released = 0
    const layer = Layer.effect(
      Service,
      Effect.acquireRelease(Effect.sync(() => Service.of({ instance: ++acquired })), () =>
        Effect.sync(() => {
          released++
        }))
    )
    const root = createRootRoute({
      loader: () => Service.use((service) => Effect.succeed(service.instance)),
      component: Outlet
    })
    const child = createRoute({
      getParentRoute: () => root,
      path: "/",
      loader: () => Service.use((service) => Effect.succeed(service.instance)),
      component: () => h("p", "First")
    })
    const router = createRouter({ routeTree: root.addChildren([child]), history: MemoryHistory.layer(), layer })
    const registry = AtomRegistry.make()
    const other = AtomRegistry.make()
    const container = document.createElement("div")
    const second = document.createElement("div")
    const provider = RouterProvider<typeof router.routeTree, History.HistoryError>
    try {
      render(h(provider, { router, registry }), container)
      await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
      expect(
        registry.get(router.core.branch).matches.map((entry) =>
          entry.result._tag === "Success" ? entry.result.value.loaderData : undefined
        )
      ).toEqual([1, 1])
      await Effect.runPromise(
        router.core.execute(Router.refresh).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
      )
      expect(acquired).toBe(1)
      render(h(provider, { router, registry: other }), second)
      expect(
        (await Effect.runPromise(AtomRegistry.getResult(other, router.core.state, { suspendOnWaiting: true })))
          .loaderData
      ).toBe(2)
      render(h(provider, { router, registry: other }), container)
      await nextTick()
      expect(container.textContent).toBe("First")
      registry.dispose()
      expect(released).toBe(1)
      expect((await Effect.runPromise(AtomRegistry.getResult(other, router.core.state))).loaderData).toBe(2)
      const replacementRoot = createRootRoute({ component: () => h("p", "Replacement") })
      const replacement = createRouter({ routeTree: replacementRoot, history: MemoryHistory.layer() })
      render(
        h(RouterProvider<typeof replacementRoot, History.HistoryError>, { router: replacement, registry: other }),
        container
      )
      await Effect.runPromise(AtomRegistry.getResult(other, replacement.core.state, { suspendOnWaiting: true }))
      await nextTick()
      expect(container.textContent).toBe("Replacement")
      render(null, container)
      expect(() => other.get(replacement.core.state)).not.toThrow()
    } finally {
      render(null, container)
      render(null, second)
      registry.dispose()
      other.dispose()
    }
    expect(released).toBe(2)
  })
})
