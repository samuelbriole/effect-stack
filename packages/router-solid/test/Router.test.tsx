// @vitest-environment happy-dom
import { MemoryHistory, Router, type RouteTree } from "@effect-stack/router"
import {
  type ClientRouter,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Navigate,
  Outlet,
  RouterProvider
} from "@effect-stack/router-solid"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it } from "vitest"

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

describe.sequential("Solid router", () => {
  it("applies explicit state during same-URL declarative replacement", async () => {
    const state = { acknowledged: true }
    const root = createRootRoute({ component: () => <Navigate to="/" replace state={state} /> })
    const router = createRouter({ routeTree: root, history: MemoryHistory.layer() })
    const { registry } = mount(router)
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    const match = await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))
    expect(match.location.state).toEqual(state)
    expect(match.location.index).toBe(0)
  })
  it("preserves layouts and reacts to params, search, data, and link input changes", async () => {
    class Projects
      extends Context.Service<Projects, { readonly get: (id: number) => Effect.Effect<string> }>()("test/Projects")
    {}
    const root = createRootRoute({ component: Layout })
    const project = createRoute({
      getParentRoute: () => root,
      path: "projects/:id",
      params: { id: Schema.FiniteFromString },
      search: { tab: Schema.optionalKey(Schema.String) },
      loader: ({ params }) => Projects.use((projects) => projects.get(params.id)),
      component: Project
    })
    function Layout() {
      const [count, setCount] = createSignal(0)
      return (
        <>
          <button id="root-count" onClick={() => setCount(count() + 1)}>Root {count()}</button>
          <Outlet />
        </>
      )
    }
    function Project() {
      const data = project.useLoaderData()
      const params = project.useParams()
      const search = project.useSearch()
      const [count, setCount] = createSignal(0)
      return (
        <>
          <button id="project-count" onClick={() => setCount(count() + 1)}>Local {count()}</button>
          <p>{data()}:{search().tab}</p>
          <Link to="/projects/:id" params={{ id: params().id + 1 }} search={{ tab: "activity" }}>Next</Link>
        </>
      )
    }
    const router = createRouter({
      routeTree: root.addChildren([project]),
      history: MemoryHistory.layer("/projects/1?tab=overview"),
      layer: Layer.succeed(Projects, { get: (id) => Effect.succeed(`Project ${id}`) })
    })
    const { container, registry } = mount(router)
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    container.querySelector<HTMLButtonElement>("#root-count")!.click()
    container.querySelector<HTMLButtonElement>("#project-count")!.click()
    expect(container.textContent).toContain("Project 1:overview")
    expect(container.querySelector("a")!.getAttribute("href")).toBe("/projects/2?tab=activity")
    container.querySelector("a")!.click()
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    expect(container.textContent).toContain("Project 2:activity")
    expect(container.textContent).toContain("Root 1Local 1")
    expect(container.querySelector("a")!.getAttribute("href")).toBe("/projects/3?tab=activity")
    registry.set(router.core.navigate, Router.refresh)
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    expect(container.textContent).toContain("Root 1Local 1")
  })

  it("keeps native anchor behavior, tuple handlers, attributes, and active state", async () => {
    const root = createRootRoute({
      component: () => (
        <>
          <Link to="/" exact id="home">Home</Link>
          <Link to="/child" id="normal">Child</Link>
          <Link to="/child" target="_blank" id="blank">Blank</Link>
          <Link to="/child" download="file" id="download">Download</Link>
          <Link
            to="/child"
            id="prevented"
            onClick={[(value, event) => {
              expect(value).toBe("tuple")
              event.preventDefault()
            }, "tuple"]}
          >
            Prevented
          </Link>
          <Outlet />
        </>
      )
    })
    const home = createRoute({ getParentRoute: () => root, path: "/" })
    const child = createRoute({ getParentRoute: () => root, path: "child" })
    const router = createRouter({ routeTree: root.addChildren([home, child]), history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    const click = (id: string, init: MouseEventInit = {}) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init })
      let prevented = false
      // Observe the adapter's decision, then suppress happy-dom's actual network navigation.
      document.addEventListener("click", () => {
        prevented = event.defaultPrevented
        event.preventDefault()
      }, { once: true })
      container.querySelector(`#${id}`)!.dispatchEvent(event)
      return prevented
    }
    expect(container.querySelector("#home")!.getAttribute("aria-current")).toBe("page")
    expect(click("normal", { ctrlKey: true })).toBe(false)
    expect(click("normal", { button: 1 })).toBe(false)
    expect(click("blank")).toBe(false)
    expect(click("download")).toBe(false)
    expect(click("prevented")).toBe(true)
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))).id).toBe(home.id)
    expect(click("normal")).toBe(true)
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    expect(container.querySelector("#normal")!.getAttribute("data-active")).toBe("true")
    expect(container.querySelector("#home")!.hasAttribute("aria-current")).toBe(false)
  })

  it("renders nested lazy pending and success views, and nearest not-found boundaries", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const ready = Effect.runSync(Deferred.make<void>())
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
      notFoundComponent: () => <p>Missing child</p>
    })
    const lazy = createRoute({
      getParentRoute: () => parent,
      path: "lazy",
      pendingComponent: () => <p>Pending view</p>,
      load: () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(ready)
          return { default: () => <p>Lazy view</p> }
        })
    })
    const tree = root.addChildren([parent.addChildren([lazy])])
    const router = createRouter({ routeTree: tree, history: MemoryHistory.layer("/parent/lazy") })
    const { container, registry } = mount(router)
    await Effect.runPromise(Deferred.await(started))
    expect(container.textContent).toBe("ShellPending view")
    Effect.runSync(Deferred.succeed(ready, undefined))
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    expect(container.textContent).toBe("ShellLazy view")
    const missingRouter = createRouter({ routeTree: tree, history: MemoryHistory.layer("/parent/missing") })
    const missing = mount(missingRouter)
    await Effect.runPromise(
      AtomRegistry.getResult(missing.registry, missingRouter.core.state, { suspendOnWaiting: true }).pipe(Effect.exit)
    )
    expect(missing.container.textContent).toBe("ShellMissing child")
  })

  it("recovers loader and rendering failures with native route boundaries", async () => {
    let loadFails = true
    let renderFails = true
    const root = createRootRoute({
      component: () => (
        <>
          <h1>Shell</h1>
          <Outlet />
        </>
      )
    })
    const child = createRoute({
      getParentRoute: () => root,
      path: "child",
      loader: () => loadFails ? Effect.fail("missing") : Effect.succeed("Loaded"),
      component: () => {
        const data = child.useLoaderData()
        if (renderFails) throw new Error("render failed")
        return <p>{data()}</p>
      },
      errorComponent: (props) => <button onClick={() => props.reset()}>Retry</button>
    })
    const router = createRouter({ routeTree: root.addChildren([child]), history: MemoryHistory.layer("/child") })
    const { container, registry } = mount(router)
    await Effect.runPromise(
      AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }).pipe(Effect.exit)
    )
    expect(container.textContent).toBe("ShellRetry")
    loadFails = false
    container.querySelector("button")!.click()
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    expect(container.textContent).toBe("ShellRetry")
    renderFails = false
    container.querySelector("button")!.click()
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    expect(container.textContent).toBe("ShellLoaded")
  })

  it("disposes owned services and interrupts pending work, while preserving caller-owned registries", async () => {
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
    const dispose = render(() => <RouterProvider router={router} />, container)
    await Effect.runPromise(Deferred.await(started))
    dispose()
    await Effect.runPromise(Deferred.await(finalized))
    const other = createRouter({ routeTree: createRootRoute(), history: MemoryHistory.layer() })
    const mounted = mount(other)
    await Effect.runPromise(AtomRegistry.getResult(mounted.registry, other.core.state, { suspendOnWaiting: true }))
    mounted.dispose()
    expect(() => mounted.registry.get(other.core.state)).not.toThrow()
  })

  it("navigates declaratively without repeating for a reactive state update", async () => {
    let visits = 0
    const root = createRootRoute({
      component: () => (
        <>
          <Navigate to="/child" replace />
          <Outlet />
        </>
      )
    })
    const home = createRoute({ getParentRoute: () => root, path: "/" })
    const child = createRoute({
      getParentRoute: () => root,
      path: "child",
      loader: () => Effect.sync(() => ++visits),
      pendingComponent: () => <p>Loading child</p>,
      component: () => <p>Arrived</p>
    })
    const router = createRouter({ routeTree: root.addChildren([home, child]), history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    expect(container.textContent).toBe("Arrived")
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))).id).toBe(child.id)
    expect(visits).toBe(1)
    registry.set(router.core.navigate, Router.refresh)
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.navigate, { suspendOnWaiting: true }))
    expect(visits).toBe(2)
  })
})
