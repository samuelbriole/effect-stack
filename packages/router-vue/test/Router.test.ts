// @vitest-environment happy-dom
import { MemoryHistory, Router, type RouteTree } from "@effect-stack/router"
import {
  type ClientRouter,
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorProps,
  Link,
  Navigate,
  Outlet,
  RouterProvider
} from "@effect-stack/router-vue"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { afterEach, describe, expect, it } from "vitest"
import { defineComponent, h, nextTick, ref, render, type VNode } from "vue"

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
const settle = async <T extends RouteTree.Any, E>(
  router: ClientRouter<T, E>,
  registry: AtomRegistry.AtomRegistry,
  command = false
) => {
  await Effect.runPromise(
    AtomRegistry.getResult(registry, command ? router.core.navigate : router.core.state, { suspendOnWaiting: true })
      .pipe(Effect.exit)
  )
  await nextTick()
}

describe.sequential("Vue router", () => {
  it("preserves layouts while params, search, loader data, and link hrefs react", async () => {
    class Projects
      extends Context.Service<Projects, { readonly get: (id: number) => Effect.Effect<string> }>()("test/Projects")
    {}
    const Layout = defineComponent({
      setup() {
        const count = ref(0)
        return () =>
          h("main", [h("button", { id: "root-count", onClick: () => count.value++ }, `Root ${count.value}`), h(Outlet)])
      }
    })
    const Project = defineComponent({
      setup() {
        const data = project.useLoaderData()
        const params = project.useParams()
        const search = project.useSearch()
        const count = ref(0)
        return (): VNode =>
          h("section", [
            h("button", { id: "project-count", onClick: () => count.value++ }, `Local ${count.value}`),
            h("p", `${data.value}:${search.value.tab}`),
            h(Link, { to: "/projects/:id", params: { id: params.value.id + 1 }, search: { tab: "activity" } }, () =>
              "Next")
          ])
      }
    })
    const root = createRootRoute({ component: Layout })
    const project = createRoute({
      getParentRoute: () => root,
      path: "projects/:id",
      params: { id: Schema.FiniteFromString },
      search: { tab: Schema.optionalKey(Schema.String) },
      loader: ({ params }) => Projects.use((projects) => projects.get(params.id)),
      component: Project
    })
    const router = createRouter({
      routeTree: root.addChildren([project]),
      history: MemoryHistory.layer("/projects/1?tab=overview"),
      layer: Layer.succeed(Projects, { get: (id) => Effect.succeed(`Project ${id}`) })
    })
    const { container, registry } = mount(router)
    await settle(router, registry)
    container.querySelector<HTMLButtonElement>("#root-count")!.click()
    container.querySelector<HTMLButtonElement>("#project-count")!.click()
    expect(container.textContent).toContain("Project 1:overview")
    expect(container.querySelector("a")!.getAttribute("href")).toBe("/projects/2?tab=activity")
    container.querySelector("a")!.click()
    await settle(router, registry, true)
    expect(container.textContent).toContain("Project 2:activity")
    expect(container.textContent).toContain("Root 1Local 1")
    expect(container.querySelector("a")!.getAttribute("href")).toBe("/projects/3?tab=activity")
    registry.set(router.core.navigate, Router.refresh)
    await settle(router, registry, true)
    expect(container.textContent).toContain("Root 1Local 1")
  })

  it("preserves native anchor events, attributes, and reactive active state", async () => {
    let handlers = 0
    let stoppedHandlers = 0
    const root = createRootRoute({
      component: () =>
        h("main", [
          h(Link, { to: "/", exact: true, id: "home", class: "nav" }, () => "Home"),
          h(Link, { to: "/child", id: "normal" }, () => "Child"),
          h(Link, { to: "/child", target: "_blank", id: "blank" }, () => "Blank"),
          h(Link, { to: "/child", download: "file", id: "download" }, () => "Download"),
          h(Link, {
            to: "/child",
            id: "prevented",
            onClick: (event: MouseEvent) => {
              handlers++
              event.preventDefault()
            }
          }, () => "Prevented"),
          h(Outlet),
          h(Link, {
            to: "/child",
            id: "stopped",
            onClick: [(event: MouseEvent) => {
              event.preventDefault()
              event.stopImmediatePropagation()
            }, () => {
              stoppedHandlers++
            }]
          }, () => "Stopped")
        ])
    })
    const home = createRoute({ getParentRoute: () => root, path: "/" })
    const child = createRoute({ getParentRoute: () => root, path: "child" })
    const router = createRouter({ routeTree: root.addChildren([home, child]), history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    await settle(router, registry)
    const click = (id: string, init: MouseEventInit = {}) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init })
      let prevented = false
      document.addEventListener("click", () => {
        prevented = event.defaultPrevented
        event.preventDefault()
      }, { once: true })
      container.querySelector(`#${id}`)!.dispatchEvent(event)
      return prevented
    }
    expect(container.querySelector("#home")!.getAttribute("aria-current")).toBe("page")
    expect(container.querySelector("#home")!.className).toBe("nav")
    expect(click("normal", { ctrlKey: true })).toBe(false)
    expect(click("normal", { button: 1 })).toBe(false)
    expect(click("blank")).toBe(false)
    expect(click("download")).toBe(false)
    expect(click("prevented")).toBe(true)
    expect(handlers).toBe(1)
    const stopped = new MouseEvent("click", { bubbles: true, cancelable: true })
    container.querySelector("#stopped")!.dispatchEvent(stopped)
    expect(stopped.defaultPrevented).toBe(true)
    expect(stoppedHandlers).toBe(0)
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))).id).toBe(home.id)
    expect(click("normal")).toBe(true)
    await settle(router, registry, true)
    expect(container.querySelector("#normal")!.getAttribute("data-active")).toBe("true")
    expect(container.querySelector("#home")!.hasAttribute("aria-current")).toBe(false)
  })

  it("renders nested lazy pending/success views and nearest not-found boundaries", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const ready = Effect.runSync(Deferred.make<void>())
    const root = createRootRoute({ component: () => h("main", [h("h1", "Shell"), h(Outlet)]) })
    const parent = createRoute({
      getParentRoute: () => root,
      path: "parent",
      component: Outlet,
      notFoundComponent: () => h("p", "Missing child")
    })
    const lazy = createRoute({
      getParentRoute: () => parent,
      path: "lazy",
      pendingComponent: () => h("p", "Pending view"),
      load: () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(ready)
          return { default: () => h("p", "Lazy view") }
        })
    })
    const tree = root.addChildren([parent.addChildren([lazy])])
    const router = createRouter({ routeTree: tree, history: MemoryHistory.layer("/parent/lazy") })
    const { container, registry } = mount(router)
    await Effect.runPromise(Deferred.await(started))
    await nextTick()
    expect(container.textContent).toBe("ShellPending view")
    Effect.runSync(Deferred.succeed(ready, undefined))
    await settle(router, registry)
    expect(container.textContent).toBe("ShellLazy view")
    const missingRouter = createRouter({ routeTree: tree, history: MemoryHistory.layer("/parent/missing") })
    const missing = mount(missingRouter)
    await settle(missingRouter, missing.registry)
    expect(missing.container.textContent).toBe("ShellMissing child")
  })

  it("recovers loader failures followed by render failures", async () => {
    let loadFails = true
    let renderFails = true
    const root = createRootRoute({ component: () => h("main", [h("h1", "Shell"), h(Outlet)]) })
    const child = createRoute({
      getParentRoute: () => root,
      path: "child",
      loader: () => loadFails ? Effect.fail("missing") : Effect.succeed("Loaded"),
      component: defineComponent({
        setup() {
          const data = child.useLoaderData()
          return (): VNode => {
            if (renderFails) throw new Error("render failed")
            return h("p", data.value)
          }
        }
      }),
      errorComponent: (props: ErrorProps) => h("button", { onClick: props.reset }, "Retry")
    })
    const router = createRouter({ routeTree: root.addChildren([child]), history: MemoryHistory.layer("/child") })
    const { container, registry } = mount(router)
    await settle(router, registry)
    expect(container.textContent).toBe("ShellRetry")
    loadFails = false
    container.querySelector("button")!.click()
    await settle(router, registry, true)
    expect(container.textContent).toBe("ShellRetry")
    renderFails = false
    container.querySelector("button")!.click()
    await settle(router, registry, true)
    expect(container.textContent).toBe("ShellLoaded")
  })

  it("bubbles reactive render failures, resets on navigation, and replaces them with loader errors", async () => {
    const broken = ref(false)
    const root = createRootRoute({ component: () => h("main", [h("h1", "Shell"), h(Outlet)]) })
    const parent = createRoute({
      getParentRoute: () => root,
      path: "parent",
      component: Outlet,
      errorComponent: (props: ErrorProps) => h("p", String(props.error))
    })
    const child = createRoute({
      getParentRoute: () => parent,
      path: ":id",
      params: { id: Schema.FiniteFromString },
      loader: ({ params }) => params.id === 3 ? Effect.fail("missing") : Effect.void,
      component: defineComponent({
        setup() {
          const params = child.useParams()
          return (): VNode => {
            if (broken.value) throw new Error("render failed")
            return h("p", `Child ${params.value.id}`)
          }
        }
      })
    })
    const router = createRouter({
      routeTree: root.addChildren([parent.addChildren([child])]),
      history: MemoryHistory.layer("/parent/1")
    })
    const { container, registry } = mount(router)
    await settle(router, registry)
    broken.value = true
    await nextTick()
    expect(container.textContent).toBe("ShellError: render failed")
    broken.value = false
    registry.set(router.core.navigate, Router.push(child, { params: { id: 2 }, search: {}, hash: "" }))
    await settle(router, registry, true)
    expect(container.textContent).toBe("ShellChild 2")
    broken.value = true
    await nextTick()
    registry.set(router.core.navigate, Router.push(child, { params: { id: 3 }, search: {}, hash: "" }))
    await settle(router, registry, true)
    expect(container.textContent).toBe("Shell@effect-stack/router/RouteLoaderError")
  })

  it("navigates declaratively once, preserving explicit same-URL history state", async () => {
    let visits = 0
    const state = { acknowledged: true }
    const root = createRootRoute({
      component: () => h("main", [h(Navigate, { to: "/child", replace: true, state }), h(Outlet)])
    })
    const home = createRoute({ getParentRoute: () => root, path: "/" })
    const child = createRoute({
      getParentRoute: () => root,
      path: "child",
      loader: () => Effect.sync(() => ++visits),
      pendingComponent: () => h("p", "Loading"),
      component: () => h("p", "Arrived")
    })
    const router = createRouter({ routeTree: root.addChildren([home, child]), history: MemoryHistory.layer("/child") })
    const { container, registry } = mount(router)
    await settle(router, registry)
    await settle(router, registry, true)
    expect(container.textContent).toBe("Arrived")
    const match = await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))
    expect(match.location.state).toEqual(state)
    expect(match.location.index).toBe(0)
    expect(visits).toBe(2)
    registry.set(router.core.navigate, Router.refresh)
    await settle(router, registry, true)
    expect(visits).toBe(3)
  })

  it("does not repeat a redirect after a root pending fallback remounts its layout", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const ready = Effect.runSync(Deferred.make<void>())
    let visits = 0
    const root = createRootRoute({ component: () => h("main", [h(Navigate, { to: "/child" }), h(Outlet)]) })
    const home = createRoute({ getParentRoute: () => root, path: "/" })
    const child = createRoute({
      getParentRoute: () => root,
      path: "child",
      loader: () =>
        Effect.gen(function*() {
          visits++
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(ready)
        }),
      component: () => h("p", "Arrived")
    })
    const router = createRouter({ routeTree: root.addChildren([home, child]), history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    await Effect.runPromise(Deferred.await(started))
    await nextTick()
    expect(container.textContent).toBe("Loading…")
    Effect.runSync(Deferred.succeed(ready, undefined))
    await settle(router, registry, true)
    expect(container.textContent).toBe("Arrived")
    expect(visits).toBe(1)
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))).location.index).toBe(1)
  })
})
