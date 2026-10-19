// @vitest-environment happy-dom
import * as Deferred from "effect/Deferred"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as Stream from "effect/Stream"
import { RegistryContext, RegistryProvider, useAtomRefresh, useAtomValue } from "@effect/atom-solid"
import { History, MemoryHistory } from "@effect-stack/router"
import type { RouterRuntimeRequirement } from "@effect-stack/router/AtomRouter"
import type { DecodedRouteInput } from "@effect-stack/router/Router"
import { RouteDefinitionError } from "@effect-stack/router/Router"
import * as Router from "@effect-stack/router/Router"
import {
  Link,
  make,
  layer,
  makeNavigation,
  Outlet,
  RouterProvider,
  layout,
  route,
  useRouteInput,
  useRouter,
  useRouterState,
  useNavigateEffect,
  type ViewFailureProps
} from "@effect-stack/router-solid"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { Atom, AtomRegistry } from "effect/reactivity"
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  ErrorBoundary,
  onCleanup,
  onMount,
  type Accessor,
  type ComponentProps,
  type JSX
} from "solid-js"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it, vi } from "vitest"

const memoryRuntime = <R, E>(routerLayer: Layer.Layer<R, E, History.History>, href = "/") =>
  Atom.runtime(routerLayer.pipe(Layer.provide(MemoryHistory.layer(href))))

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const happyDOMWindow = (
  window as unknown as { happyDOM?: { settings: { navigation: { disableMainFrameNavigation: boolean } } } }
).happyDOM
if (happyDOMWindow !== undefined) happyDOMWindow.settings.navigation.disableMainFrameNavigation = true

class AreaMissing extends Schema.TaggedError<AreaMissing>()("AreaMissing", { code: Schema.Number }) {}

const SlowPending = () => <p role="status">Preparing…</p>
const SlowPage = () => <h1>Ready</h1>
const AreasLayout = () => (
  <div data-testid="areas-layout">
    <h2>Areas layout</h2>
    <Outlet />
  </div>
)
const AreaDetailPage = () => <p>detail</p>
const AreaDetailError = (props: ViewFailureProps<AreaMissing>) => (
  <p data-testid="area-error">Area failed: {props.failure._tag === "Domain" ? String(props.failure.error) : "cause"}</p>
)

const areaLoad = () => Effect.fail(new AreaMissing({ code: 1 }))

const buildApp = (
  slowLoad: (input: DecodedRouteInput<{}, {}, undefined>) => Effect.Effect<{ readonly title: string }, never, never>
) => {
  const Slow = route("slow", "/slow", {
    prepare: (input) => slowLoad(input).pipe(Effect.asVoid),
    component: SlowPage
  })
  const Home = route("home", "/", {
    component: () => (
      <main>
        <h1>Home</h1>
        <Link to={Slow.to()}>Slow</Link>
      </main>
    )
  })
  const Areas = layout("areas", "/areas", { component: AreasLayout })
  const AreaDetail = Areas.route("detail", "/:areaId", {
    params: { areaId: Schema.FiniteFromString },
    prepare: areaLoad,
    component: AreaDetailPage,
    error: AreaDetailError
  })
  return make("Solid", [Home, Slow, AreaDetail])
}

const createContainer = (): HTMLDivElement => {
  const container = document.createElement("div")
  document.body.append(container)
  return container
}

const waitForText = async (container: HTMLElement, text: string, attempts = 100): Promise<boolean> => {
  if ((container.textContent ?? "").includes(text)) return true
  if (attempts <= 0) return false
  await new Promise((resolve) => setTimeout(resolve, 10))
  return waitForText(container, text, attempts - 1)
}

const renderElement = (element: () => JSX.Element): HTMLDivElement => {
  const container = createContainer()
  const dispose = render(element, container)
  cleanups.push(() => {
    dispose()
    container.remove()
  })
  return container
}

const mountApp = <R, ER>(runtime: RouterRuntimeRequirement<R, ER>): HTMLDivElement =>
  renderElement(() => (
    <RegistryProvider>
      <RouterProvider runtime={runtime} pending={SlowPending} />
    </RegistryProvider>
  ))

describe("Solid router adapter", { concurrent: false }, () => {
  it("rejects captured router hooks while runtime assembly refresh is waiting", async () => {
    const blocked = Effect.runSync(Deferred.make<void>())
    let assemblies = 0
    let pushes = 0
    let service: Accessor<Router.RouterService<unknown, unknown>> | undefined
    let navigate: ReturnType<typeof useNavigateEffect> | undefined
    const Page = route("page", "/", {
      component: () => {
        if (navigate === undefined)
          createRoot((dispose) => {
            cleanups.push(dispose)
            service = useRouter()
            navigate = useNavigateEffect()
          })
        return <p>Captured router</p>
      }
    })
    const assembly = Effect.gen(function* () {
      if (++assemblies > 1) {
        yield* Deferred.succeed(blocked, undefined)
        return yield* Effect.never
      }
      return yield* make("WaitingRefresh", [Page])
    })
    const historyLayer = Layer.effect(
      History.History,
      MemoryHistory.make().pipe(
        Effect.map((history) => ({
          ...history,
          push: (destination: History.Destination) =>
            Effect.sync(() => {
              pushes++
            }).pipe(Effect.andThen(history.push(destination)))
        }))
      )
    )
    const runtime = Atom.runtime(layer(assembly).pipe(Layer.provide(historyLayer)))
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const container = renderElement(() => (
      <RegistryContext.Provider value={registry}>
        <RouterProvider runtime={runtime} />
      </RegistryContext.Provider>
    ))
    expect(await waitForText(container, "Captured router")).toBe(true)
    if (service === undefined || navigate === undefined) throw new Error("missing captured router hooks")
    const capturedService = service
    const capturedNavigate = navigate
    registry.refresh(runtime)
    await Effect.runPromise(Deferred.await(blocked))
    expect(() => capturedService()).toThrow("Router service is not available yet")
    expect(Exit.isFailure(await Effect.runPromiseExit(capturedNavigate(Page.to())))).toBe(true)
    expect(pushes).toBe(0)
  })

  it("owns scoped asynchronous assembly and mounts no views before selection", async () => {
    const entered = Effect.runSync(Deferred.make<void>())
    const release = Effect.runSync(Deferred.make<void>())
    const finalized = Effect.runSync(Deferred.make<void>())
    let mounts = 0
    let acquisitions = 0
    const Page = route("page", "/", {
      component: () => {
        mounts++
        return <p>Runtime-owned page</p>
      }
    })
    const assembly = Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          acquisitions++
        }),
        () => Deferred.succeed(finalized, undefined)
      )
      yield* Deferred.succeed(entered, undefined)
      yield* Deferred.await(release)
      return yield* make("ScopedSolid", [Page])
    })
    expect(Router.href(Page.to())).toEqual(Result.succeed("/"))
    const runtime = memoryRuntime(layer(assembly))
    const [pending, setPending] = createSignal(SlowPending)
    const registry = AtomRegistry.make()
    const container = createContainer()
    const dispose = render(
      () => (
        <RegistryContext.Provider value={registry}>
          <RouterProvider runtime={runtime} pending={pending()} />
        </RegistryContext.Provider>
      ),
      container
    )
    try {
      await Effect.runPromise(Deferred.await(entered))
      expect(container.textContent).toContain("Preparing…")
      setPending(() => () => <p>Assembling…</p>)
      expect(container.textContent).toContain("Assembling…")
      expect(mounts).toBe(0)
      expect(Deferred.isDone(finalized).pipe(Effect.runSync)).toBe(false)
      Effect.runSync(Deferred.succeed(release, undefined))
      expect(await waitForText(container, "Runtime-owned page")).toBe(true)
      expect(acquisitions).toBe(1)
      expect(mounts).toBe(1)
      expect(Deferred.isDone(finalized).pipe(Effect.runSync)).toBe(false)
    } finally {
      dispose()
      registry.dispose()
      container.remove()
      Effect.runSync(Deferred.succeed(release, undefined))
    }
    await Effect.runPromise(Deferred.await(finalized))
  })

  it("reuses native component identities for type-only navigation helpers", async () => {
    const App = await Effect.runPromise(make("SolidHelperIdentity", [route("home", "/", { empty: true })]))
    const first = makeNavigation<typeof App>()
    const second = makeNavigation<typeof App>()
    expect(second.Link).toBe(first.Link)
    expect(second.Navigate).toBe(first.Navigate)
  })

  it("renders startup history failure without an unavailable route retry", async () => {
    const failure = new History.HistoryError({ operation: "current", message: "unavailable", cause: "startup" })
    const history: History.Interface = {
      current: Effect.fail(failure),
      changes: Stream.empty,
      push: () => Effect.die("unused"),
      replace: () => Effect.die("unused"),
      go: () => Effect.die("unused")
    }
    const App = await Effect.runPromise(
      make("SolidHistoryStartupFailure", [route("home", "/", { component: () => <p>Home</p> })])
    )
    const runtime = Atom.runtime(
      layer(Effect.succeed(App)).pipe(Layer.provide(Layer.succeed(History.History, history)))
    )
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const container = renderElement(() => (
      <RegistryContext.Provider value={registry}>
        <RouterProvider runtime={runtime} />
      </RegistryContext.Provider>
    ))
    expect(await Effect.runPromise(AtomRegistry.getResult(registry, runtime).pipe(Effect.flip))).toBe(failure)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to display")
    expect(container.querySelector('[role="alert"] button')).toBeNull()
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it("renders typed assembly failure without mounting application views", async () => {
    const failure = new AreaMissing({ code: 2 })
    const Page = route("page", "/", { component: () => <p>Must not mount</p> })
    const assembly = Effect.fail(failure).pipe(Effect.andThen(make("FailedAssembly", [Page])))
    const runtime = memoryRuntime(layer(assembly))
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const container = renderElement(() => (
      <RegistryContext.Provider value={registry}>
        <RouterProvider runtime={runtime} />
      </RegistryContext.Provider>
    ))
    expect(await Effect.runPromise(AtomRegistry.getResult(registry, runtime).pipe(Effect.flip))).toBe(failure)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to display")
    expect(container.querySelector('[role="alert"] button')).toBeNull()
    expect(container.textContent).not.toContain("Must not mount")
  })

  it("refreshes an application resource without implicitly retrying route gates", async () => {
    let gates = 0
    let reads = 0
    const Page = route("page", "/", {
      prepare: () =>
        Effect.sync(() => {
          gates++
        }),
      component: () => {
        const value = useAtomValue(() => resource)
        const refresh = useAtomRefresh(() => resource)
        const text = () => {
          const result = value()
          return result._tag === "Success" ? result.value : "loading"
        }
        return <button onClick={refresh}>Resource {text()}</button>
      }
    })
    const App = await Effect.runPromise(make("ResourceRefresh", [Page]))
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const resource = runtime.atom(Effect.sync(() => ++reads))
    const container = mountApp(runtime)
    expect(await waitForText(container, "Resource 1")).toBe(true)
    container.querySelector("button")?.click()
    expect(await waitForText(container, "Resource 2")).toBe(true)
    expect(gates).toBe(1)
  })

  it("reacts to provider runtime getters and reads the selected views", async () => {
    const First = await Effect.runPromise(
      make("ReactiveSolid", [route("page", "/", { component: () => <p>First application</p> })])
    )
    const Second = await Effect.runPromise(
      make("ReactiveSolid", [route("page", "/", { component: () => <p>Second application</p> })])
    )
    const firstRuntime = memoryRuntime(layer(Effect.succeed(First)))
    const secondRuntime = memoryRuntime(layer(Effect.succeed(Second)))
    const [selected, setSelected] = createSignal({ app: First, runtime: firstRuntime })
    const container = renderElement(() => (
      <RegistryProvider>
        <RouterProvider runtime={selected().runtime} />
      </RegistryProvider>
    ))
    expect(await waitForText(container, "First application")).toBe(true)
    setSelected({ app: Second, runtime: secondRuntime })
    expect(await waitForText(container, "Second application")).toBe(true)
    expect(container.textContent).not.toContain("First application")
  })

  it("rechecks bound service getters when a provider changes application", async () => {
    let observed: Accessor<Router.RouterService<unknown, unknown>> | undefined
    const SharedPage = () => {
      observed = useRouter(First)
      return <p>Bound service</p>
    }
    const Page = route("page", "/", { component: SharedPage })
    const First = await Effect.runPromise(make("GetterToken", [Page]))
    const Second = await Effect.runPromise(make("GetterToken", [Page]))
    const [selected, setSelected] = createSignal({
      app: First,
      runtime: memoryRuntime(layer(Effect.succeed(First)))
    })
    const container = renderElement(() => (
      <RegistryProvider>
        <ErrorBoundary fallback={<p>Token mismatch</p>}>
          <RouterProvider runtime={selected().runtime} />
        </ErrorBoundary>
      </RegistryProvider>
    ))
    expect(await waitForText(container, "Bound service")).toBe(true)
    if (observed === undefined) throw new Error("missing bound service getter")
    setSelected({ app: Second, runtime: memoryRuntime(layer(Effect.succeed(Second))) })
    expect(await waitForText(container, "Token mismatch")).toBe(true)
  })

  it("preserves native link refs and component cleanup across retained navigation", async () => {
    const entered = Effect.runSync(Deferred.make<void>())
    const release = Effect.runSync(Deferred.make<void>())
    let reference: HTMLAnchorElement | undefined
    let mounts = 0
    let disposals = 0
    const Home = route("home", "/", {
      component: () => {
        mounts++
        onCleanup(() => {
          disposals++
        })
        return (
          <Navigation.Link
            to="/target"
            ref={(element: HTMLAnchorElement) => {
              reference = element
            }}
          >
            Ref link
          </Navigation.Link>
        )
      }
    })
    const Target = route("target", "/target", {
      component: () => <p>Committed target</p>,
      prepare: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
    })
    const App = await Effect.runPromise(make("NativeRef", [Home, Target]))
    const Navigation = makeNavigation(App)
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const container = mountApp(runtime)
    expect(await waitForText(container, "Ref link")).toBe(true)
    expect(reference).toBe(container.querySelector("a"))
    reference?.click()
    await Effect.runPromise(Deferred.await(entered))
    expect(container.querySelector("a")).toBe(reference)
    expect(mounts).toBe(1)
    expect(disposals).toBe(0)
    expect(container.textContent).not.toContain("Preparing…")
    Effect.runSync(Deferred.succeed(release, undefined))
    expect(await waitForText(container, "Committed target")).toBe(true)
    expect(disposals).toBe(1)
  })

  it("rechecks bound component tokens after reactive provider replacement", async () => {
    const Page = route("page", "/", { component: () => <Navigation.Link to="/">Bound link</Navigation.Link> })
    const First = await Effect.runPromise(make("ComponentToken", [Page]))
    const Second = await Effect.runPromise(make("ComponentToken", [Page]))
    const Navigation = makeNavigation(First)
    const [selected, setSelected] = createSignal({
      app: First,
      runtime: memoryRuntime(layer(Effect.succeed(First)))
    })
    const container = renderElement(() => (
      <RegistryProvider>
        <ErrorBoundary fallback={<p>Bound component mismatch</p>}>
          <RouterProvider runtime={selected().runtime} />
        </ErrorBoundary>
      </RegistryProvider>
    ))
    expect(await waitForText(container, "Bound link")).toBe(true)
    setSelected({ app: Second, runtime: memoryRuntime(layer(Effect.succeed(Second))) })
    expect(await waitForText(container, "Bound component mismatch")).toBe(true)
    expect(container.querySelector("a")).toBeNull()
  })

  it("does not resubmit a mounted path Navigate while its redirect gate is blocked", async () => {
    const loginEntered = Effect.runSync(Deferred.make<void>())
    const loginRelease = Effect.runSync(Deferred.make<void>())
    const repeatedRelease = Effect.runSync(Deferred.make<void>())
    const committed = Effect.runSync(Deferred.make<void>())
    const ready = Effect.runSync(Deferred.make<() => void>())
    const historyReady = Effect.runSync(Deferred.make<MemoryHistory.MemoryHistory>())
    const writes: Array<readonly [string, string]> = []
    let protectedRequests = 0
    let loginRuns = 0
    let loginInterruptions = 0
    let loginCommits = 0
    let navigateMounts = 0
    let latestState: Router.RouterState | undefined
    const [revision, setRevision] = createSignal(0)
    function MountedNavigate(): JSX.Element {
      onMount(() => {
        navigateMounts++
      })
      const target = createMemo<ComponentProps<typeof Navigation.Navigate>>(() => {
        revision()
        return { to: "/protected" }
      })
      return <Navigation.Navigate {...target()} />
    }
    function PersistentLayout() {
      const [enabled, setEnabled] = createSignal(false)
      const state = useRouterState(App)
      createEffect(() => {
        latestState = state()
        if (latestState.status._tag === "Committed") {
          if (Option.getOrUndefined(latestState.resolved)?.location.pathname === "/login") {
            loginCommits++
            Effect.runSync(Deferred.succeed(committed, undefined))
          } else {
            Effect.runSync(Deferred.succeed(ready, () => setEnabled(true)))
          }
        }
      })
      return (
        <>
          {enabled() && <MountedNavigate />}
          <Outlet />
        </>
      )
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
                // Stop the broken feedback loop before its second history write.
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
    const runtime = Atom.runtime(layer(Effect.succeed(App)).pipe(Layer.provide(historyLayer)))
    const registry = AtomRegistry.make()
    const container = createContainer()
    const dispose = render(
      () => (
        <RegistryContext.Provider value={registry}>
          <RouterProvider runtime={runtime} />
        </RegistryContext.Provider>
      ),
      container
    )
    try {
      const enable = await Effect.runPromise(Deferred.await(ready))
      const previous = latestState?.resolved
      enable()
      await Effect.runPromise(Deferred.await(loginEntered))
      setRevision((value) => value + 1)
      await Effect.runPromise(Effect.yieldNow)
      expect(navigateMounts).toBe(1)
      expect(protectedRequests).toBe(1)
      expect(writes).toEqual([
        ["push", "/protected"],
        ["replace", "/login"]
      ])
      expect(loginRuns).toBe(1)
      expect(loginInterruptions).toBe(0)
      expect(loginCommits).toBe(0)
      expect(latestState?.status._tag).toBe("Pending")
      expect(latestState?.resolved).toBe(previous)
      Effect.runSync(Deferred.succeed(loginRelease, undefined))
      await Effect.runPromise(Deferred.await(committed))
      expect(loginCommits).toBe(1)
      expect(navigateMounts).toBe(1)
      expect(protectedRequests).toBe(1)
      const history = await Effect.runPromise(Deferred.await(historyReady))
      expect(Effect.runSync(history.entries).map(History.toHref)).toEqual(["/", "/login"])
    } finally {
      dispose()
      registry.dispose()
      container.remove()
      Effect.runSync(Deferred.succeed(loginRelease, undefined))
      Effect.runSync(Deferred.succeed(repeatedRelease, undefined))
    }
  })

  it("updates mounted Navigate params, hash, and latest options without reacting to location alone", async () => {
    const historyReady = Effect.runSync(Deferred.make<MemoryHistory.MemoryHistory>())
    const ready = Effect.runSync(Deferred.make<void>())
    const writes: Array<readonly [string, string, unknown]> = []
    let mounts = 0
    let expectedHref = "/"
    let committed = ready
    const [target, setTarget] = createSignal<ComponentProps<typeof Navigation.Navigate>>()
    function MountedTarget(): JSX.Element {
      onMount(() => {
        mounts++
      })
      return <Navigation.Navigate {...(target() ?? { to: "/items/:id", params: { id: 0 }, hash: "" })} />
    }
    function Controls(): JSX.Element {
      const state = useRouterState(App)
      createEffect(() => {
        const current = state()
        if (
          current.status._tag === "Committed"
          && Option.exists(current.resolved, (branch) => History.toHref(branch.location) === expectedHref)
        ) {
          Effect.runSync(Deferred.succeed(committed, undefined))
        }
      })
      return (
        <>
          {target() !== undefined && <MountedTarget />}
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
    const runtime = Atom.runtime(layer(Effect.succeed(App)).pipe(Layer.provide(historyLayer)))
    const registry = AtomRegistry.make()
    const container = createContainer()
    const dispose = render(
      () => (
        <RegistryContext.Provider value={registry}>
          <RouterProvider runtime={runtime} />
        </RegistryContext.Provider>
      ),
      container
    )
    const update = async (href: string, action: () => void) => {
      expectedHref = href
      committed = Effect.runSync(Deferred.make<void>())
      action()
      await Effect.runPromise(Deferred.await(committed))
    }
    try {
      await Effect.runPromise(Deferred.await(ready))
      const history = await Effect.runPromise(Deferred.await(historyReady))
      await update("/items/1#first", () =>
        setTarget({ to: "/items/:id", params: { id: 1 }, hash: "first", state: "one" })
      )
      await update("/items/2#first", () =>
        setTarget({ to: "/items/:id", params: { id: 2 }, hash: "first", state: "two" })
      )
      await update("/items/2#next", () =>
        setTarget({ to: "/items/:id", params: { id: 2 }, hash: "next", replace: true, state: "hash" })
      )
      await update("/items/3#identity", () =>
        setTarget({ to: Item.to({ params: { id: 3 }, hash: "identity" }, { replace: true, state: "default" }) })
      )
      expect(writes).toEqual([
        ["push", "/items/1#first", "one"],
        ["push", "/items/2#first", "two"],
        ["replace", "/items/2#next", "hash"],
        ["replace", "/items/3#identity", "default"]
      ])
      const latest = Item.to({ params: { id: 3 }, hash: "identity" }, { replace: true, state: "latest" })
      setTarget({ to: latest })
      await update("/items/1#first", () => {
        void Effect.runPromise(history.go(-1))
      })
      expect(writes).toHaveLength(4)
      setTarget({ to: Item.to({ params: { id: 3 }, hash: "identity" }, { replace: true, state: "latest" }) })
      await Effect.runPromise(Effect.yieldNow)
      expect(writes).toHaveLength(4)
      await update("/items/3#identity", () => setTarget({ to: latest, replace: false }))
      expect(writes.at(-1)).toEqual(["push", "/items/3#identity", "latest"])
      setTarget({ to: latest, replace: false, state: "state-only" })
      await Effect.runPromise(Effect.yieldNow)
      expect(writes).toHaveLength(5)
      expect(Effect.runSync(history.current).state).toBe("latest")
      await update("/items/4#encoded%20space", () =>
        setTarget({
          to: Item.to({ params: { id: 4 }, hash: "encoded space" }, { replace: true, state: "ignored" }),
          replace: false,
          state: "explicit"
        })
      )
      expect(writes.at(-1)).toEqual(["push", "/items/4#encoded%20space", "explicit"])
      expect(writes).toHaveLength(6)
      // State alone is a command trigger when the observed URL differs.
      await update("/items/3#identity", () => {
        void Effect.runPromise(history.go(-1))
      })
      expect(writes).toHaveLength(6)
      await update("/items/4#encoded%20space", () =>
        setTarget({
          to: Item.to({ params: { id: 4 }, hash: "encoded space" }, { replace: true, state: "ignored" }),
          replace: false,
          state: "latest-explicit"
        })
      )
      expect(writes.at(-1)).toEqual(["push", "/items/4#encoded%20space", "latest-explicit"])
      expect(writes).toHaveLength(7)
      expect(mounts).toBe(1)
    } finally {
      dispose()
      registry.dispose()
      container.remove()
    }
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
      onMount(() => {
        Effect.runSync(Deferred.succeed(ready, navigate))
      })
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
      make("SolidTargets", [Root.index({ empty: true }), route("plain", "/plain", { empty: true }), Item])
    )
    const Navigation = makeNavigation<typeof App>()
    const ready = Effect.runSync(Deferred.make<ReturnType<typeof Navigation.useNavigateEffect>>())
    const historyLayer = Layer.effect(
      History.History,
      MemoryHistory.make().pipe(Effect.tap((history) => Deferred.succeed(historyReady, history)))
    )
    const runtime = Atom.runtime(layer(Effect.succeed(App)).pipe(Layer.provide(historyLayer)))
    const container = mountApp(runtime)
    const navigate = await Effect.runPromise(Deferred.await(ready))
    const history = await Effect.runPromise(Deferred.await(historyReady))
    expect(container.querySelector('a[href="/plain"]')).not.toBeNull()
    const link = container.querySelector('a[href="/items/7?page=2#details"]')
    expect(link).not.toBeNull()
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }))
    await Effect.runPromise(Deferred.await(entered))
    expect(Effect.runSync(history.entries)).toHaveLength(1)
    expect(Effect.runSync(history.current).state).toEqual({ saved: true })
    await Effect.runPromise(navigate({ to: "/items/:id", params: { id: 8 }, search: { page: 3 }, hash: "next" }))
    expect(Effect.runSync(history.current).pathname).toBe("/items/8")
    await Effect.runPromise(navigate(identity))
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
    const defect = new Error("Target getter defect")
    const thrown = await Effect.runPromiseExit(
      navigate({
        get to(): "/" {
          throw defect
        }
      })
    )
    expect(Exit.isFailure(thrown)).toBe(true)
    if (Exit.isFailure(thrown)) {
      expect(thrown.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true)
    }
    expect(Effect.runSync(history.entries)).toEqual(before)
  })

  it("reads reactive target and params after native tuple callbacks before submitting a Link", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    const submitted = Effect.runSync(
      Deferred.make<Router.DecodedRouteInput<{ id: typeof Schema.FiniteFromString }, {}, undefined>>()
    )
    const calls: Array<string> = []
    const Target = route("target", "/items/:id", {
      params: { id: Schema.FiniteFromString },
      empty: true,
      prepare: (input) => Deferred.succeed(submitted, input).pipe(Effect.asVoid)
    })
    const Other = route("other", "/other/:id", {
      params: { id: Schema.FiniteFromString },
      empty: true,
      prepare: (input) => Deferred.succeed(submitted, input).pipe(Effect.asVoid)
    })
    const Home = route("home", "/", {
      component: () => {
        const [id, setId] = createSignal(1)
        const [to, setTo] = createSignal<"/items/:id" | "/other/:id">("/items/:id")
        onMount(() => {
          Effect.runSync(Deferred.succeed(ready, undefined))
        })
        return (
          <Navigation.Link
            to={to()}
            params={{ id: id() }}
            class="native-link"
            title="Forwarded"
            onClick={[
              (data: string, event: MouseEvent) => {
                calls.push(data)
                setId(2)
                setTo("/other/:id")
                event.stopPropagation()
              },
              "fresh"
            ]}
          >
            Go
          </Navigation.Link>
        )
      }
    })
    const App = await Effect.runPromise(make("SolidFreshLink", [Home, Target, Other]))
    const Navigation = makeNavigation<typeof App>()
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const container = mountApp(runtime)
    await Effect.runPromise(Deferred.await(ready))
    const link = container.querySelector('a[href="/items/1"]')
    expect(link?.getAttribute("class")).toBe("native-link")
    expect(link?.getAttribute("title")).toBe("Forwarded")
    const event = new MouseEvent("click", { bubbles: true, button: 0, cancelable: true })
    link?.dispatchEvent(event)
    const input = await Effect.runPromise(Deferred.await(submitted))
    expect(input.params.id).toBe(2)
    expect(input.location.pathname).toBe("/other/2")
    expect(calls).toEqual(["fresh"])
    expect(event.defaultPrevented).toBe(true)
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
    const innerRuntime = memoryRuntime(layer(Effect.succeed(Inner)), "/inner")
    const Parent = layout("outer", "/outer", { component: () => <Outlet /> })
    const Leaf = Parent.route("leaf", "/leaf", { component: () => <RouterProvider runtime={innerRuntime} /> })
    const Outer = await Effect.runPromise(make("TokenOuter", [Leaf]))
    const runtime = memoryRuntime(layer(Effect.succeed(Outer)), "/outer/leaf")
    const container = mountApp(runtime)
    expect(await waitForText(container, "Isolated inner")).toBe(true)
    expect(diagnosed).toBeInstanceOf(Router.RouteDefinitionError)
    if (!(diagnosed instanceof Router.RouteDefinitionError)) throw new Error("missing token diagnosis")
    expect(diagnosed.message).toBe(
      "This bound router helper belongs to a different application than the active provider"
    )
  })

  it("resets an application-owned render boundary without rerunning gates", async () => {
    let runs = 0
    let shouldThrow = true
    let gateErrors = 0
    const Page = route("page", "/page", {
      prepare: () =>
        Effect.sync(() => {
          runs++
        }),
      component: () => {
        if (shouldThrow) throw new Error("render failure")
        return <p>Retained recovery</p>
      },
      error: () => {
        gateErrors++
        return <p>Gate error</p>
      }
    })
    const App = await Effect.runPromise(make("BlockedRenderRetry", [Page]))
    const runtime = memoryRuntime(layer(Effect.succeed(App)), "/page")
    const container = renderElement(() => (
      <RegistryProvider>
        <ErrorBoundary fallback={(_error, reset) => <button onClick={reset}>Reset rendering</button>}>
          <RouterProvider runtime={runtime} />
        </ErrorBoundary>
      </RegistryProvider>
    ))
    expect(await waitForText(container, "Reset rendering")).toBe(true)
    expect(gateErrors).toBe(0)
    shouldThrow = false
    container.querySelector("button")?.click()
    expect(await waitForText(container, "Retained recovery")).toBe(true)
    expect(runs).toBe(1)
    expect(gateErrors).toBe(0)
  })
  it.each([false, true])(
    "starts a nested provider at depth zero (layouts: %s) and navigates its own history",
    async (layouts) => {
      let innerService: (() => Pick<Router.RouterService<unknown>, "state">) | undefined
      let outerService: (() => Pick<Router.RouterService<unknown>, "state">) | undefined
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
      const innerRuntime = memoryRuntime(layer(Effect.succeed(Inner)), layouts ? "/inner/middle/endpoint" : "/endpoint")
      const OuterRoot = layout("outer", "/outer", { component: () => <Outlet /> })
      const OuterLeaf = OuterRoot.route("leaf", "/leaf", {
        component: () => {
          outerService = useRouter(Outer)
          return <RouterProvider runtime={innerRuntime} />
        }
      })
      const Outer = await Effect.runPromise(make("NestedOuter", [OuterLeaf]))
      const outerRuntime = memoryRuntime(layer(Effect.succeed(Outer)), "/outer/leaf")
      const container = mountApp(outerRuntime)
      expect(await waitForText(container, "Inner endpoint")).toBe(true)
      if (layouts) {
        expect(container.textContent).toContain("Inner first")
        expect(container.textContent).toContain("Inner second")
      }
      if (innerService === undefined || outerService === undefined) throw new Error("missing independent services")
      expect(innerService()).not.toBe(outerService())
      container.querySelector("button")?.click()
      expect(await waitForText(container, "Inner target")).toBe(true)
      expect(Option.getOrThrow((await Effect.runPromise(innerService().state)).location).pathname).toBe("/target")
      expect(Option.getOrThrow((await Effect.runPromise(outerService().state)).location).pathname).toBe("/outer/leaf")
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
      component: (): JSX.Element => <p>Child hash: {useRouteInput(Child)().hash}</p>
    })
    const Index = Nested.index({
      prepare: ({ hash }) =>
        Effect.sync(() => {
          seen.push(hash)
        }),
      component: (): JSX.Element => <p>Index hash: {useRouteInput(Index)().hash}</p>
    })
    const App = await Effect.runPromise(make("NativeInheritedHash", [Child, Index]))
    for (const [url, text] of [
      ["/hash-parent/nested/child#7", "Child hash: 7"],
      ["/hash-parent/nested#8", "Index hash: 8"]
    ] as const) {
      const runtime = memoryRuntime(layer(Effect.succeed(App)), url)
      const container = mountApp(runtime)
      // oxlint-disable-next-line no-await-in-loop -- Mount each independent runtime sequentially to observe gate order.
      expect(await waitForText(container, text)).toBe(true)
    }
    expect(seen).toEqual([7, 8])
  })

  it("renders pending then the native component and navigates through a link", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const App = await Effect.runPromise(buildApp(() => Deferred.await(gate).pipe(Effect.as({ title: "Ready" }))))
    const runtime = memoryRuntime(layer(Effect.succeed(App)), "/slow")
    const container = mountApp(runtime)
    expect(await waitForText(container, "Preparing…")).toBe(true)
    Effect.runSync(Deferred.succeed(gate, undefined))
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("reads provider pending component getters during initial preparation", async () => {
    const entered = Effect.runSync(Deferred.make<void>())
    const release = Effect.runSync(Deferred.make<void>())
    const Page = route("page", "/", {
      component: () => <p>Prepared page</p>,
      prepare: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
    })
    const App = await Effect.runPromise(make("ReactivePending", [Page]))
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const [pending, setPending] = createSignal(() => <p>Initial preparation</p>)
    const container = renderElement(() => (
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={pending()} />
      </RegistryProvider>
    ))
    await Effect.runPromise(Deferred.await(entered))
    expect(container.textContent).toContain("Initial preparation")
    setPending(() => () => <p>Updated preparation</p>)
    expect(container.textContent).toContain("Updated preparation")
    Effect.runSync(Deferred.succeed(release, undefined))
    expect(await waitForText(container, "Prepared page")).toBe(true)
  })

  it("renders home and follows a typed link", async () => {
    const App = await Effect.runPromise(buildApp(() => Effect.succeed({ title: "Ready" })))
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const container = mountApp(runtime)
    expect(await waitForText(container, "Home")).toBe(true)
    const link = container.querySelector("a")
    expect(link?.getAttribute("href")).toBe("/slow")
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("keeps the retained branch while a different route is pending", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const App = await Effect.runPromise(buildApp(() => Deferred.await(gate).pipe(Effect.as({ title: "Ready" }))))
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const container = mountApp(runtime)
    expect(await waitForText(container, "Home")).toBe(true)
    container.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(container.textContent).toContain("Home")
    expect(container.textContent).not.toContain("Unable to display")
    Effect.runSync(Deferred.succeed(gate, undefined))
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("keeps ancestor layouts around a nested route failure", async () => {
    const App = await Effect.runPromise(buildApp(() => Effect.succeed({ title: "Ready" })))
    const runtime = memoryRuntime(layer(Effect.succeed(App)), "/areas/7")
    const container = mountApp(runtime)
    expect(await waitForText(container, "Areas layout")).toBe(true)
    expect(container.textContent).toContain("Area failed")
    expect(container.textContent).not.toContain("Unable to display")
  })

  it("retains component identity and local state across a same-route refresh", async () => {
    let mounts = 0
    const IdentityPage = () => {
      onMount(() => {
        mounts += 1
      })
      const [count, setCount] = createSignal(0)
      return (
        <main>
          <h1>Identity</h1>
          <button onClick={() => setCount(count() + 1)}>inc {count()}</button>
          <Link to={Slow.to()}>Again</Link>
        </main>
      )
    }
    const Slow = route("slow", "/slow", { prepare: () => Effect.void, component: IdentityPage })
    const Home = route("home", "/", { component: () => <h1>Home</h1> })
    const App = await Effect.runPromise(make("Solid", [Home, Slow]))
    const runtime = memoryRuntime(layer(Effect.succeed(App)), "/slow")
    const container = mountApp(runtime)
    expect(await waitForText(container, "Identity")).toBe(true)
    expect(mounts).toBe(1)
    container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container.textContent).toContain("inc 1")
    container.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(container.textContent).toContain("inc 1")
    expect(mounts).toBe(1)
  })

  it("updates Link targets when the destination changes", async () => {
    const Slow = route("slow", "/slow", { prepare: () => Effect.void, component: SlowPage })
    const [target, setTarget] = createSignal<Router.Destination<unknown> | undefined>(undefined)
    const DynamicHome = () => (
      <main>
        <h1>Home</h1>
        <Link to={target() as Router.Destination<unknown>}>Go</Link>
      </main>
    )
    const DynamicHomeDef = route("home", "/", { component: DynamicHome })
    setTarget(DynamicHomeDef.to())
    const App = await Effect.runPromise(make("Solid", [DynamicHomeDef, Slow]))
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const container = mountApp(runtime)
    expect(await waitForText(container, "Home")).toBe(true)
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/")
    setTarget(Slow.to())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/slow")
    container.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("updates failure props reactively across same-route failures", async () => {
    const Project = route("project", "/projects/:projectId", {
      params: { projectId: Schema.FiniteFromString },
      prepare: ({ params }) => Effect.fail(new Error(`fail-${params.projectId}`)),
      component: () => <h1>Never</h1>,
      error: (props: ViewFailureProps) => (
        <section>
          <p data-testid="err">{props.failure._tag === "Domain" ? String(props.failure.error) : "cause"}</p>
          <Link to={Project.to({ params: { projectId: 2 } })}>Next</Link>
        </section>
      )
    })
    const Home = route("home", "/", { component: () => <h1>Home</h1> })
    const App = await Effect.runPromise(make("SolidError", [Home, Project]))
    const runtime = memoryRuntime(layer(Effect.succeed(App)), "/projects/1")
    const container = mountApp(runtime)
    expect(await waitForText(container, "fail-1")).toBe(true)
    container.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    expect(await waitForText(container, "fail-2")).toBe(true)
  })

  it("lets application boundaries own native exceptions instead of route gate error views", async () => {
    const MaybeThrow = (): JSX.Element => {
      const input = useRouteInput(Project)
      if (input().params.projectId === 1) throw new Error("bad input")
      return <h1>P{input().params.projectId}</h1>
    }
    const Project = route("project", "/projects/:projectId", {
      params: { projectId: Schema.FiniteFromString },
      prepare: () => Effect.void,
      component: MaybeThrow,
      error: () => <p>Gate failure only</p>
    })
    const Home = route("home", "/", { component: () => <h1>Home</h1> })
    const App = await Effect.runPromise(make("SolidRecovery", [Home, Project]))
    const runtime = memoryRuntime(layer(Effect.succeed(App)), "/projects/1")
    const container = renderElement(() => (
      <RegistryProvider>
        <ErrorBoundary fallback={<p>Native failure</p>}>
          <RouterProvider runtime={runtime} />
        </ErrorBoundary>
      </RegistryProvider>
    ))
    expect(await waitForText(container, "Native failure")).toBe(true)
    expect(container.textContent).not.toContain("Gate failure only")
  })

  it("updates a router-level failure cause across consecutive failures", async () => {
    const asyncCodec = Schema.String.pipe(
      Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transform((input: string) => input),
        encode: SchemaGetter.transformEffect((input: string) => Effect.sleep("1 millis").pipe(Effect.as(input)))
      })
    )
    const Encoded = route("encoded", "/encoded/:id", { params: { id: asyncCodec }, empty: true })
    let mode: "loop" | "encode" = "loop"
    const startTarget = { loop: undefined as undefined | Router.Destination<unknown> }
    const Start = route("start", "/start", {
      prepare: () =>
        Effect.fail(
          mode === "loop"
            ? Router.redirect(startTarget.loop as Router.Destination<unknown>)
            : Router.redirect(Encoded.to({ params: { id: "x" } }))
        ),
      component: () => <h1>start</h1>
    })
    startTarget.loop = Start.to()
    const App = await Effect.runPromise(make("SolidRouterFailure", [Start, Encoded]))
    const runtime = memoryRuntime(layer(Effect.succeed(App)), "/start")
    const container = mountApp(runtime)
    expect(await waitForText(container, "Unable to display")).toBe(true)
    const first = container.querySelector("[data-router-failure]")?.getAttribute("data-router-failure") ?? ""
    expect(first).toContain("Redirect loop")
    mode = "encode"
    container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await vi.waitFor(() => {
      const current = container.querySelector("[data-router-failure]")?.getAttribute("data-router-failure") ?? ""
      expect(current).not.toBe(first)
    })
    const second = container.querySelector("[data-router-failure]")?.getAttribute("data-router-failure") ?? ""
    expect(second).not.toContain("Redirect loop")
  })

  it("rejects bound helpers from a different application under another provider", async () => {
    const ForeignHome = route("home", "/", { component: () => <h1>Foreign home</h1> })
    const ForeignSlow = route("slow", "/slow", {
      prepare: () => Effect.void,
      component: SlowPage
    })
    const ForeignApp = await Effect.runPromise(make("Solid", [ForeignHome, ForeignSlow]))
    const ForeignHookHome = () => {
      useRouter(ForeignApp)()
      return <h1>Leaked</h1>
    }
    const App = await Effect.runPromise(
      make("Solid", [
        route("home", "/", { component: ForeignHookHome }),
        route("slow", "/slow", { prepare: () => Effect.void, component: SlowPage })
      ])
    )
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const container = renderElement(() => (
      <RegistryProvider>
        <ErrorBoundary fallback={<p>Wrong application</p>}>
          <RouterProvider runtime={runtime} />
        </ErrorBoundary>
      </RegistryProvider>
    ))
    expect(await waitForText(container, "Wrong application")).toBe(true)
    expect(container.textContent).not.toContain("Leaked")
  })

  it("rejects headless and copied definitions at finalization", () => {
    const Leaf = route("leaf", "/leaf", { component: () => <h1>Leaf</h1> })
    expect(Effect.runSyncExit(make("Solid", [Leaf]))._tag).toBe("Success")
    const headless = Router.route("headless", "/headless", { prepare: () => Effect.void })
    for (const assembly of [make("Solid", [{ ...(Leaf as object) } as never]), make("Solid", [headless as never])]) {
      expect(Effect.runSyncExit(assembly)).toMatchObject({
        _tag: "Failure",
        cause: { reasons: [{ _tag: "Die", defect: expect.any(RouteDefinitionError) as unknown }] }
      })
    }
  })

  it("carries an index hash through encode, decode, and the useRouteInput accessor", async () => {
    function HashReader() {
      const input = useRouteInput(HashedIndex)
      return <p>{`${input().hash}:${input().hash}`}</p>
    }
    const Parent = layout("hashParent", "/hash-parent", {
      prepare: () => Effect.void,
      component: () => <Outlet />
    })
    const HashedIndex = Parent.index({
      hash: Schema.String,
      prepare: () => Effect.void,
      component: HashReader
    })
    const App = await Effect.runPromise(make("SolidHash", [HashedIndex]))
    const runtime = memoryRuntime(layer(Effect.succeed(App)), "/hash-parent#deep")
    const container = mountApp(runtime)
    expect(await waitForText(container, "deep:deep")).toBe(true)
  })

  it("navigates with a bound path link", async () => {
    function HomePage() {
      return (
        <main>
          <h1>Path home</h1>
          <Navigation.Link to="/projects/:projectId/details" params={{ projectId: 7 }} />
        </main>
      )
    }
    const Home = route("home", "/", { component: HomePage })
    const Projects = layout("projects", "/projects", { component: () => <Outlet /> })
    const ProjectsIndex = Projects.index({ component: () => <p>Path index</p> })
    const Project = Projects.layout("project", "/:projectId", {
      params: { projectId: Schema.FiniteFromString },
      prepare: () => Effect.void
    })
    const ProjectDetails = Project.route("details", "/details", { component: () => <p>Path details</p> })
    const App = await Effect.runPromise(make("SolidPath", [Home, ProjectsIndex, ProjectDetails]))
    const Navigation = makeNavigation(App)
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const container = mountApp(runtime)
    expect(await waitForText(container, "Path home")).toBe(true)
    container
      .querySelector('a[href="/projects/7/details"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    expect(await waitForText(container, "Path details")).toBe(true)
  })

  it("invokes a bound tuple click handler with data and event and honors cancellation", async () => {
    const calls: Array<unknown> = []
    function TupleHome() {
      return (
        <main>
          <h1>Tuple home</h1>
          {Navigation.Link({
            to: "/target",
            onClick: [
              (data: unknown, event: MouseEvent) => {
                calls.push(data)
                event.preventDefault()
              },
              "bound-data"
            ]
          })}
        </main>
      )
    }
    const Home = route("home", "/", { component: TupleHome })
    const Target = route("target", "/target", { component: () => <p>Tuple target</p> })
    const App = await Effect.runPromise(make("SolidTuple", [Home, Target]))
    const Navigation = makeNavigation(App)
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const container = mountApp(runtime)
    expect(await waitForText(container, "Tuple home")).toBe(true)
    await Promise.resolve()
    container
      .querySelector('a[href="/target"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toEqual(["bound-data"])
    // preventDefault in the bound handler cancels router navigation.
    expect(container.textContent).toContain("Tuple home")
    expect(container.textContent).not.toContain("Tuple target")
  })

  it("still routes on stopPropagation and lets the router prevent the anchor default", async () => {
    const events: Array<MouseEvent> = []
    function PropagationHome() {
      return (
        <main>
          <h1>Propagation home</h1>
          {Navigation.Link({
            to: "/target",
            onClick: (event: MouseEvent) => {
              events.push(event)
              event.stopPropagation()
            }
          })}
        </main>
      )
    }
    const Home = route("home", "/", { component: PropagationHome })
    const Target = route("target", "/target", { component: () => <p>Propagation target</p> })
    const App = await Effect.runPromise(make("SolidPropagation", [Home, Target]))
    const Navigation = makeNavigation(App)
    const runtime = memoryRuntime(layer(Effect.succeed(App)))
    const container = mountApp(runtime)
    expect(await waitForText(container, "Propagation home")).toBe(true)
    container
      .querySelector('a[href="/target"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }))
    // stopPropagation alone does not disable client routing, and the router
    // still prevents the native anchor default.
    expect(await waitForText(container, "Propagation target")).toBe(true)
    expect(events[0]?.defaultPrevented).toBe(true)
  })
})
