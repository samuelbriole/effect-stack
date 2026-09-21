// @vitest-environment happy-dom
import { MemoryHistory, type RouteTree } from "@effect-stack/router"
import {
  type ClientRouter,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider
} from "@effect-stack/router-solid"
import { Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import type { Component } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it, vi } from "vitest"

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})
const mount = <T extends RouteTree.Any, E>(router: ClientRouter<T, E>) => {
  const registry = AtomRegistry.make()
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => <RouterProvider router={router} registry={registry} />, container)
  cleanups.push(() => {
    dispose()
    registry.dispose()
    container.remove()
  })
  return { container, registry, dispose }
}
const settle = async <T extends RouteTree.Any, E>(router: ClientRouter<T, E>, registry: AtomRegistry.AtomRegistry) => {
  await Effect.runPromise(
    AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }).pipe(Effect.exit)
  )
}

// Untyped dynamic-import shape: the runtime receives a number where a component view is required.
const invalidModule = { default: 42 } as unknown as { readonly default: Component }

describe.sequential("Solid lazy view validation", () => {
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
        lazy: () => Effect.succeed(invalidModule),
        errorComponent: (props) => <p>{`Child boundary: ${String(props.error)}`}</p>
      })
      const router = createRouter({
        routeTree: rootRoute.addChildren([section.addChildren([broken])]),
        history: MemoryHistory.layer("/section/broken")
      })
      const { container, registry } = mount(router)
      await settle(router, registry)
      const text = container.textContent ?? ""
      expect(text).toContain("ShellSection")
      expect(text).toContain("Child boundary:")
      expect(text).not.toContain("Section boundary")
      expect(text).toContain("Route \"__root__/section/broken\"")
      expect(text).toContain("not a Solid component")
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
      lazy: () => Effect.succeed(invalidModule)
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([explicit]),
      history: MemoryHistory.layer("/explicit")
    })
    const { container, registry } = mount(router)
    await settle(router, registry)
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
      lazy: () => Effect.succeed({ title: "descriptor" })
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([neutral]),
      history: MemoryHistory.layer("/neutral")
    })
    const { container, registry } = mount(router)
    await settle(router, registry)
    expect(container.textContent).toBe("Shell")
  })

  it("renders function module views from default and component exports", async () => {
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
      lazy: () => Effect.succeed({ default: () => <p>Lazy view</p> })
    })
    const named = createRoute({
      getParentRoute: () => rootRoute,
      path: "named",
      lazy: () => Effect.succeed({ component: () => <p>Named view</p> })
    })
    const tree = rootRoute.addChildren([lazy, named])
    const lazyRouter = createRouter({ routeTree: tree, history: MemoryHistory.layer("/lazy") })
    const lazyMount = mount(lazyRouter)
    await settle(lazyRouter, lazyMount.registry)
    expect(lazyMount.container.textContent).toBe("ShellLazy view")
    const namedRouter = createRouter({ routeTree: tree, history: MemoryHistory.layer("/named") })
    const namedMount = mount(namedRouter)
    await settle(namedRouter, namedMount.registry)
    expect(namedMount.container.textContent).toBe("ShellNamed view")
  })
})
