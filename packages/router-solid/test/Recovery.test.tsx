// @vitest-environment happy-dom
import { MemoryHistory, Router } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@effect-stack/router-solid"
import { Effect, Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { createMemo, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { expect, it } from "vitest"

it("bubbles reactive render errors and recovers on same-route navigation", async () => {
  const root = createRootRoute({
    component: () => (
      <>
        <h1>Shell</h1>
        <Outlet />
      </>
    )
  })
  const parent = createRoute({
    getParentRoute: () => root,
    path: "parent",
    component: Outlet,
    errorComponent: () => <p>Render boundary</p>
  })
  let fail!: () => void
  const child = createRoute({
    getParentRoute: () => parent,
    path: ":id",
    params: { id: Schema.FiniteFromString },
    component: () => {
      const params = child.useParams()
      const [broken, setBroken] = createSignal(false)
      fail = () => setBroken(true)
      const text = createMemo(() => {
        if (broken()) throw new Error("reactive render failed")
        return `Child ${params().id}`
      })
      return <p>{text()}</p>
    }
  })
  const router = createRouter({
    routeTree: root.addChildren([parent.addChildren([child])]),
    history: MemoryHistory.layer("/parent/1")
  })
  const registry = AtomRegistry.make()
  const container = document.createElement("div")
  const dispose = render(() => <RouterProvider router={router} registry={registry} />, container)
  try {
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    expect(container.textContent).toBe("ShellChild 1")
    fail()
    expect(container.textContent).toBe("ShellRender boundary")
    registry.set(router.core.navigate, Router.push(child, { params: { id: 2 }, search: {}, hash: "" }))
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    expect(container.textContent).toBe("ShellChild 2")
  } finally {
    dispose()
    registry.dispose()
  }
})

it("replaces a latched render error with a subsequent loader error", async () => {
  const root = createRootRoute({ component: Outlet })
  let fail!: () => void
  const child = createRoute({
    getParentRoute: () => root,
    path: "items/:id",
    params: { id: Schema.FiniteFromString },
    loader: ({ params }) => params.id === 2 ? Effect.fail(new Error("loader failed")) : Effect.void,
    component: () => {
      const [broken, setBroken] = createSignal(false)
      fail = () => setBroken(true)
      const text = createMemo(() => {
        if (broken()) throw new Error("render failed")
        return "Loaded"
      })
      return <p>{text()}</p>
    },
    errorComponent: (props) => <p>{String(props.error)}</p>
  })
  const router = createRouter({ routeTree: root.addChildren([child]), history: MemoryHistory.layer("/items/1") })
  const registry = AtomRegistry.make()
  const container = document.createElement("div")
  const dispose = render(() => <RouterProvider router={router} registry={registry} />, container)
  try {
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    fail()
    expect(container.textContent).toBe("Error: render failed")
    registry.set(router.core.navigate, Router.push(child, { params: { id: 2 }, search: {}, hash: "" }))
    await Effect.runPromise(
      AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }).pipe(Effect.exit)
    )
    expect(container.textContent).toBe("@effect-stack/router/RouteLoaderError")
  } finally {
    dispose()
    registry.dispose()
  }
})
