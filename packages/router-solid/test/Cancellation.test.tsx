// @vitest-environment happy-dom
import { MemoryHistory, Router } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@effect-stack/router-solid"
import { Deferred, Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { render } from "solid-js/web"
import { expect, it } from "vitest"

it("interrupts nested lazy work on navigation and rejects late module publication", async () => {
  const started = Effect.runSync(Deferred.make<void>())
  const stopped = Effect.runSync(Deferred.make<void>())
  let complete!: (value: { default: () => string }) => void
  const module = new Promise<{ default: () => string }>((resolve) => {
    complete = resolve
  })
  const root = createRootRoute({
    component: () => (
      <>
        <h1>Shell</h1>
        <Outlet />
      </>
    )
  })
  const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <p>Home</p> })
  const parent = createRoute({ getParentRoute: () => root, path: "parent", component: Outlet })
  const lazy = createRoute({
    getParentRoute: () => parent,
    path: "lazy",
    pendingComponent: () => <p>Pending</p>,
    load: () =>
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
  const dispose = render(() => <RouterProvider router={router} registry={registry} />, container)
  try {
    await Effect.runPromise(Deferred.await(started))
    expect(container.textContent).toBe("ShellPending")
    registry.set(router.core.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    await Effect.runPromise(Deferred.await(stopped))
    expect(container.textContent).toBe("ShellHome")
    complete({ default: () => "Stale" })
    await module
    await Promise.resolve()
    expect(container.textContent).toBe("ShellHome")
  } finally {
    dispose()
    registry.dispose()
  }
})
