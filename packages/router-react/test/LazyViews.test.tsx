// @vitest-environment happy-dom
import { MemoryHistory, type RouteTree } from "@effect-stack/router"
import {
  type ClientRouter,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider
} from "@effect-stack/router-react"
import { Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const cleanups: Array<() => void> = []
afterEach(async () => {
  await React.act(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup()
  })
})
const mount = async <T extends RouteTree.Any, E>(router: ClientRouter<T, E>) => {
  const registry = AtomRegistry.make()
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    root.unmount()
    registry.dispose()
    container.remove()
  })
  await React.act(async () => {
    root.render(<RouterProvider router={router} registry={registry} />)
    await Effect.runPromise(
      AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }).pipe(Effect.exit)
    )
  })
  return { container, registry }
}

// Untyped dynamic-import shape: the runtime receives a number where a component view is required.
const invalidModule = { default: 42 } as unknown as { readonly default: React.ComponentType }

describe.sequential("React lazy view validation", () => {
  it("accepts forwardRef module views and rejects a present null view", async () => {
    const Forward = React.forwardRef<HTMLParagraphElement>((_, ref) => <p ref={ref}>Forward view</p>)
    const valid = createRootRoute({ load: () => Effect.succeed({ default: Forward }) })
    const { container } = await mount(createRouter({ routeTree: valid, history: MemoryHistory.layer() }))
    expect(container.textContent).toBe("Forward view")
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const route = createRootRoute({
        load: () => Effect.succeed({ default: null } as unknown as { readonly default: React.ComponentType }),
        errorComponent: ({ error }) => <p>{String(error)}</p>
      })
      const broken = await mount(createRouter({ routeTree: route, history: MemoryHistory.layer() }))
      expect(broken.container.textContent).toContain("received null")
    } finally {
      logged.mockRestore()
    }
  })

  it("throws an actionable route-scoped error caught by the nearest errorComponent", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
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
        errorComponent: () => <p>Section boundary</p>
      })
      const broken = createRoute({
        getParentRoute: () => section,
        path: "broken",
        load: () => Effect.succeed(invalidModule),
        errorComponent: ({ error }) => <p>{`Child boundary: ${String(error)}`}</p>
      })
      const router = createRouter({
        routeTree: rootRoute.addChildren([section.addChildren([broken])]),
        history: MemoryHistory.layer("/section/broken")
      })
      const { container } = await mount(router)
      const text = container.textContent ?? ""
      expect(text).toContain("ShellSection")
      expect(text).toContain("Child boundary:")
      expect(text).not.toContain("Section boundary")
      expect(text).toContain("Route \"__root__/section/broken\"")
      expect(text).toContain("not a React component")
      expect(text).toContain("received number")
    } finally {
      logged.mockRestore()
    }
  })

  it("keeps an explicit component view ahead of an invalid lazy module export", async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <h1>Shell</h1>
          <Outlet />
        </>
      )
    })
    const explicit = createRoute({
      getParentRoute: () => rootRoute,
      path: "explicit",
      component: () => <p>Explicit view</p>,
      load: () => Effect.succeed(invalidModule)
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([explicit]),
      history: MemoryHistory.layer("/explicit")
    })
    const { container } = await mount(router)
    expect(container.textContent).toBe("ShellExplicit view")
  })

  it("falls back to Outlet for a renderer-neutral lazy module", async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <h1>Shell</h1>
          <Outlet />
        </>
      )
    })
    const neutral = createRoute({
      getParentRoute: () => rootRoute,
      path: "neutral",
      load: () => Effect.succeed({ title: "descriptor" })
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([neutral]),
      history: MemoryHistory.layer("/neutral")
    })
    const { container } = await mount(router)
    expect(container.textContent).toBe("Shell")
  })

  it("renders function and memo module views selected by precedence", async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <h1>Shell</h1>
          <Outlet />
        </>
      )
    })
    const lazy = createRoute({
      getParentRoute: () => rootRoute,
      path: "lazy",
      load: () => Effect.succeed({ default: () => <p>Lazy view</p> })
    })
    const memoized = createRoute({
      getParentRoute: () => rootRoute,
      path: "memo",
      load: () => Effect.succeed({ component: React.memo(() => <p>Memoized view</p>) })
    })
    const tree = rootRoute.addChildren([lazy, memoized])
    const lazyRouter = createRouter({ routeTree: tree, history: MemoryHistory.layer("/lazy") })
    expect((await mount(lazyRouter)).container.textContent).toBe("ShellLazy view")
    const memoRouter = createRouter({ routeTree: tree, history: MemoryHistory.layer("/memo") })
    expect((await mount(memoRouter)).container.textContent).toBe("ShellMemoized view")
  })
})
