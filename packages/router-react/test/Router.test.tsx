// @vitest-environment happy-dom
import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-react"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { History, MemoryHistory } from "@effect-stack/router"
import type { DecodedRouteInput } from "@effect-stack/router/Router"
import * as Router from "@effect-stack/router/Router"
import { layer as routerLayer } from "@effect-stack/router/Router"
import {
  Link,
  RouterProvider,
  useRouteInput,
  useRouter,
  useRouterState,
  useNavigateEffect,
  useRetry,
  make,
  makeNavigation,
  Outlet,
  layout,
  route,
  type ViewFailureProps
} from "@effect-stack/router-react"
import * as Context from "effect/Context"
import { Atom } from "effect/reactivity"
import * as React from "react"
import { ErrorBoundary } from "./fixture/ErrorBoundary.tsx"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const memoryRuntime = <R, E>(layer: Layer.Layer<R, E, History.History>, href = "/") =>
  Atom.runtime(layer.pipe(Layer.provide(MemoryHistory.layer(href))))

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

class AreaMissing extends Schema.TaggedError<AreaMissing>()("AreaMissing", { code: Schema.Number }) {}

function SlowPending() {
  return <p role="status">Preparing…</p>
}

function SlowError({ retry }: ViewFailureProps) {
  return <button onClick={retry}>Retry</button>
}

function SlowPage() {
  return <h1>Ready</h1>
}

function AreasLayout() {
  return (
    <div data-testid="areas-layout">
      <h2>Areas layout</h2>
      <Outlet />
    </div>
  )
}

function AreaDetailPage() {
  return <p>detail</p>
}

function AreaDetailError({ failure }: ViewFailureProps<AreaMissing>) {
  return <p data-testid="area-error">Area failed: {failure._tag === "Domain" ? String(failure.error) : "cause"}</p>
}

const areaLoad = () => Effect.fail(new AreaMissing({ code: 1 }))

const buildApp = (
  slowLoad: (input: DecodedRouteInput<{}, {}, undefined>) => Effect.Effect<{ readonly title: string }, never, never>
) => {
  const Slow = route("slow", "/slow", {
    prepare: (input) => slowLoad(input).pipe(Effect.asVoid),
    component: SlowPage,
    error: SlowError
  })
  function HomePage() {
    return (
      <main>
        <h1>Home</h1>
        <Link to={Slow.to()}>Slow</Link>
      </main>
    )
  }
  const Home = route("home", "/", { component: HomePage })
  const Areas = layout("areas", "/areas", { component: AreasLayout })
  const AreaDetail = Areas.route("detail", "/:areaId", {
    params: { areaId: Schema.FiniteFromString },
    prepare: areaLoad,
    component: AreaDetailPage,
    error: AreaDetailError
  })
  return make("React", [Home, Slow, AreaDetail])
}

const mount = (element: React.ReactElement) => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    React.act(() => root.unmount())
    container.remove()
  })
  React.act(() => {
    root.render(element)
  })
  return { container, root }
}

const waitForText = async (container: HTMLElement, text: string, attempts = 100): Promise<boolean> => {
  if ((container.textContent ?? "").includes(text)) return true
  if (attempts <= 0) return false
  await new Promise((resolve) => setTimeout(resolve, 10))
  return waitForText(container, text, attempts - 1)
}

describe("React router adapter", { concurrent: false }, () => {
  it("assembles lazily once per registry and shares scoped services with resource atoms", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    const released = Effect.runSync(Deferred.make<void>())
    let assemblies = 0
    let acquisitions = 0
    let releases = 0
    class Resource extends Context.Service<Resource, { readonly id: number }>()("test/ReactSelectedResource") {}
    const resourceLayer = Layer.effect(
      Resource,
      Effect.acquireRelease(
        Effect.sync(() => ({ id: ++acquisitions })),
        () =>
          Effect.sync(() => {
            releases++
          }).pipe(Effect.andThen(Deferred.succeed(released, undefined)))
      )
    )
    function Page(): React.ReactNode {
      const resource = useAtomValue(resourceAtom)
      return <p>Resource {resource._tag === "Success" ? resource.value.id : "pending"}</p>
    }
    const assembly = make("Selected", [route("home", "/", { component: Page, prepare: () => Effect.asVoid(Resource) })])
    const applicationLayer = routerLayer(
      Effect.gen(function* () {
        yield* Deferred.await(ready)
        const app = yield* assembly
        assemblies++
        return app
      })
    )
    const runtime = Atom.runtime(
      applicationLayer.pipe(Layer.provideMerge(Layer.merge(resourceLayer, MemoryHistory.layer("/"))))
    )
    const resourceAtom = runtime.atom(Resource)
    const applicationAtom = runtime.atom(Router.RuntimeApplication)
    const firstRegistry = AtomRegistry.make()
    const secondRegistry = AtomRegistry.make()
    cleanups.push(
      () => firstRegistry.dispose(),
      () => secondRegistry.dispose()
    )
    expect(assemblies).toBe(0)
    expect(acquisitions).toBe(0)
    const element = (registry: AtomRegistry.AtomRegistry) => (
      <React.StrictMode>
        <RegistryContext.Provider value={registry}>
          <RouterProvider runtime={runtime} pending={SlowPending} />
        </RegistryContext.Provider>
      </React.StrictMode>
    )
    const first = mount(element(firstRegistry))
    await React.act(async () => {})
    expect(first.container.textContent).toContain("Preparing…")
    expect(assemblies).toBe(0)
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(ready, undefined))
    })
    expect(await waitForText(first.container, "Resource 1")).toBe(true)
    await React.act(async () => {
      first.root.render(element(firstRegistry))
    })
    expect(assemblies).toBe(1)
    expect(acquisitions).toBe(1)
    const firstBundle = await Effect.runPromise(AtomRegistry.getResult(firstRegistry, applicationAtom))
    const firstApp = firstBundle.app
    const firstRouter = firstBundle.router
    expect(firstRouter.token).toBe(firstApp.token)
    const second = mount(element(secondRegistry))
    expect(await waitForText(second.container, "Resource 2")).toBe(true)
    const secondApp = (await Effect.runPromise(AtomRegistry.getResult(secondRegistry, applicationAtom))).app
    expect(secondApp.token).not.toBe(firstApp.token)
    expect(secondApp.service.key).not.toBe(firstApp.service.key)
    expect(assemblies).toBe(2)
    expect(acquisitions).toBe(2)
    await React.act(async () => {
      first.root.render(null)
      firstRegistry.dispose()
      await Effect.runPromise(Deferred.await(released))
    })
    expect(releases).toBe(1)
    expect(second.container.textContent).toContain("Resource 2")
  })

  it("shows application assembly defects as startup failures without a route retry", async () => {
    const assembly = make("", [route("home", "/", { component: SlowPage })])
    const runtime = memoryRuntime(routerLayer(assembly))
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Unable to display")).toBe(true)
    expect(container.querySelector('[role="alert"] button')).toBeNull()
    expect(container.textContent).not.toContain("Ready")
  })

  it("rejects a runtime application assembled by another renderer factory", async () => {
    const assembly = Router.make("ForeignFactory", [Router.route("home", "/")])
    const runtime = memoryRuntime(routerLayer(assembly))
    const { container } = mount(
      <RegistryProvider>
        <ErrorBoundary fallback={() => <p>Foreign renderer rejected</p>}>
          <RouterProvider runtime={runtime} />
        </ErrorBoundary>
      </RegistryProvider>
    )
    expect(await waitForText(container, "Foreign renderer rejected")).toBe(true)
    expect(container.textContent).not.toContain("Ready")
  })

  it("reuses native component identities for type-only navigation helpers", async () => {
    const App = await Effect.runPromise(make("ReactHelperIdentity", [route("home", "/", { empty: true })]))
    const first = makeNavigation<typeof App>()
    const second = makeNavigation<typeof App>()
    expect(second.Link).toBe(first.Link)
    expect(second.Navigate).toBe(first.Navigate)
  })

  it("switches between two application runtimes", async () => {
    const First = await Effect.runPromise(
      make("SwitchFirst", [route("first", "/", { component: () => <p>First application</p> })])
    )
    const Second = await Effect.runPromise(
      make("SwitchSecond", [route("second", "/", { component: () => <p>Second application</p> })])
    )
    const firstRuntime = memoryRuntime(routerLayer(Effect.succeed(First)))
    const secondRuntime = memoryRuntime(routerLayer(Effect.succeed(Second)))
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const { container, root } = mount(
      <RegistryContext.Provider value={registry}>
        <RouterProvider runtime={firstRuntime} />
      </RegistryContext.Provider>
    )
    expect(await waitForText(container, "First application")).toBe(true)
    expect("Provider" in First).toBe(false)
    expect("Link" in First).toBe(false)
    await React.act(async () => {
      root.render(
        <RegistryContext.Provider value={registry}>
          <RouterProvider runtime={secondRuntime} />
        </RegistryContext.Provider>
      )
    })
    expect(await waitForText(container, "Second application")).toBe(true)
    expect(container.textContent).not.toContain("First application")
  })

  it("does not resubmit a mounted path Navigate while its redirect gate is blocked", async () => {
    const loginEntered = Effect.runSync(Deferred.make<void>())
    const loginRelease = Effect.runSync(Deferred.make<void>())
    const repeatedRelease = Effect.runSync(Deferred.make<void>())
    const committed = Effect.runSync(Deferred.make<void>())
    const historyReady = Effect.runSync(Deferred.make<MemoryHistory.MemoryHistory>())
    const writes: Array<readonly [string, string]> = []
    let protectedRequests = 0
    let loginRuns = 0
    let loginInterruptions = 0
    let loginCommits = 0
    let navigateMounts = 0
    function PersistentLayout() {
      const [enabled, setEnabled] = React.useState(false)
      const state = useRouterState(App)
      React.useEffect(() => {
        if (
          state.status._tag === "Committed"
          && Option.getOrUndefined(state.resolved)?.location.pathname === "/login"
        ) {
          loginCommits++
          Effect.runSync(Deferred.succeed(committed, undefined))
        }
      }, [state])
      return (
        <>
          <button onClick={() => setEnabled(true)}>Protected</button>
          {enabled && <MountedNavigate />}
          <Outlet />
        </>
      )
    }
    function MountedNavigate() {
      React.useEffect(() => {
        navigateMounts++
      }, [])
      return <Navigation.Navigate to="/protected" />
    }
    const Root = layout("root", "/", { component: PersistentLayout })
    const Login = Root.route("login", "/login", {
      prepare: () =>
        Effect.sync(() => {
          loginRuns++
        }).pipe(
          Effect.andThen(Deferred.succeed(loginEntered, undefined)),
          Effect.andThen(Deferred.await(loginRelease)),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              loginInterruptions++
            })
          )
        ),
      empty: true
    })
    const Protected = Root.route("protected", "/protected", {
      prepare: () => Effect.fail(Router.redirect(Login.to())),
      empty: true
    })
    const App = await Effect.runPromise(make("MountedRedirect", [Root.index({ empty: true }), Protected, Login]))
    const Navigation = makeNavigation<typeof App>()
    const historyLayer = Layer.effect(
      History.History,
      Effect.gen(function* () {
        const history = yield* MemoryHistory.make()
        yield* Deferred.succeed(historyReady, history)
        return {
          ...history,
          push: (destination: History.Destination) =>
            Effect.gen(function* () {
              writes.push(["push", History.toHref(destination)])
              if (destination.pathname === "/protected" && ++protectedRequests > 1) {
                // Bound the broken implementation before it can write and spin again.
                yield* Deferred.await(repeatedRelease)
              }
              return yield* history.push(destination)
            }),
          replace: (destination: History.Destination) =>
            Effect.sync(() => {
              writes.push(["replace", History.toHref(destination)])
            }).pipe(Effect.andThen(history.replace(destination)))
        }
      })
    )
    const runtime = Atom.runtime(routerLayer(Effect.succeed(App)).pipe(Layer.provide(historyLayer)))
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const { container, root } = mount(
      <RegistryContext.Provider value={registry}>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryContext.Provider>
    )
    try {
      await React.act(async () => {})
      await React.act(async () => {
        container.querySelector("button")?.click()
        await Effect.runPromise(Deferred.await(loginEntered))
      })
      // Registry/parent renders must not turn the unchanged logical target into another command.
      await React.act(async () => {
        root.render(
          <RegistryContext.Provider value={registry}>
            <RouterProvider runtime={runtime} pending={SlowPending} />
          </RegistryContext.Provider>
        )
      })
      expect(navigateMounts).toBe(1)
      expect(protectedRequests).toBe(1)
      expect(writes).toEqual([
        ["push", "/protected"],
        ["replace", "/login"]
      ])
      expect(loginRuns).toBe(1)
      expect(loginInterruptions).toBe(0)
      expect(loginCommits).toBe(0)
      await React.act(async () => {
        Effect.runSync(Deferred.succeed(loginRelease, undefined))
        await Effect.runPromise(Deferred.await(committed))
      })
      expect(loginCommits).toBe(1)
      expect(protectedRequests).toBe(1)
      const history = await Effect.runPromise(Deferred.await(historyReady))
      expect(Effect.runSync(history.entries).map(History.toHref)).toEqual(["/", "/login"])
    } finally {
      await React.act(async () => {
        root.render(null)
      })
      registry.dispose()
      Effect.runSync(Deferred.succeed(loginRelease, undefined))
      Effect.runSync(Deferred.succeed(repeatedRelease, undefined))
    }
  })

  it("updates mounted Navigate params, hash, and latest options without reacting to location alone", async () => {
    const historyReady = Effect.runSync(Deferred.make<MemoryHistory.MemoryHistory>())
    const writes: Array<readonly [string, string, unknown]> = []
    let mounts = 0
    function MountedTarget(props: React.ComponentProps<typeof Navigation.Navigate>) {
      React.useEffect(() => {
        mounts++
      }, [])
      return <Navigation.Navigate {...props} />
    }
    function Controls(): React.ReactNode {
      const [target, setTarget] = React.useState<React.ComponentProps<typeof Navigation.Navigate>>()
      Effect.runSync(Deferred.succeed(ready, setTarget))
      return (
        <>
          {target && <MountedTarget {...target} />}
          <Outlet />
        </>
      )
    }
    const Root = layout("root", "/", { component: Controls })
    const Item = Root.route("item", "/items/:id", {
      params: { id: Schema.FiniteFromString },
      hash: Schema.String,
      empty: true
    })
    const App = await Effect.runPromise(make("MountedTargetChanges", [Root.index({ empty: true }), Item]))
    const Navigation = makeNavigation<typeof App>()
    const ready = Effect.runSync(
      Deferred.make<
        React.Dispatch<React.SetStateAction<React.ComponentProps<typeof Navigation.Navigate> | undefined>>
      >()
    )
    const historyLayer = Layer.effect(
      History.History,
      Effect.gen(function* () {
        const history = yield* MemoryHistory.make()
        yield* Deferred.succeed(historyReady, history)
        return {
          ...history,
          push: (destination: History.Destination) =>
            Effect.sync(() => {
              writes.push(["push", History.toHref(destination), destination.state])
            }).pipe(Effect.andThen(history.push(destination))),
          replace: (destination: History.Destination) =>
            Effect.sync(() => {
              writes.push(["replace", History.toHref(destination), destination.state])
            }).pipe(Effect.andThen(history.replace(destination)))
        }
      })
    )
    const runtime = Atom.runtime(routerLayer(Effect.succeed(App)).pipe(Layer.provide(historyLayer)))
    mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    const setTarget = await Effect.runPromise(Deferred.await(ready))
    const history = await Effect.runPromise(Deferred.await(historyReady))
    await React.act(async () => {
      setTarget({ to: "/items/:id", params: { id: 1 }, hash: "first", state: "one" })
    })
    expect(writes).toEqual([["push", "/items/1#first", "one"]])
    await React.act(async () => {
      setTarget({ to: "/items/:id", params: { id: 2 }, hash: "first", state: "two" })
    })
    await React.act(async () => {
      setTarget({ to: "/items/:id", params: { id: 2 }, hash: "next", replace: true, state: "hash" })
    })
    await React.act(async () => {
      setTarget({ to: Item.to({ params: { id: 3 }, hash: "identity" }, { replace: true, state: "default" }) })
    })
    expect(writes).toEqual([
      ["push", "/items/1#first", "one"],
      ["push", "/items/2#first", "two"],
      ["replace", "/items/2#next", "hash"],
      ["replace", "/items/3#identity", "default"]
    ])
    // New identity defaults at the same URL are payload, not a fresh command.
    const latest = Item.to({ params: { id: 3 }, hash: "identity" }, { replace: true, state: "latest" })
    await React.act(async () => {
      setTarget({ to: latest })
    })
    await React.act(async () => {
      await Effect.runPromise(history.go(-1))
    })
    expect(Effect.runSync(history.current).pathname).toBe("/items/1")
    expect(writes).toHaveLength(4)
    // Explicit false is distinct from omission and overrides the latest identity default.
    await React.act(async () => {
      setTarget({ to: latest, replace: false })
    })
    expect(writes.at(-1)).toEqual(["push", "/items/3#identity", "latest"])
    expect(writes).toHaveLength(5)
    await React.act(async () => {
      setTarget({ to: latest, replace: false, state: "state-only" })
    })
    expect(writes).toHaveLength(5)
    expect(Effect.runSync(history.current).state).toBe("latest")
    await React.act(async () => {
      setTarget({
        to: Item.to({ params: { id: 4 }, hash: "encoded space" }, { replace: true, state: "ignored" }),
        replace: false,
        state: "explicit"
      })
    })
    expect(writes.at(-1)).toEqual(["push", "/items/4#encoded%20space", "explicit"])
    expect(writes).toHaveLength(6)
    expect(mounts).toBe(1)
  })

  it("normalizes public navigation forms and preserves identity defaults before history writes", async () => {
    const historyReady = Effect.runSync(Deferred.make<MemoryHistory.MemoryHistory>())
    const entered = Effect.runSync(Deferred.make<void>())
    const Item = route("item", "/items/:id", {
      params: { id: Schema.FiniteFromString },
      search: { page: Schema.FiniteFromString },
      hash: Schema.String,
      prepare: () => Deferred.succeed(entered, undefined).pipe(Effect.asVoid),
      empty: true
    })
    const identity = Item.to(
      { params: { id: 7 }, search: { page: 2 }, hash: "details" },
      {
        replace: true,
        state: { saved: true }
      }
    )
    const Controls = () => {
      const navigate = Navigation.useNavigateEffect()
      Effect.runSync(Deferred.succeed(ready, navigate))
      return (
        <>
          <Navigation.Link to="/plain">Plain</Navigation.Link>
          <Navigation.Link
            {...{
              to: identity,
              params: { id: 99 },
              search: { page: 99 },
              hash: "ignored"
            }}
          >
            Identity
          </Navigation.Link>
          <Outlet />
        </>
      )
    }
    const Root = layout("root", "/", { component: Controls })
    const App = await Effect.runPromise(
      make("ReactTargets", [Root.index({ empty: true }), route("plain", "/plain", { empty: true }), Item])
    )
    const Navigation = makeNavigation<typeof App>()
    const ready = Effect.runSync(Deferred.make<ReturnType<typeof Navigation.useNavigateEffect>>())
    const historyLayer = Layer.effect(
      History.History,
      MemoryHistory.make().pipe(Effect.tap((history) => Deferred.succeed(historyReady, history)))
    )
    const runtime = Atom.runtime(routerLayer(Effect.succeed(App)).pipe(Layer.provide(historyLayer)))
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    await React.act(async () => {
      await Effect.runPromise(Deferred.await(historyReady))
    })
    const navigate = await Effect.runPromise(Deferred.await(ready))
    const history = await Effect.runPromise(Deferred.await(historyReady))
    expect(container.querySelector('a[href="/plain"]')).not.toBeNull()
    const link = container.querySelector('a[href="/items/7?page=2#details"]')
    expect(link).not.toBeNull()
    await React.act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }))
      await Effect.runPromise(Deferred.await(entered))
    })
    expect(Effect.runSync(history.entries)).toHaveLength(1)
    expect(Effect.runSync(history.current).state).toEqual({ saved: true })
    await React.act(async () => {
      await Effect.runPromise(
        navigate({
          to: "/items/:id",
          params: { id: 8 },
          search: { page: 3 },
          hash: "next"
        })
      )
    })
    expect(Effect.runSync(history.current).pathname).toBe("/items/8")
    await React.act(async () => {
      await Effect.runPromise(navigate(identity))
    })
    expect(Effect.runSync(history.current)).toMatchObject({ pathname: "/items/7", state: { saved: true } })
    expect(Effect.runSync(history.entries)).toHaveLength(2)
    const before = Effect.runSync(history.entries)
    // Deliberately invalid runtime input: typed callers cannot select this path.
    const missing = await Effect.runPromise(Effect.result(navigate({ to: "/missing" } as never)))
    expect(Result.isFailure(missing)).toBe(true)
    if (Result.isFailure(missing)) expect(missing.failure).toBeInstanceOf(Router.RouteEncodeError)
    const foreign = route("item", "/items/:id", {
      params: { id: Schema.FiniteFromString },
      search: { page: Schema.FiniteFromString },
      hash: Schema.String,
      empty: true
    })
    const rejected = await Effect.runPromise(
      Effect.result(navigate(foreign.to({ params: { id: 9 }, search: { page: 1 }, hash: "foreign" })))
    )
    expect(Result.isFailure(rejected)).toBe(true)
    expect(Effect.runSync(history.entries)).toEqual(before)
  })

  it("diagnoses an outer bound navigation helper inside an independent inner provider", async () => {
    let diagnosed: unknown
    const InnerPage = route("inner", "/inner", {
      component: () => {
        try {
          useNavigateEffect(Outer)
        } catch (error) {
          diagnosed = error
        }
        return <p>Isolated inner</p>
      }
    })
    const Inner = await Effect.runPromise(make("TokenInner", [InnerPage]))
    const innerRuntime = memoryRuntime(routerLayer(Effect.succeed(Inner)), "/inner")
    const Parent = layout("outer", "/outer", { component: () => <Outlet /> })
    const Leaf = Parent.route("leaf", "/leaf", { component: () => <RouterProvider runtime={innerRuntime} /> })
    const Outer = await Effect.runPromise(make("TokenOuter", [Leaf]))
    const runtime = memoryRuntime(routerLayer(Effect.succeed(Outer)), "/outer/leaf")
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Isolated inner")).toBe(true)
    expect(diagnosed).toBeInstanceOf(Router.RouteDefinitionError)
    if (!(diagnosed instanceof Router.RouteDefinitionError)) throw new Error("missing token diagnosis")
    expect(diagnosed.message).toBe(
      "This bound router helper belongs to a different application than the active provider"
    )
  })

  it("keeps application-owned boundary reset separate from an explicit blocked gate retry", async () => {
    const entered = Effect.runSync(Deferred.make<void>())
    const release = Effect.runSync(Deferred.make<void>())
    let runs = 0
    let shouldThrow = true
    let service: Pick<Router.RouterService<unknown>, "state"> | undefined
    const Page = route("page", "/page", {
      prepare: () =>
        Effect.suspend(() =>
          ++runs === 1
            ? Effect.void
            : Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.asVoid)
        ),
      component: () => {
        service = useRouter(App)
        const retry = useRetry()
        return (
          <ErrorBoundary
            fallback={(reset) => (
              <button
                onClick={() => {
                  reset()
                  retry()
                }}
              >
                Retry blocked
              </button>
            )}
          >
            <ThrowingPage />
          </ErrorBoundary>
        )
      },
      error: () => <p>Route gate failed</p>
    })
    function ThrowingPage() {
      if (shouldThrow) throw new Error("render failure")
      return <p>Retained recovery</p>
    }
    const App = await Effect.runPromise(make("BlockedRenderRetry", [Page]))
    const runtime = memoryRuntime(routerLayer(Effect.succeed(App)), "/page")
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const { container } = mount(
      <RegistryContext.Provider value={registry}>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryContext.Provider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Retry blocked")).toBe(true)
    if (service === undefined) throw new Error("missing router")
    const previous = Option.getOrThrow((await Effect.runPromise(service.state)).resolved)
    shouldThrow = false
    await React.act(async () => {
      container.querySelector("button")?.click()
      await Effect.runPromise(Deferred.await(entered))
    })
    expect(container.textContent).toContain("Retained recovery")
    const blocked = await Effect.runPromise(service.state)
    expect(Option.getOrThrow(blocked.presentation)._tag).toBe("Pending")
    expect(Option.getOrThrow(blocked.resolved)).toBe(previous)
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(release, undefined))
    })
    const observed = service
    await vi.waitFor(async () => {
      const state = await Effect.runPromise(observed.state)
      expect(state.status._tag).toBe("Committed")
      expect(Option.getOrThrow(state.resolved).attempt).toBeGreaterThan(previous.attempt)
    })
  })
  it.each([false, true])(
    "starts a nested provider at depth zero (layouts: %s) and navigates its own history",
    async (layouts) => {
      let innerService: Pick<Router.RouterService<unknown>, "state"> | undefined
      let outerService: Pick<Router.RouterService<unknown>, "state"> | undefined
      const Target = route("target", "/target", { component: () => <p>Inner target</p> })
      const InnerRoot = layout("inner", "/inner", {
        component: () => (
          <section>
            Inner first
            <Outlet />
          </section>
        )
      })
      const InnerMiddle = InnerRoot.layout("middle", "/middle", {
        component: () => (
          <section>
            Inner second
            <Outlet />
          </section>
        )
      })
      function InnerPage() {
        innerService = useRouter(Inner)
        const navigate = Navigation.useNavigate()
        return <button onClick={() => void navigate({ to: "/target" })}>Inner endpoint</button>
      }
      const Endpoint = layouts
        ? InnerMiddle.route("endpoint", "/endpoint", { component: InnerPage })
        : route("endpoint", "/endpoint", { component: InnerPage })
      const Inner = await Effect.runPromise(make("NestedInner", [Endpoint, Target]))
      const Navigation = makeNavigation<typeof Inner>()
      const innerRuntime = memoryRuntime(
        routerLayer(Effect.succeed(Inner)),
        layouts ? "/inner/middle/endpoint" : "/endpoint"
      )
      const OuterRoot = layout("outer", "/outer", { component: () => <Outlet /> })
      const OuterLeaf = OuterRoot.route("leaf", "/leaf", {
        component: () => {
          outerService = useRouter(Outer)
          return <RouterProvider runtime={innerRuntime} />
        }
      })
      const Outer = await Effect.runPromise(make("NestedOuter", [OuterLeaf]))
      const outerRuntime = memoryRuntime(routerLayer(Effect.succeed(Outer)), "/outer/leaf")
      const { container } = mount(
        <RegistryProvider>
          <RouterProvider runtime={outerRuntime} />
        </RegistryProvider>
      )
      await React.act(async () => {})
      expect(await waitForText(container, "Inner endpoint")).toBe(true)
      if (layouts) {
        expect(container.textContent).toContain("Inner first")
        expect(container.textContent).toContain("Inner second")
      }
      expect(innerService).toBeDefined()
      expect(outerService).toBeDefined()
      expect(innerService).not.toBe(outerService)
      await React.act(async () => {
        container.querySelector("button")?.click()
      })
      expect(await waitForText(container, "Inner target")).toBe(true)
      if (innerService === undefined || outerService === undefined) throw new Error("missing independent services")
      expect(Option.getOrThrow((await Effect.runPromise(innerService.state)).location).pathname).toBe("/target")
      expect(Option.getOrThrow((await Effect.runPromise(outerService.state)).location).pathname).toBe("/outer/leaf")
    }
  )
  it("displays inherited transformed hash input in native child and index components", async () => {
    const Hash = Schema.FiniteFromString.pipe(Schema.brand("Hash"))
    const seen: Array<typeof Hash.Type> = []
    const Parent = layout("hashParent", "/hash-parent", { hash: Hash })
    const Nested = Parent.layout("nested", "/nested")
    const Child = Nested.route("child", "/child", {
      prepare: ({ hash }) =>
        Effect.sync(() => {
          seen.push(hash)
        }),
      component: (): React.ReactNode => <p>Child hash: {useRouteInput(Child).hash}</p>
    })
    const Index = Nested.index({
      prepare: ({ hash }) =>
        Effect.sync(() => {
          seen.push(hash)
        }),
      component: (): React.ReactNode => <p>Index hash: {useRouteInput(Index).hash}</p>
    })
    const App = await Effect.runPromise(make("NativeInheritedHash", [Child, Index]))
    for (const [url, text] of [
      ["/hash-parent/nested/child#7", "Child hash: 7"],
      ["/hash-parent/nested#8", "Index hash: 8"]
    ] as const) {
      const runtime = memoryRuntime(routerLayer(Effect.succeed(App)), url)
      const { container } = mount(
        <RegistryProvider>
          <RouterProvider runtime={runtime} pending={SlowPending} />
        </RegistryProvider>
      )
      // oxlint-disable-next-line no-await-in-loop -- Mount each independent runtime sequentially to observe gate order.
      expect(await waitForText(container, text)).toBe(true)
    }
    expect(seen).toEqual([7, 8])
  })

  it("shows pending views, completes gates, and renders native components", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const App = await Effect.runPromise(buildApp(() => Deferred.await(gate).pipe(Effect.as({ title: "Ready" }))))
    const runtime = memoryRuntime(routerLayer(Effect.succeed(App)), "/slow")
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Preparing…")).toBe(true)
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(gate, undefined))
    })
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("renders home and follows a typed link", async () => {
    const App = await Effect.runPromise(buildApp(() => Effect.succeed({ title: "Ready" })))
    const runtime = memoryRuntime(routerLayer(Effect.succeed(App)))
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Home")).toBe(true)
    const link = container.querySelector("a")
    expect(link?.getAttribute("href")).toBe("/slow")
    await React.act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    })
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("keeps the retained branch while a different route is pending", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const App = await Effect.runPromise(buildApp(() => Deferred.await(gate).pipe(Effect.as({ title: "Ready" }))))
    const runtime = memoryRuntime(routerLayer(Effect.succeed(App)))
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Home")).toBe(true)
    const link = container.querySelector("a")
    await React.act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(container.textContent).toContain("Home")
    expect(container.textContent).not.toContain("Unable to display")
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(gate, undefined))
    })
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("keeps ancestor layouts around a nested route failure", async () => {
    const App = await Effect.runPromise(buildApp(() => Effect.succeed({ title: "Ready" })))
    const runtime = memoryRuntime(routerLayer(Effect.succeed(App)), "/areas/7")
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Areas layout")).toBe(true)
    expect(container.textContent).toContain("Area failed")
    expect(container.textContent).not.toContain("Unable to display")
  })

  it("reads coherent input for the displayed definition", async () => {
    function BoundSlow() {
      const input = useRouteInput(BoundSlowDef)
      return <h1>{Object.keys(input.params).length === 0 ? "Bound" : "Wrong"}</h1>
    }
    const BoundSlowDef = route("slow", "/slow", {
      prepare: () => Effect.void,
      component: BoundSlow
    })
    const Home = route("home", "/", { component: () => null })
    const App = await Effect.runPromise(make("React", [Home, BoundSlowDef]))
    const runtime = memoryRuntime(routerLayer(Effect.succeed(App)), "/slow")
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Bound")).toBe(true)
  })

  it("rejects bound helpers from a different application under another provider", async () => {
    const ForeignHome = route("home", "/", { component: () => <h1>Foreign home</h1> })
    const ForeignSlow = route("slow", "/slow", {
      prepare: () => Effect.void,
      component: SlowPage
    })
    const ForeignApp = await Effect.runPromise(make("React", [ForeignHome, ForeignSlow]))
    function ForeignHookHome() {
      useRouter(ForeignApp)
      useRouteInput(ForeignHome)
      return <h1>Leaked</h1>
    }
    function ForeignLinkHome() {
      const Navigation = makeNavigation(ForeignApp)
      return <Navigation.Link to={ForeignSlow.to()}>Foreign link</Navigation.Link>
    }
    const HookApp = await Effect.runPromise(
      make("React", [
        route("home", "/", { component: ForeignHookHome }),
        route("slow", "/slow", { prepare: () => Effect.void, component: SlowPage })
      ])
    )
    const LinkApp = await Effect.runPromise(
      make("React", [
        route("home", "/", { component: ForeignLinkHome }),
        route("slow", "/slow", { prepare: () => Effect.void, component: SlowPage })
      ])
    )
    const hookRuntime = memoryRuntime(routerLayer(Effect.succeed(HookApp)))
    const hook = mount(
      <RegistryProvider>
        <ErrorBoundary fallback={() => <p>Unable to display</p>}>
          <RouterProvider runtime={hookRuntime} />
        </ErrorBoundary>
      </RegistryProvider>
    )
    expect(await waitForText(hook.container, "Unable to display")).toBe(true)
    expect(hook.container.textContent).not.toContain("Leaked")
    const linkRuntime = memoryRuntime(routerLayer(Effect.succeed(LinkApp)))
    const link = mount(
      <RegistryProvider>
        <ErrorBoundary fallback={() => <p>Unable to display</p>}>
          <RouterProvider runtime={linkRuntime} />
        </ErrorBoundary>
      </RegistryProvider>
    )
    expect(await waitForText(link.container, "Unable to display")).toBe(true)
    expect(link.container.textContent).not.toContain("Foreign link")
  })

  it("carries an index hash through encode, decode, and hooks", async () => {
    const Parent = layout("hashParent", "/hash-parent", {
      prepare: () => Effect.void,
      component: () => <Outlet />
    })
    function HashReader() {
      const { hash } = useRouteInput(HashedIndex)
      return <p data-testid="typed">{`${hash}:${hash}`}</p>
    }
    const HashedIndex = Parent.index({
      hash: Schema.String,
      prepare: () => Effect.void,
      component: HashReader
    })
    const App = await Effect.runPromise(make("HashIndex", [HashedIndex]))
    const runtime = memoryRuntime(routerLayer(Effect.succeed(App)), "/hash-parent#deep")
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "deep:deep")).toBe(true)
  })

  it("accepts class and memo components without hidden any", async () => {
    class ClassHome extends React.Component {
      override render() {
        return <h1>Class home</h1>
      }
    }
    const MemoPage = React.memo(() => <h1>Memo</h1>)
    const Home = route("home", "/", {
      prepare: () => Effect.void,
      component: ClassHome
    })
    const Slow = route("slow", "/slow", { prepare: () => Effect.void, component: MemoPage })
    const App = await Effect.runPromise(make("ClassMemo", [Home, Slow]))
    const runtime = memoryRuntime(routerLayer(Effect.succeed(App)))
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Class home")).toBe(true)
  })

  it("renders the startup fallback while a supplied Layer is pending and exposes href early", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const Slow = route("slow", "/slow", {
      prepare: () => Effect.asVoid(StartupService),
      component: () => <h1>Factory ready</h1>
    })
    class StartupService extends Context.Service<StartupService, {}>()("test/ReactStartupPending") {}
    const startup = Layer.effect(StartupService, Deferred.await(gate).pipe(Effect.as({})))
    const App = await Effect.runPromise(make("ReactFactoryPending", [Slow]))
    // Service-independent encoding is available before any runtime exists.
    expect(Result.isSuccess(Router.href(Slow.to()))).toBe(true)
    const runtime = Atom.runtime(
      routerLayer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/slow")), Layer.provide(startup))
    )
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    // The provider renders its pending fallback without a render-time throw.
    expect(container.textContent).toContain("Preparing…")
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(gate, undefined))
    })
    expect(await waitForText(container, "Factory ready")).toBe(true)
  })

  it("renders the startup failure fallback without throwing", async () => {
    class StartupBoom extends Schema.TaggedError<StartupBoom>()("StartupBoom", {}) {}
    const Broken = route("broken", "/broken", {
      prepare: () => Effect.asVoid(StartupService),
      component: SlowPage,
      error: SlowError
    })
    class StartupService extends Context.Service<StartupService, {}>()("test/ReactStartupFailure") {}
    const startup = Layer.effect(StartupService, Effect.fail(new StartupBoom()))
    const App = await Effect.runPromise(make("ReactStartupFailure", [Broken]))
    const runtime = Atom.runtime(
      routerLayer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/broken")), Layer.provide(startup))
    )
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Unable to display")).toBe(true)
    expect(container.querySelector('[role="alert"] button')).toBeNull()
  })

  it("renders the startup failure fallback when initial history acquisition fails", async () => {
    const failure = new History.HistoryError({
      operation: "current",
      message: "Initial history is unavailable",
      cause: new Error("history current failed")
    })
    const history: History.Interface = {
      current: Effect.fail(failure),
      changes: Stream.empty,
      push: () => Effect.die("push must not run during startup"),
      replace: () => Effect.die("replace must not run during startup"),
      go: () => Effect.die("go must not run during startup")
    }
    const prepare = vi.fn(() => Effect.void)
    const component = vi.fn(() => <p>Gated page</p>)
    const assembly = make("ReactInitialHistoryFailure", [route("home", "/", { prepare, component })])
    const runtime = Atom.runtime(routerLayer(assembly).pipe(Layer.provide(Layer.succeed(History.History, history))))
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const { container } = mount(
      <RegistryContext.Provider value={registry}>
        <RouterProvider runtime={runtime} />
      </RegistryContext.Provider>
    )
    await React.act(async () => {
      expect(await Effect.runPromise(AtomRegistry.getResult(registry, runtime).pipe(Effect.flip))).toBe(failure)
    })
    expect(registry.get(runtime)._tag).toBe("Failure")
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("Unable to display this route")
    expect(alert?.querySelector("button")).toBeNull()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.textContent).not.toContain("Loading")
    expect(prepare).not.toHaveBeenCalled()
    expect(component).not.toHaveBeenCalled()
  })

  it("forwards a ref and applies replace and state on the bound link", async () => {
    const ref = React.createRef<HTMLAnchorElement>()
    function TargetPage() {
      const state = useRouterState(App)
      const location = Option.getOrUndefined(state.location)
      return <p data-testid="target-state">{`${location?.index}:${JSON.stringify(location?.state)}`}</p>
    }
    const Target = route("target", "/target", { component: TargetPage })
    function RefHome(): React.ReactNode {
      return (
        <main>
          <h1>Ref home</h1>
          <Navigation.Link to={Target.to()} replace state={{ from: "link" }} ref={ref} />
        </main>
      )
    }
    const App = await Effect.runPromise(make("ReactLinkRef", [route("home", "/", { component: RefHome }), Target]))
    const Navigation = makeNavigation(App)
    const runtime = memoryRuntime(routerLayer(Effect.succeed(App)))
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={SlowPending} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Ref home")).toBe(true)
    expect(ref.current).not.toBeNull()
    expect(ref.current?.tagName).toBe("A")
    expect(ref.current?.getAttribute("href")).toBe("/target")
    await React.act(async () => {
      ref.current?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    })
    expect(await waitForText(container, "0:")).toBe(true)
    expect(container.textContent).toContain('{"from":"link"}')
  })
})
