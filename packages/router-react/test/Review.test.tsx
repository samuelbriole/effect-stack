// @vitest-environment happy-dom
import { MemoryHistory, Router } from "@effect-stack/router"
import {
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorProps,
  Navigate,
  Outlet,
  RouterProvider,
  useNavigate,
  useNavigateEffect
} from "@effect-stack/router-react"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe.sequential("React review regressions", () => {
  it("exposes incoming params and retained data together in a failed-refresh view", async () => {
    const rootRoute = createRootRoute({ component: Outlet })
    const project = createRoute({
      getParentRoute: () => rootRoute,
      path: "projects/:id",
      params: { id: Schema.FiniteFromString },
      loader: ({ params }) => params.id === 1 ? Effect.succeed("one") : Effect.fail("unavailable"),
      component: () => <p>Ready</p>,
      errorComponent: Failure
    })
    function Failure() {
      return <p>Incoming {project.useParams().id}, last {project.useLoaderData()}</p>
    }
    const router = createRouter({
      routeTree: rootRoute.addChildren([project]),
      history: MemoryHistory.layer("/projects/1")
    })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    try {
      await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
      await React.act(async () => {
        await Effect.runPromise(
          router.core.execute(Router.push(project, { params: { id: 2 }, search: {}, hash: "" })).pipe(
            Effect.provideService(AtomRegistry.AtomRegistry, registry),
            Effect.exit
          )
        )
      })
      expect(container.textContent).toBe("Incoming 2, last one")
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
    }
  })

  it("keeps retained loader data paired with its original params while refreshing", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    const rootRoute = createRootRoute({ component: Outlet })
    const project = createRoute({
      getParentRoute: () => rootRoute,
      path: "projects/:id",
      params: { id: Schema.FiniteFromString },
      loader: ({ params }) => params.id === 1 ? Effect.succeed("one") : Deferred.await(ready).pipe(Effect.as("two")),
      component: View
    })
    function View() {
      return <p>{project.useParams().id}:{project.useLoaderData()}</p>
    }
    const router = createRouter({
      routeTree: rootRoute.addChildren([project]),
      history: MemoryHistory.layer("/projects/1")
    })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    try {
      await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
      let navigation!: Promise<void>
      await React.act(async () => {
        navigation = Effect.runPromise(
          router.core.execute(Router.push(project, { params: { id: 2 }, search: {}, hash: "" })).pipe(
            Effect.provideService(AtomRegistry.AtomRegistry, registry)
          )
        )
      })
      expect(container.textContent).toBe("1:one")
      await React.act(async () => {
        Effect.runSync(Deferred.succeed(ready, undefined))
        await navigation
      })
      expect(container.textContent).toBe("2:two")
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
    }
  })

  it("cancels an awaitable navigation through AbortSignal and awaits cleanup", async () => {
    const entered = Effect.runSync(Deferred.make<void>())
    let finalized = false
    let navigate!: ReturnType<typeof useNavigate>
    const rootRoute = createRootRoute({ component: Layout })
    function Layout() {
      navigate = useNavigate()
      return <Outlet />
    }
    const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <p>Home</p> })
    const child = createRoute({
      getParentRoute: () => rootRoute,
      path: "child",
      loader: () =>
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              finalized = true
            })
          )
          yield* Deferred.succeed(entered, undefined)
          return yield* Effect.never
        })
    })
    const router = createRouter({ routeTree: rootRoute.addChildren([home, child]), history: MemoryHistory.layer() })
    const registry = AtomRegistry.make()
    const root = createRoot(document.createElement("div"))
    try {
      await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
      const controller = new AbortController()
      await React.act(async () => {
        const navigation = navigate({ to: "/child" }, { signal: controller.signal })
        const rejection = expect(navigation).rejects.toBeDefined()
        await Effect.runPromise(Deferred.await(entered))
        controller.abort()
        await rejection
      })
      expect(finalized).toBe(true)
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
    }
  })

  it("awaits its navigation and exposes a registry-bound Effect operation", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    const entered = Effect.runSync(Deferred.make<void>())
    let navigate!: ReturnType<typeof useNavigate>
    let navigateEffect!: ReturnType<typeof useNavigateEffect>
    const rootRoute = createRootRoute({ component: Layout })
    function Layout() {
      navigate = useNavigate()
      navigateEffect = useNavigateEffect()
      return <Outlet />
    }
    const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <p>Home</p> })
    const child = createRoute({
      getParentRoute: () => rootRoute,
      path: "child",
      loader: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(ready))),
      component: () => <p>Child</p>
    })
    const router = createRouter({ routeTree: rootRoute.addChildren([home, child]), history: MemoryHistory.layer() })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    try {
      await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
      let complete = false
      let pending!: Promise<void>
      await React.act(async () => {
        pending = navigate({ to: "/child" }).then(() => {
          complete = true
        })
        await Effect.runPromise(Deferred.await(entered))
      })
      expect(complete).toBe(false)
      await React.act(async () => {
        Effect.runSync(Deferred.succeed(ready, undefined))
        await pending
      })
      expect(container.textContent).toBe("Child")
      await React.act(async () => {
        await Effect.runPromise(navigateEffect({ to: "/" }))
      })
      expect(container.textContent).toBe("Home")
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
    }
  })

  it("makes decoded params available in pending views", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    const rootRoute = createRootRoute({ component: Outlet })
    const project = createRoute({
      getParentRoute: () => rootRoute,
      path: "projects/:id",
      params: { id: Schema.FiniteFromString },
      loader: () => Deferred.await(ready),
      pendingComponent: Pending
    })
    function Pending() {
      return <p>Loading {project.useParams().id}</p>
    }
    const router = createRouter({
      routeTree: rootRoute.addChildren([project]),
      history: MemoryHistory.layer("/projects/42")
    })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    try {
      await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
      expect(container.textContent).toBe("Loading 42")
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
    }
  })

  it("recovers from bad data only after the asynchronous refresh succeeds", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    let loads = 0
    const rootRoute = createRootRoute({ component: Outlet, errorComponent: ErrorView })
    function ErrorView(props: ErrorProps) {
      return <button onClick={props.reset}>Retry</button>
    }
    const child = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      loader: () => ++loads === 1 ? Effect.succeed("bad") : Deferred.await(ready).pipe(Effect.as("good")),
      component: Child
    })
    function Child() {
      const data = child.useLoaderData()
      if (data === "bad") throw new Error("bad data")
      return <p>{data}</p>
    }
    const router = createRouter({ routeTree: rootRoute.addChildren([child]), history: MemoryHistory.layer() })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
      expect(container.textContent).toBe("Retry")
      await React.act(async () => container.querySelector("button")!.click())
      expect(container.textContent).toBe("Retry")
      await React.act(async () => {
        Effect.runSync(Deferred.succeed(ready, undefined))
        await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
      })
      expect(container.textContent).toBe("good")
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
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
      return <p>{route.useLoaderData()}</p>
    }
    const router = createRouter({ routeTree: route, layer, history: MemoryHistory.layer() })
    const registry = AtomRegistry.make()
    const container = document.createElement("div")
    const root = createRoot(container)
    try {
      await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
      expect(container.textContent).toBe("Retry startup")
      await React.act(async () => container.querySelector("button")!.click())
      expect(attempts).toBe(2)
      expect(container.textContent).toBe("ready")
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
    }
  })

  it("observes state-only Navigate changes without repeating equal state", async () => {
    let update!: React.Dispatch<React.SetStateAction<number>>
    const route = createRootRoute({ component: View })
    function View() {
      const [n, setN] = React.useState(1)
      update = setN
      return <Navigate to="/" replace state={{ n }} />
    }
    const router = createRouter({ routeTree: route, history: MemoryHistory.layer() })
    const registry = AtomRegistry.make()
    const root = createRoot(document.createElement("div"))
    try {
      await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
      await React.act(async () => update(2))
      const match = await Effect.runPromise(
        AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true })
      )
      expect(match.location.state).toEqual({ n: 2 })
      expect(match.location.index).toBe(0)
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
    }
  })

  it("does not render a params-only ancestor on unrelated asynchronous settlements", async () => {
    let renders = 0
    let loads = 0
    const rootRoute = createRootRoute({
      component: Layout,
      loader: () => Effect.sync(() => ({ title: "root", revision: ++loads }))
    })
    function Layout() {
      rootRoute.useParams()
      rootRoute.useLoaderData((data) => data.title)
      renders++
      return <Outlet />
    }
    const ready = Effect.runSync(Deferred.make<void>())
    const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <p>Home</p> })
    const child = createRoute({
      getParentRoute: () => rootRoute,
      path: "child",
      loader: () => Deferred.await(ready),
      pendingComponent: () => <p>Pending</p>,
      component: () => <p>Child</p>
    })
    const router = createRouter({ routeTree: rootRoute.addChildren([home, child]), history: MemoryHistory.layer() })
    const registry = AtomRegistry.make()
    const root = createRoot(document.createElement("div"))
    try {
      await React.act(async () => root.render(<RouterProvider router={router} registry={registry} />))
      const initial = renders
      await React.act(async () => {
        void Effect
          .runPromise(
            router.core
              .execute(Router.push(child, { params: {}, search: {}, hash: "" }))
              .pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
          )
          .catch(() => {})
      })
      await React.act(async () => {
        Effect.runSync(Deferred.succeed(ready, undefined))
        await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state, { suspendOnWaiting: true }))
      })
      expect(renders).toBe(initial)
      expect(loads).toBe(2)
    } finally {
      await React.act(async () => root.unmount())
      registry.dispose()
    }
  })
})
