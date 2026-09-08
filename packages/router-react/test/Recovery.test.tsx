// @vitest-environment happy-dom
import { MemoryHistory, Router } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@effect-stack/router-react"
import { Deferred, Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe.sequential("React route recovery", () => {
  it("recovers from a render error through reset and subsequent navigation", async () => {
    let broken = true
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <h1>Shell</h1>
          <Outlet />
        </>
      )
    })
    const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <p>Home</p> })
    const child = createRoute({
      getParentRoute: () => rootRoute,
      path: "child",
      component: () => {
        if (broken) throw new Error("render failed")
        return <p>Recovered</p>
      },
      errorComponent: ({ reset }) => <button onClick={reset}>Retry render</button>
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([home, child]),
      history: MemoryHistory.layer("/child")
    })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await React.act(async () => {
        root.render(<RouterProvider router={router} registry={registry} />)
        await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
      })
      expect(container.textContent).toBe("ShellRetry render")
      expect(errors).toHaveBeenCalled()
      broken = false
      await React.act(async () => {
        container.querySelector("button")!.click()
        await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
      })
      expect(container.textContent).toBe("ShellRecovered")
      await React.act(async () => {
        registry.set(router.core.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))
        await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
      })
      expect(container.textContent).toBe("ShellHome")
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
      errors.mockRestore()
    }
  })

  it("interrupts nested lazy work when navigating away from its pending view", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const finalized = Effect.runSync(Deferred.make<void>())
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <h1>Shell</h1>
          <Outlet />
        </>
      )
    })
    const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <p>Home</p> })
    const parent = createRoute({ getParentRoute: () => rootRoute, path: "parent", component: Outlet })
    const child = createRoute({
      getParentRoute: () => parent,
      path: "child",
      pendingComponent: () => <p>Pending view</p>,
      load: () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => Deferred.succeed(finalized, undefined))
          yield* Deferred.succeed(started, undefined)
          return yield* Effect.never
        })
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([home, parent.addChildren([child])]),
      history: MemoryHistory.layer("/parent/child")
    })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    try {
      const unmountState = registry.mount(router.core.state)
      await Effect.runPromise(Deferred.await(started))
      await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
      expect(container.textContent).toBe("ShellPending view")
      await React.act(async () => {
        registry.set(router.core.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))
        await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
        await Effect.runPromise(Deferred.await(finalized))
      })
      expect(container.textContent).toBe("ShellHome")
      unmountState()
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
    }
  })
})
