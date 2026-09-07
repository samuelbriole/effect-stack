// @vitest-environment happy-dom
import { MemoryHistory, Router } from "@effect-stack/router"
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Navigate,
  Outlet,
  RouterProvider
} from "@effect-stack/router-react"
import { Deferred, Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe.sequential("React router", () => {
  it("does not repeat redirects when a root pending fallback remounts the layout", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const ready = Effect.runSync(Deferred.make<void>())
    let visits = 0
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <Navigate to="/child" />
          <Outlet />
        </>
      )
    })
    const home = createRoute({ getParentRoute: () => rootRoute, path: "/" })
    const child = createRoute({
      getParentRoute: () => rootRoute,
      path: "child",
      loader: () =>
        Effect.gen(function*() {
          visits++
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(ready)
        }),
      component: () => <p>Arrived</p>
    })
    const router = createRouter({ routeTree: rootRoute.addChildren([home, child]), history: MemoryHistory.layer() })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    cleanups.push(async () => {
      await React.act(async () => root.unmount())
      registry.dispose()
    })
    await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
    await Effect.runPromise(Deferred.await(started))
    expect(container.textContent).toBe("Loading…")
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(ready, undefined))
      await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    })
    expect(container.textContent).toBe("Arrived")
    expect(visits).toBe(1)
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))).location.index).toBe(1)
  })

  it("preserves explicit state in same-URL declarative replacement", async () => {
    const state = { acknowledged: true }
    const rootRoute = createRootRoute({ component: () => <Navigate to="/" replace state={state} /> })
    const router = createRouter({ routeTree: rootRoute, history: MemoryHistory.layer() })
    const registry = AtomRegistry.make()
    const root = createRoot(document.createElement("div"))
    cleanups.push(async () => {
      await React.act(async () => root.unmount())
      registry.dispose()
    })
    await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
    const match = await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))
    expect(match.location.state).toEqual(state)
    expect(match.location.index).toBe(0)
  })

  it("disposes provider-owned loader scopes after StrictMode unmount", async () => {
    const finalized = Effect.runSync(Deferred.make<void>())
    const started = Effect.runSync(Deferred.make<void>())
    const route = createRootRoute({
      loader: () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => Deferred.succeed(finalized, undefined))
          yield* Deferred.succeed(started, undefined)
          return yield* Effect.never
        })
    })
    const router = createRouter({ routeTree: route, history: MemoryHistory.layer() })
    const container = document.createElement("div")
    const root = createRoot(container)
    await React.act(async () => {
      root.render(
        <React.StrictMode>
          <RouterProvider router={router} />
        </React.StrictMode>
      )
    })
    await Effect.runPromise(Deferred.await(started))
    vi.useFakeTimers()
    try {
      await React.act(async () => {
        root.unmount()
        await vi.advanceTimersByTimeAsync(501)
      })
      await Effect.runPromise(Deferred.await(finalized))
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps ancestor layouts around pending lazy views and nested not-found views", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const ready = Effect.runSync(Deferred.make<void>())
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <h1>Shell</h1>
          <Outlet />
        </>
      )
    })
    const section = createRoute({
      getParentRoute: () => rootRoute,
      path: "section",
      component: () => (
        <>
          <h2>Section</h2>
          <Outlet />
        </>
      ),
      notFoundComponent: () => <p>Section missing</p>
    })
    const lazy = createRoute({
      getParentRoute: () => section,
      path: "lazy",
      pendingComponent: () => <p>Waiting for view</p>,
      load: () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(ready)
          return { default: () => <p>Lazy view</p> }
        })
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([section.addChildren([lazy])]),
      history: MemoryHistory.layer("/section/lazy")
    })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    cleanups.push(async () => {
      await React.act(async () => root.unmount())
      registry.dispose()
    })
    const unmountState = registry.mount(router.core.state)
    await Effect.runPromise(Deferred.await(started))
    await React.act(async () => {
      root.render(<RouterProvider router={router} registry={registry} />)
    })
    expect(container.textContent).toBe("ShellSectionWaiting for view")
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(ready, undefined))
      await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    })
    expect(container.textContent).toBe("ShellSectionLazy view")
    unmountState()

    const missingRouter = createRouter({
      routeTree: rootRoute.addChildren([section.addChildren([lazy])]),
      history: MemoryHistory.layer("/section/missing")
    })
    await React.act(async () => {
      root.render(<RouterProvider router={missingRouter} registry={registry} />)
      await Effect.runPromise(
        AtomRegistry.getResult(registry, missingRouter.core.state, { suspendOnWaiting: true }).pipe(Effect.exit)
      )
    })
    expect(container.textContent).toBe("ShellSection missing")
  })

  it("renders typed data, preserves layout state, and uses real anchor navigation", async () => {
    const rootRoute = createRootRoute({ component: Layout })
    const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <p>Home</p> })
    const project = createRoute({
      getParentRoute: () => rootRoute,
      path: "project",
      loader: () => Effect.succeed("Project data"),
      component: Project
    })
    function Layout() {
      const [count, setCount] = React.useState(0)
      return (
        <>
          <button onClick={() => setCount(count + 1)}>Count {count}</button>
          <Link to="/project">Project</Link>
          <Outlet />
        </>
      )
    }
    function Project() {
      return <p>{project.useLoaderData()}</p>
    }
    const router = createRouter({ routeTree: rootRoute.addChildren([home, project]), history: MemoryHistory.layer() })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(async () => {
      await React.act(async () => root.unmount())
      registry.dispose()
      container.remove()
    })
    await React.act(async () => {
      root.render(
        <React.StrictMode>
          <RouterProvider router={router} registry={registry} />
        </React.StrictMode>
      )
      await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    })
    expect(container.textContent).toContain("Home")
    await React.act(async () => container.querySelector("button")!.click())
    const anchor = container.querySelector("a")!
    expect(anchor.getAttribute("href")).toBe("/project")
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })
    await React.act(async () => {
      anchor.dispatchEvent(modified)
    })
    expect(modified.defaultPrevented).toBe(false)
    await React.act(async () => {
      anchor.click()
      await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    })
    expect(container.textContent).toContain("Project data")
    expect(container.textContent).toContain("Count 1")
    expect(container.querySelector("a")!.getAttribute("aria-current")).toBe("page")
  })

  it("bubbles loader errors to a route boundary and retries on refresh", async () => {
    let fail = true
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <h1>Layout</h1>
          <Outlet />
        </>
      )
    })
    const child = createRoute({
      getParentRoute: () => rootRoute,
      path: "child",
      loader: () => fail ? Effect.fail("missing") : Effect.succeed("Recovered"),
      component: () => <p>{child.useLoaderData()}</p>,
      errorComponent: ({ reset }) => <button onClick={reset}>Try again</button>
    })
    const router = createRouter({ routeTree: rootRoute.addChildren([child]), history: MemoryHistory.layer("/child") })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    cleanups.push(async () => {
      await React.act(async () => root.unmount())
      registry.dispose()
    })
    await React.act(async () => {
      root.render(<RouterProvider router={router} registry={registry} />)
      await Effect.runPromise(
        AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }).pipe(Effect.exit)
      )
    })
    expect(container.textContent).toBe("LayoutTry again")
    fail = false
    await React.act(async () => {
      registry.set(router.core.navigate, Router.refresh)
      await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    })
    expect(container.textContent).toBe("LayoutRecovered")
  })
})
