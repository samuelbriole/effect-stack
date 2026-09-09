// @vitest-environment happy-dom
import { MemoryHistory } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from "@effect-stack/router-react"
import { Effect, Result, Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

/**
 * `dashboard` shares its URL with `dashboardIndex` and the pathless `dashboardModal` layout, and the
 * flattened preorder visits the modal last. A `root` shares its URL with the `gallery` layout and its
 * index, with a trailing pathless `shell` layout. Ranking, not declaration order, selects the target.
 */
const sharedUrlTree = () => {
  const root = createRootRoute({
    component: () => (
      <>
        <Link to="/dashboard" search={{ page: 5 }} hash="details">
          Go to dashboard
        </Link>
        <Outlet />
      </>
    )
  })
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: "dashboard",
    component: () => (
      <>
        <h2>Dashboard</h2>
        <Outlet />
      </>
    )
  })
  const dashboardIndex = createRoute({
    getParentRoute: () => dashboard,
    path: "/",
    search: { page: Schema.FiniteFromString },
    hash: Schema.Literals(["top", "details"]),
    component: () => <p>Index page {dashboardIndex.useSearch().page}</p>
  })
  const dashboardModal = createRoute({
    getParentRoute: () => dashboard,
    id: "modal",
    hash: Schema.Literals(["picker"])
  })
  const gallery = createRoute({ getParentRoute: () => root, id: "gallery" })
  const home = createRoute({
    getParentRoute: () => gallery,
    path: "/",
    search: { view: Schema.optionalKey(Schema.FiniteFromString) },
    component: () => <p>Home view {home.useSearch().view ?? 0}</p>
  })
  const shell = createRoute({ getParentRoute: () => root, id: "shell" })
  return {
    tree: root.addChildren([
      dashboard.addChildren([dashboardIndex, dashboardModal]),
      gallery.addChildren([home]),
      shell
    ]),
    dashboardIndex,
    home
  }
}

describe.sequential("Shared-URL destinations", () => {
  it("resolves a non-root index through pathless layouts and still rejects competing indexes", async () => {
    const rootRoute = createRootRoute()
    const dashboard = createRoute({ getParentRoute: () => rootRoute, path: "dashboard" })
    const shell = createRoute({ getParentRoute: () => dashboard, id: "shell" })
    const nested = createRoute({ getParentRoute: () => shell, id: "nested" })
    const index = createRoute({ getParentRoute: () => nested, path: "/", search: { page: Schema.FiniteFromString } })
    const children = shell.addChildren([nested.addChildren([index])])
    const router = createRouter({
      routeTree: rootRoute.addChildren([dashboard.addChildren([children])]),
      history: MemoryHistory.layer("/dashboard?page=3")
    })
    expect(router.href({ to: "/dashboard", search: { page: 3 } })).toEqual(Result.succeed("/dashboard?page=3"))
    const registry = AtomRegistry.make()
    const unmount = registry.mount(router.core.branch)
    try {
      const match = await Effect.runPromise(
        AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true })
      )
      expect(match.id).toBe(index.id)
      expect(registry.get(router.core.branch).matches.map((entry) => entry.route.id)).toEqual([
        rootRoute.id,
        dashboard.id,
        shell.id,
        nested.id,
        index.id
      ])
    } finally {
      unmount()
      registry.dispose()
    }
    const competing = createRoute({ getParentRoute: () => dashboard, path: "/" })
    expect(() => createRouter({ routeTree: rootRoute.addChildren([dashboard.addChildren([children, competing])]) }))
      .toThrow("Ambiguous route template")
  })

  it("encodes hrefs against the ranked index match, not the last pathless layout", () => {
    const { tree } = sharedUrlTree()
    const router = createRouter({ routeTree: tree, history: MemoryHistory.layer() })
    const dashboard = router.href({ to: "/dashboard", search: { page: 7 }, hash: "top" })
    expect(Result.isSuccess(dashboard)).toBe(true)
    if (Result.isSuccess(dashboard)) expect(dashboard.success).toBe("/dashboard?page=7#top")
    const home = router.href({ to: "/", search: { view: 2 } })
    expect(Result.isSuccess(home)).toBe(true)
    if (Result.isSuccess(home)) expect(home.success).toBe("/?view=2")
  })

  it("renders the URL of the ranked destination and resolves the index match on click", async () => {
    const { tree, dashboardIndex } = sharedUrlTree()
    const router = createRouter({ routeTree: tree, history: MemoryHistory.layer() })
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
      root.render(<RouterProvider router={router} registry={registry} />)
      await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    })
    const anchor = container.querySelector("a")!
    expect(anchor.getAttribute("href")).toBe("/dashboard?page=5#details")
    await React.act(async () => {
      anchor.click()
      await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigation, { suspendOnWaiting: true }))
    })
    expect(container.textContent).toContain("Index page 5")
    const resolved = await Effect.runPromise(
      AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true })
    )
    expect(resolved.id).toBe(dashboardIndex.id)
  })
})
