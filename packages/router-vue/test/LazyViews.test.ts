// @vitest-environment happy-dom
import { MemoryHistory, type RouteTree } from "@effect-stack/router"
import {
  type ClientRouter,
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorProps,
  Outlet,
  RouterProvider
} from "@effect-stack/router-vue"
import { Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type Component, defineComponent, h, nextTick, render } from "vue"

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})
const mount = <T extends RouteTree.Any, E>(router: ClientRouter<T, E>) => {
  const registry = AtomRegistry.make()
  const container = document.createElement("div")
  document.body.append(container)
  render(h(RouterProvider<T, E>, { router, registry }), container)
  const dispose = () => render(null, container)
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
  await nextTick()
}

// Untyped dynamic-import shape: the runtime receives a number where a component view is required.
const invalidModule = { default: 42 } as unknown as { readonly default: Component }

describe.sequential("Vue lazy view validation", () => {
  it("throws an actionable route-scoped error caught by the nearest errorComponent", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const rootRoute = createRootRoute({ component: () => h("main", [h("h1", "Shell"), h(Outlet)]) })
      const section = createRoute({
        getParentRoute: () => rootRoute,
        path: "section",
        component: Outlet,
        errorComponent: () => h("p", "Section boundary")
      })
      const broken = createRoute({
        getParentRoute: () => section,
        path: "broken",
        load: () => Effect.succeed(invalidModule),
        errorComponent: (props: ErrorProps) => h("p", `Child boundary: ${String(props.error)}`)
      })
      const router = createRouter({
        routeTree: rootRoute.addChildren([section.addChildren([broken])]),
        history: MemoryHistory.layer("/section/broken")
      })
      const { container, registry } = mount(router)
      await settle(router, registry)
      const text = container.textContent ?? ""
      expect(text).toContain("Shell")
      expect(text).toContain("Child boundary:")
      expect(text).not.toContain("Section boundary")
      expect(text).toContain("Route \"__root__/section/broken\"")
      expect(text).toContain("not a Vue component")
      expect(text).toContain("received number")
    } finally {
      logged.mockRestore()
    }
  })

  it("keeps an explicit component view ahead of an invalid lazy module export", async () => {
    const rootRoute = createRootRoute({ component: () => h("main", [h("h1", "Shell"), h(Outlet)]) })
    const explicit = createRoute({
      getParentRoute: () => rootRoute,
      path: "explicit",
      component: () => h("p", "Explicit view"),
      load: () => Effect.succeed(invalidModule)
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
    const rootRoute = createRootRoute({ component: () => h("main", [h("h1", "Shell"), h(Outlet)]) })
    const neutral = createRoute({
      getParentRoute: () => rootRoute,
      path: "neutral",
      load: () => Effect.succeed({ title: "descriptor" })
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([neutral]),
      history: MemoryHistory.layer("/neutral")
    })
    const { container, registry } = mount(router)
    await settle(router, registry)
    expect(container.textContent).toBe("Shell")
  })

  it("renders object and functional module views", async () => {
    const rootRoute = createRootRoute({ component: () => h("main", [h("h1", "Shell"), h(Outlet)]) })
    const objectRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "object",
      load: () => Effect.succeed({ default: defineComponent({ render: () => h("p", "Object view") }) })
    })
    const functionalRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "functional",
      load: () => Effect.succeed({ component: () => h("p", "Functional view") })
    })
    const tree = rootRoute.addChildren([objectRoute, functionalRoute])
    const objectRouter = createRouter({ routeTree: tree, history: MemoryHistory.layer("/object") })
    const objectMount = mount(objectRouter)
    await settle(objectRouter, objectMount.registry)
    expect(objectMount.container.textContent).toBe("ShellObject view")
    const functionalRouter = createRouter({ routeTree: tree, history: MemoryHistory.layer("/functional") })
    const functionalMount = mount(functionalRouter)
    await settle(functionalRouter, functionalMount.registry)
    expect(functionalMount.container.textContent).toBe("ShellFunctional view")
  })
})
