// @vitest-environment happy-dom
import { MemoryHistory, type RouteTree } from "@effect-stack/router"
import {
  type ClientRouter,
  createRootRoute,
  createRoute,
  createRouter,
  type Destination,
  Navigate,
  type NavigationError,
  Outlet,
  RouterProvider,
  useNavigate,
  useNavigateEffect
} from "@effect-stack/router-solid"
import { Cause, Context, Deferred, Effect, Layer, Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { type Component, createMemo, createSignal } from "solid-js"
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
  return { container, registry }
}
// Solid flushes queued user effects on a microtask; a timer settles them and
// any fire-and-forget transition started from an effect before the next read.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe.sequential("Solid review regressions", () => {
  it("makes decoded params available in pending views", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const ready = Effect.runSync(Deferred.make<void>())
    const rootRoute = createRootRoute({ component: Outlet })
    const project = createRoute({
      getParentRoute: () => rootRoute,
      path: "projects/:id",
      params: { id: Schema.FiniteFromString },
      loader: () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(ready)
        }),
      pendingComponent: Pending
    })
    function Pending() {
      const params = project.useParams()
      return <p>Loading {params().id}</p>
    }
    const router = createRouter({
      routeTree: rootRoute.addChildren([project]),
      history: MemoryHistory.layer("/projects/42")
    })
    const { container } = mount(router)
    // The loader never settles here; only the decoded incoming input is observable.
    await Effect.runPromise(Deferred.await(started))
    await flush()
    expect(container.textContent).toBe("Loading 42")
  })

  it("recovers from bad data only after the asynchronous refresh succeeds", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    let loads = 0
    const rootRoute = createRootRoute({
      component: Outlet,
      errorComponent: (props) => <button onClick={props.reset}>Retry</button>
    })
    const child = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      loader: () => ++loads === 1 ? Effect.succeed("bad") : Deferred.await(ready).pipe(Effect.as("good")),
      component: Child
    })
    function Child() {
      const data = child.useLoaderData()
      const text = createMemo(() => {
        if (data() === "bad") throw new Error("bad data")
        return data()
      })
      return <p>{text()}</p>
    }
    const router = createRouter({ routeTree: rootRoute.addChildren([child]), history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
      expect(container.textContent).toBe("Retry")
      container.querySelector("button")!.click()
      await flush()
      // The latched boundary survives Retry while the asynchronous load runs.
      expect(container.textContent).toBe("Retry")
      Effect.runSync(Deferred.succeed(ready, undefined))
      await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
      await flush()
      // Recovery arrives only with the completed transition's fresh data.
      expect(container.textContent).toBe("good")
    } finally {
      log.mockRestore()
    }
  })

  it("retries initialization after a Layer fails its first construction", async () => {
    class Config extends Context.Service<Config, string>()("test/Config") {}
    let attempts = 0
    const layer = Layer.effect(
      Config,
      Effect.suspend(() => ++attempts === 1 ? Effect.fail("startup") : Effect.succeed("ready"))
    )
    const route = createRootRoute({
      loader: () => Config.use(Effect.succeed),
      component: View,
      errorComponent: (props) => <button onClick={props.reset}>Retry startup</button>
    })
    function View() {
      const data = route.useLoaderData()
      return <p>{data()}</p>
    }
    const router = createRouter({ routeTree: route, layer, history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    await Effect.runPromise(
      AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }).pipe(Effect.exit)
    )
    await flush()
    expect(container.textContent).toBe("Retry startup")
    container.querySelector("button")!.click()
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    await flush()
    // Startup Retry rebuilds the failed Layer instead of re-reading cached failure.
    expect(attempts).toBe(2)
    expect(container.textContent).toBe("ready")
  })

  it("observes state-only Navigate changes without repeating equal state", async () => {
    let update!: (next: number) => void
    let mounts = 0
    const route = createRootRoute({ component: View })
    function View() {
      mounts++
      const [n, setN] = createSignal(1)
      update = (next) => setN(next)
      const navigation = createMemo(() => ({ n: n() }))
      return <Navigate to="/" replace state={navigation()} />
    }
    const router = createRouter({ routeTree: route, history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    await flush()
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))).location.state)
      .toEqual({ n: 1 })
    update(2)
    await flush()
    const match = await Effect.runPromise(
      AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true })
    )
    // Structural state changes navigate even when the URL is identical.
    expect(match.location.state).toEqual({ n: 2 })
    // The state-only update replaces in place and remounts nothing.
    expect(match.location.index).toBe(0)
    await flush()
    expect(mounts).toBe(1)
    expect(container.textContent).toBe("")
  })

  it("awaits transition completion through useNavigate", async () => {
    const started = Effect.runSync(Deferred.make<void>())
    const ready = Effect.runSync(Deferred.make<void>())
    let navigation: Promise<void> | undefined
    let settled = false
    const rootRoute = createRootRoute({ component: Outlet })
    const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home })
    function Home() {
      const navigate = useNavigate()
      return (
        <button
          id="go"
          onClick={() => {
            navigation = navigate({ to: "/slow" })
            navigation.then(
              () => {
                settled = true
              },
              () => {
                settled = false
              }
            )
          }}
        >
          Go
        </button>
      )
    }
    const slow = createRoute({
      getParentRoute: () => rootRoute,
      path: "slow",
      loader: () =>
        Effect.gen(function*() {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(ready)
        }),
      component: () => <p>Arrived</p>
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([home, slow]),
      history: MemoryHistory.layer()
    })
    const { container, registry } = mount(router)
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    container.querySelector<HTMLButtonElement>("#go")!.click()
    await Effect.runPromise(Deferred.await(started))
    await flush()
    // The bridge stays pending while its own transition loads.
    expect(settled).toBe(false)
    Effect.runSync(Deferred.succeed(ready, undefined))
    await navigation!
    // It resolves only after its transition published terminal state.
    expect(settled).toBe(true)
    const match = await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))
    expect(match.location.pathname).toBe("/slow")
    expect(container.textContent).toBe("Arrived")
  })

  it("reports typed navigation failures on the Effect channel", async () => {
    let navigate!: (destination: Destination) => Effect.Effect<void, NavigationError>
    const rootRoute = createRootRoute({ component: Outlet })
    const home = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => {
        navigate = useNavigateEffect()
        return <p>Home</p>
      }
    })
    const project = createRoute({
      getParentRoute: () => rootRoute,
      path: "projects/:id",
      params: { id: Schema.FiniteFromString },
      component: () => <p>Project</p>
    })
    const broken = createRoute({
      getParentRoute: () => rootRoute,
      path: "broken",
      loader: () => Effect.fail("boom"),
      component: () => <p>Never</p>
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([home, project, broken]),
      history: MemoryHistory.layer()
    })
    const { container, registry } = mount(router)
    await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
    // Encoding failures remain typed Effect failures, never synchronous throws,
    // and they leave history untouched.
    const encoded = await Effect.runPromiseExit(
      navigate({ to: "/projects/:id", params: { id: "not-a-number" } } as unknown as Destination)
    )
    expect(encoded._tag).toBe("Failure")
    if (encoded._tag === "Failure") {
      expect((Cause.squash(encoded.cause) as { readonly _tag: string })._tag)
        .toBe("@effect-stack/router/RouteEncodeError")
    }
    expect((await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))).location.pathname)
      .toBe("/")
    expect(container.textContent).toBe("Home")
    // Loader failures surface as typed Effect failures for imperative callers
    // while router state renders the boundary for declarative consumers.
    const load = await Effect.runPromiseExit(navigate({ to: "/broken" }))
    expect(load._tag).toBe("Failure")
    if (load._tag === "Failure") {
      const error = Cause.squash(load.cause) as { readonly _tag: string; readonly error: unknown }
      expect(error._tag).toBe("@effect-stack/router/RouteLoaderError")
      expect(error.error).toBe("boom")
    }
    await flush()
    expect(container.textContent).toBe("Unable to display this route. Retry")
  })

  it("surfaces an actionable failure when a lazy module exports a present null view", async () => {
    const rootRoute = createRootRoute({
      component: Outlet,
      errorComponent: (props) => <p>{String(props.error)}</p>
    })
    const broken = createRoute({
      getParentRoute: () => rootRoute,
      path: "broken",
      // Simulates an untyped JS module that claims a component export but resolves null.
      load: () => Effect.succeed({ default: null as unknown as Component })
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([broken]),
      history: MemoryHistory.layer("/broken")
    })
    const { container, registry } = mount(router)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await Effect.runPromise(
        AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }).pipe(Effect.exit)
      )
      await flush()
      // The selection presents the invalid module rather than silently rendering an Outlet.
      expect(container.textContent).toContain(
        `Route "__root__/broken" selected a lazy module view that is not a Solid component (received null)`
      )
    } finally {
      log.mockRestore()
    }
  })
})
