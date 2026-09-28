// @vitest-environment happy-dom
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { registryKey, useAtomValue } from "@effect/atom-vue"
import { History, MemoryHistory } from "@effect-stack/router"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type { DecodedRouteInput } from "@effect-stack/router/Router"
import { RouteDefinitionError } from "@effect-stack/router/Router"
import * as Router from "@effect-stack/router/Router"
import {
  Link,
  Navigate,
  make,
  makeNavigation,
  Outlet,
  Provider,
  layout,
  route,
  useRouteInput,
  useRouterState,
  useRouter,
  useNavigateEffect,
  type ViewFailureProps
} from "@effect-stack/router-vue"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onMounted,
  onErrorCaptured,
  provide,
  reactive,
  ref,
  render,
  shallowRef,
  watchEffect,
  type Component
} from "vue"

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await nextTick()
}

class AreaMissing extends Schema.TaggedError<AreaMissing>()("AreaMissing", { code: Schema.Number }) {}

const SlowPending = defineComponent({
  name: "SlowPending",
  setup: () => () => h("p", { role: "status" }, "Preparing…")
})

const AreasLayout = defineComponent({
  name: "AreasLayout",
  setup: () => () => h("div", { "data-testid": "areas-layout" }, [h("h2", "Areas layout"), h(Outlet)])
})

const areaLoad = () => Effect.fail(new AreaMissing({ code: 1 }))

const buildApp = (
  slowLoad: (input: DecodedRouteInput<{}, {}, undefined>) => Effect.Effect<{ readonly title: string }, never, never>
) => {
  const Slow = route("slow", "/slow", {
    prepare: (input) => slowLoad(input).pipe(Effect.asVoid),
    render: () => h("h1", "Ready")
  })
  const Home = route("home", "/", {
    component: defineComponent({
      name: "HomePage",
      setup: () => () =>
        h("main", [
          h("h1", "Home"),
          h(Link, { to: Slow.to() }, { default: () => h("span", { "data-testid": "slow-link" }, "Slow") })
        ])
    })
  })
  const Areas = layout("areas", "/areas", { component: AreasLayout })
  const AreaDetail = Areas.route("detail", "/:areaId", {
    params: { areaId: Schema.FiniteFromString },
    prepare: areaLoad,
    render: () => h("p", "detail"),
    error: (props: ViewFailureProps) =>
      h("p", { "data-testid": "area-error" }, `Area failed: ${props.failure._tag === "Domain" ? "domain" : "cause"}`)
  })
  return make("Vue", [Home, Slow, AreaDetail])
}

const mount = (element: ReturnType<typeof h>): HTMLDivElement => {
  const container = document.createElement("div")
  document.body.append(container)
  render(element, container)
  cleanups.push(() => {
    render(null, container)
    container.remove()
  })
  return container
}

const mountWithBoundary = (element: ReturnType<typeof h>): HTMLDivElement =>
  mount(
    h(
      defineComponent({
        setup() {
          const failure = shallowRef<unknown>()
          onErrorCaptured((error) => {
            failure.value = error
            return false
          })
          return () =>
            h("div", [
              element,
              failure.value === undefined ? null : h("p", { "data-testid": "home-boundary" }, "Application error")
            ])
        }
      })
    )
  )

describe("Vue router adapter", { concurrent: false }, () => {
  it("renders startup history failure without an unavailable route retry", async () => {
    const failure = new History.HistoryError({ operation: "current", message: "unavailable", cause: "startup" })
    const history: History.Interface = {
      current: Effect.fail(failure),
      changes: Stream.empty,
      push: () => Effect.die("unused"),
      replace: () => Effect.die("unused"),
      go: () => Effect.die("unused")
    }
    const App = make("VueHistoryStartupFailure", [route("home", "/", { render: () => h("p", "Home") })])
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(Layer.succeed(History.History, history))))
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const container = mount(
      h(
        defineComponent({
          setup() {
            provide(registryKey, registry)
            return () => h(Provider<typeof App>, { app: App, runtime })
          }
        })
      )
    )
    expect(await Effect.runPromise(AtomRegistry.getResult(registry, runtime).pipe(Effect.flip))).toBe(failure)
    await nextTick()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to display")
    expect(container.querySelector('[role="alert"] button')).toBeNull()
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it("preserves a bound functional Link's native anchor ref, attrs, slots, and listener arrays", async () => {
    let anchor: HTMLAnchorElement | null = null
    const calls: Array<string> = []
    const Home = route("home", "/", {
      component: defineComponent({
        setup: () => (): ReturnType<typeof h> =>
          h(
            Navigation.Link,
            {
              to: "/target",
              ref: (value: unknown) => {
                anchor = value instanceof HTMLAnchorElement ? value : null
              },
              title: "Native anchor",
              onClick: [
                () => {
                  calls.push("first")
                },
                (event: MouseEvent) => {
                  calls.push("second")
                  event.preventDefault()
                }
              ]
            },
            { default: () => "Bound slot" }
          )
      })
    })
    const Target = route("target", "/target", { render: () => h("p", "Target") })
    const App = make("NativeBoundRef", [Home, Target])
    const Navigation = makeNavigation(App)
    const runtime = Atom.runtime(Layer.fresh(App.layer.pipe(Layer.provide(MemoryHistory.layer()))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await vi.waitFor(() => expect(container.textContent).toContain("Bound slot"))
    const element = container.querySelector("a")
    expect(anchor).toBe(element)
    expect(element?.getAttribute("title")).toBe("Native anchor")
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }))
    await settle()
    expect(calls).toEqual(["first", "second"])
    expect(container.textContent).toContain("Bound slot")
    expect(container.textContent).not.toContain("Target")
  })

  it("rechecks a bound Link against the current reactive application rather than its initial provider", async () => {
    const Home = route("home", "/", {
      component: defineComponent({
        setup: () => (): ReturnType<typeof h> =>
          h(Navigation.Link, { to: "/target" }, { default: () => "First binding" })
      })
    })
    const Target = route("target", "/target", { empty: true })
    const First = make("ReactiveFirst", [Home, Target])
    const Second = make("ReactiveSecond", [Home, Target])
    const Navigation = makeNavigation(First)
    const app = shallowRef<typeof First | typeof Second>(First)
    const runtime = Atom.runtime(
      Layer.fresh(Layer.merge(First.layer, Second.layer).pipe(Layer.provide(MemoryHistory.layer())))
    )
    const Root = defineComponent({
      setup: () => () => h(Provider<typeof First | typeof Second>, { app: app.value, runtime })
    })
    const container = mountWithBoundary(h(Root))
    await vi.waitFor(() => expect(container.textContent).toContain("First binding"))
    app.value = Second
    await vi.waitFor(() => expect(container.textContent).toContain("Application error"))
  })

  it("accepts a constructor-owned application selected through an ordinary deep ref", async () => {
    const Home = route("home", "/", {
      component: defineComponent({
        setup() {
          const router = useRouter(selected.value)
          const navigation = makeNavigation(selected.value)
          return (): ReturnType<typeof h> => {
            void router()
            return h(navigation.Link, { to: "/" }, { default: () => "Ordinary reactive application" })
          }
        }
      })
    })
    const App = make("OrdinaryRef", [Home])
    const selected = ref(App)
    const runtime = Atom.runtime(Layer.fresh(App.layer.pipe(Layer.provide(MemoryHistory.layer()))))
    const Root = defineComponent({
      setup: () => () => h(Provider<typeof App>, { app: selected.value, runtime })
    })
    const container = mountWithBoundary(h(Root))
    await vi.waitFor(() => expect(container.textContent).toContain("Ordinary reactive application"))
    expect(container.textContent).not.toContain("Application error")
    // Unwrapping a framework proxy never grants a copied object the core's
    // private application registration.
    selected.value = { ...App }
    await vi.waitFor(() => expect(container.textContent).toContain("Application error"))
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
    const revision = shallowRef(0)
    const MountedNavigate = defineComponent({
      setup() {
        onMounted(() => {
          navigateMounts++
        })
        return (): ReturnType<typeof h> => {
          void revision.value
          return h(Navigation.Navigate, { to: "/protected" })
        }
      }
    })
    const PersistentLayout = defineComponent({
      setup() {
        const enabled = shallowRef(false)
        const state = useRouterState(App)
        watchEffect(() => {
          latestState = state.value
          if (latestState.status._tag === "Committed") {
            if (Option.getOrUndefined(latestState.resolved)?.location.pathname === "/login") {
              loginCommits++
              Effect.runSync(Deferred.succeed(committed, undefined))
            } else {
              Effect.runSync(
                Deferred.succeed(ready, () => {
                  enabled.value = true
                })
              )
            }
          }
        })
        return (): ReturnType<typeof h> => h("div", [enabled.value ? h(MountedNavigate) : null, h(Outlet)])
      }
    })
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
    const App = make("MountedRedirect", [Root.index({ empty: true }), Protected, Login])
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
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(historyLayer)))
    const registry = AtomRegistry.make()
    const Parent = defineComponent({
      setup() {
        provide(registryKey, registry)
        return () => h(Provider<typeof App>, { app: App, runtime, "data-revision": revision.value })
      }
    })
    const container = mount(h(Parent))
    try {
      const enable = await Effect.runPromise(Deferred.await(ready))
      const previous = latestState?.resolved
      enable()
      await Effect.runPromise(Deferred.await(loginEntered))
      revision.value++
      await nextTick()
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
      await nextTick()
      expect(loginCommits).toBe(1)
      expect(navigateMounts).toBe(1)
      expect(protectedRequests).toBe(1)
      const history = await Effect.runPromise(Deferred.await(historyReady))
      expect(Effect.runSync(history.entries).map(History.toHref)).toEqual(["/", "/login"])
    } finally {
      render(null, container)
      registry.dispose()
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
    const target = shallowRef<Parameters<typeof Navigation.Navigate>[0]>()
    const MountedTarget = defineComponent({
      setup() {
        onMounted(() => {
          mounts++
        })
        return (): ReturnType<typeof h> | null =>
          target.value === undefined ? null : h(Navigation.Navigate, target.value)
      }
    })
    const Controls = defineComponent({
      setup() {
        const state = useRouterState(App)
        watchEffect(() => {
          const current = state.value
          if (
            current.status._tag === "Committed"
            && Option.exists(current.resolved, (branch) => History.toHref(branch.location) === expectedHref)
          ) {
            Effect.runSync(Deferred.succeed(committed, undefined))
          }
        })
        return (): ReturnType<typeof h> => h("div", [target.value === undefined ? null : h(MountedTarget), h(Outlet)])
      }
    })
    const Root = layout("root", "/", { component: Controls })
    const Item = Root.route("item", "/items/:id", {
      params: { id: Schema.FiniteFromString },
      hash: Schema.String,
      empty: true
    })
    const App = make("MountedTargetChanges", [Root.index({ empty: true }), Item])
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
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(historyLayer)))
    const registry = AtomRegistry.make()
    const Parent = defineComponent({
      setup() {
        provide(registryKey, registry)
        return () => h(Provider<typeof App>, { app: App, runtime })
      }
    })
    const container = mount(h(Parent))
    const update = async (href: string, action: () => void) => {
      expectedHref = href
      committed = Effect.runSync(Deferred.make<void>())
      action()
      await Effect.runPromise(Deferred.await(committed))
      await nextTick()
    }
    try {
      await Effect.runPromise(Deferred.await(ready))
      const history = await Effect.runPromise(Deferred.await(historyReady))
      await update("/items/1#first", () => {
        target.value = { to: "/items/:id", params: { id: 1 }, hash: "first", state: "one" }
      })
      await update("/items/2#first", () => {
        target.value = { to: "/items/:id", params: { id: 2 }, hash: "first", state: "two" }
      })
      await update("/items/2#next", () => {
        target.value = { to: "/items/:id", params: { id: 2 }, hash: "next", replace: true, state: "hash" }
      })
      await update("/items/3#identity", () => {
        target.value = { to: Item.to({ params: { id: 3 }, hash: "identity" }, { replace: true, state: "default" }) }
      })
      expect(writes).toEqual([
        ["push", "/items/1#first", "one"],
        ["push", "/items/2#first", "two"],
        ["replace", "/items/2#next", "hash"],
        ["replace", "/items/3#identity", "default"]
      ])
      const latest = Item.to({ params: { id: 3 }, hash: "identity" }, { replace: true, state: "latest" })
      target.value = { to: latest }
      await nextTick()
      await update("/items/1#first", () => {
        void Effect.runPromise(history.go(-1))
      })
      expect(writes).toHaveLength(4)
      target.value = { to: Item.to({ params: { id: 3 }, hash: "identity" }, { replace: true, state: "latest" }) }
      await nextTick()
      expect(writes).toHaveLength(4)
      await update("/items/3#identity", () => {
        target.value = { to: latest, replace: false }
      })
      expect(writes.at(-1)).toEqual(["push", "/items/3#identity", "latest"])
      target.value = { to: latest, replace: false, state: "state-only" }
      await nextTick()
      expect(writes).toHaveLength(5)
      expect(Effect.runSync(history.current).state).toBe("latest")
      await update("/items/4#encoded%20space", () => {
        target.value = {
          to: Item.to({ params: { id: 4 }, hash: "encoded space" }, { replace: true, state: "ignored" }),
          replace: false,
          state: "explicit"
        }
      })
      expect(writes.at(-1)).toEqual(["push", "/items/4#encoded%20space", "explicit"])
      expect(writes).toHaveLength(6)
      await update("/items/3#identity", () => {
        void Effect.runPromise(history.go(-1))
      })
      expect(writes).toHaveLength(6)
      await update("/items/4#encoded%20space", () => {
        target.value = {
          to: Item.to({ params: { id: 4 }, hash: "encoded space" }, { replace: true, state: "ignored" }),
          replace: false,
          state: "latest-explicit"
        }
      })
      expect(writes.at(-1)).toEqual(["push", "/items/4#encoded%20space", "latest-explicit"])
      expect(writes).toHaveLength(7)
      expect(mounts).toBe(1)
    } finally {
      render(null, container)
      registry.dispose()
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
    const Controls = defineComponent({
      setup() {
        const navigate = Navigation.useNavigateEffect()
        onMounted(() => {
          Effect.runSync(Deferred.succeed(ready, navigate))
        })
        const identityProps: Record<string, unknown> = {
          to: identity,
          params: { id: 99 },
          search: { page: 99 },
          hash: "ignored"
        }
        // Native construction deliberately supplies URL siblings that identity normalization ignores.
        return (): ReturnType<typeof h> =>
          h("main", [h(Navigation.Link, { to: "/plain" }), h(Navigation.Link as Component, identityProps), h(Outlet)])
      }
    })
    const Root = layout("root", "/", { component: Controls })
    const App = make("VueTargets", [Root.index({ empty: true }), route("plain", "/plain", { empty: true }), Item])
    const Navigation = makeNavigation<typeof App>()
    const ready = Effect.runSync(Deferred.make<ReturnType<typeof Navigation.useNavigateEffect>>())
    const historyLayer = Layer.effect(
      History.History,
      MemoryHistory.make().pipe(Effect.tap((history) => Deferred.succeed(historyReady, history)))
    )
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(historyLayer)))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
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
    expect(Effect.runSync(history.entries)).toEqual(before)
    await nextTick()
  })

  it("reads reactive params after native listener arrays before submitting a Link", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    const submitted = Effect.runSync(
      Deferred.make<Router.DecodedRouteInput<{ id: typeof Schema.FiniteFromString }, {}, undefined>>()
    )
    const params = reactive({ id: 1 })
    const calls: Array<string> = []
    const Target = route("target", "/items/:id", {
      params: { id: Schema.FiniteFromString },
      empty: true,
      prepare: (input) => Deferred.succeed(submitted, input).pipe(Effect.asVoid)
    })
    const Home = route("home", "/", {
      component: defineComponent({
        setup() {
          onMounted(() => {
            Effect.runSync(Deferred.succeed(ready, undefined))
          })
          return (): ReturnType<typeof h> =>
            h(
              Navigation.Link,
              {
                to: "/items/:id",
                params,
                class: "native-link",
                title: "Forwarded",
                onClick: [
                  () => {
                    calls.push("first")
                    params.id = 2
                  },
                  (event: MouseEvent) => {
                    calls.push("second")
                    event.stopPropagation()
                  }
                ]
              },
              { default: () => "Go" }
            )
        }
      })
    })
    const App = make("VueFreshLink", [Home, Target])
    const Navigation = makeNavigation<typeof App>()
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await Effect.runPromise(Deferred.await(ready))
    const link = container.querySelector('a[href="/items/1"]')
    expect(link?.getAttribute("class")).toBe("native-link")
    expect(link?.getAttribute("title")).toBe("Forwarded")
    const event = new MouseEvent("click", { bubbles: true, button: 0, cancelable: true })
    link?.dispatchEvent(event)
    const input = await Effect.runPromise(Deferred.await(submitted))
    expect(input.params.id).toBe(2)
    expect(input.location.pathname).toBe("/items/2")
    expect(calls).toEqual(["first", "second"])
    expect(event.defaultPrevented).toBe(true)
    await nextTick()
  })

  it("diagnoses an outer bound navigation helper inside an independent inner provider", async () => {
    let diagnosed: unknown
    const InnerPage = route("inner", "/inner", {
      component: defineComponent({
        setup() {
          try {
            useNavigateEffect(Outer)
          } catch (error) {
            diagnosed = error
          }
          return () => h("p", "Isolated inner")
        }
      })
    })
    const Inner = make("TokenInner", [InnerPage])
    const innerRuntime = Atom.runtime(Layer.fresh(Inner.layer.pipe(Layer.provide(MemoryHistory.layer("/inner")))))
    const Parent = layout("outer", "/outer", { component: () => h(Outlet) })
    const Leaf = Parent.route("leaf", "/leaf", {
      component: () => h(Provider<typeof Inner>, { app: Inner, runtime: innerRuntime })
    })
    const Outer = make("TokenOuter", [Leaf])
    const runtime = Atom.runtime(Layer.fresh(Outer.layer.pipe(Layer.provide(MemoryHistory.layer("/outer/leaf")))))
    const container = mount(h(Provider<typeof Outer>, { app: Outer, runtime }))
    await vi.waitFor(() => expect(container.textContent).toContain("Isolated inner"))
    expect(diagnosed).toBeInstanceOf(Router.RouteDefinitionError)
    if (!(diagnosed instanceof Router.RouteDefinitionError)) throw new Error("missing token diagnosis")
    expect(diagnosed.message).toBe(
      "This bound router helper belongs to a different application than the active provider"
    )
  })

  it.each(["component", "render"] as const)(
    "leaves %s exceptions and reset to application boundaries without rerunning gates",
    async (kind) => {
      let runs = 0
      let shouldThrow = true
      let routeErrors = 0
      const draw = () => {
        if (shouldThrow) throw new Error("native render failure")
        return h("p", "Application recovered")
      }
      const Boundary = defineComponent({
        setup() {
          const failed = shallowRef(false)
          onErrorCaptured(() => {
            failed.value = true
            return false
          })
          return () =>
            failed.value
              ? h(
                  "button",
                  {
                    onClick: () => {
                      shouldThrow = false
                      failed.value = false
                    }
                  },
                  "Reset application"
                )
              : h(Outlet)
        }
      })
      const Root = layout("root", "/", { component: Boundary })
      const Page = Root.route("page", "/page", {
        prepare: () =>
          Effect.sync(() => {
            runs++
          }),
        ...(kind === "component" ? { component: defineComponent({ setup: () => draw }) } : { render: draw }),
        error: () => {
          routeErrors++
          return h("p", "Route error")
        }
      })
      const App = make("NativeBoundary", [Page])
      const runtime = Atom.runtime(Layer.fresh(App.layer.pipe(Layer.provide(MemoryHistory.layer("/page")))))
      const container = mount(h(Provider<typeof App>, { app: App, runtime }))
      await vi.waitFor(() => expect(container.textContent).toContain("Reset application"))
      expect(routeErrors).toBe(0)
      expect(runs).toBe(1)
      container.querySelector("button")?.click()
      await vi.waitFor(() => expect(container.textContent).toContain("Application recovered"))
      expect(runs).toBe(1)
    }
  )
  it.each([false, true])(
    "starts a nested provider at depth zero (layouts: %s) and navigates its own history",
    async (layouts) => {
      let innerService: (() => Pick<Router.RouterService<unknown>, "state">) | undefined
      let outerService: (() => Pick<Router.RouterService<unknown>, "state">) | undefined
      const Target = route("target", "/target", { render: () => h("p", "Inner target") })
      const InnerRoot = layout("inner", "/inner", { component: () => h("section", ["Inner first", h(Outlet)]) })
      const InnerMiddle = InnerRoot.layout("middle", "/middle", {
        component: () => h("section", ["Inner second", h(Outlet)])
      })
      const InnerPage = defineComponent({
        setup() {
          innerService = useRouter(Inner)
          const navigate = Navigation.useNavigate()
          return () => h("button", { onClick: () => void navigate({ to: "/target" }) }, "Inner endpoint")
        }
      })
      const Endpoint = layouts
        ? InnerMiddle.route("endpoint", "/endpoint", { component: InnerPage })
        : route("endpoint", "/endpoint", { component: InnerPage })
      const Inner = make("NestedInner", [Endpoint, Target])
      const Navigation = makeNavigation<typeof Inner>()
      const innerRuntime = Atom.runtime(
        Layer.fresh(
          Inner.layer.pipe(Layer.provide(MemoryHistory.layer(layouts ? "/inner/middle/endpoint" : "/endpoint")))
        )
      )
      const OuterRoot = layout("outer", "/outer", { component: () => h(Outlet) })
      const OuterLeaf = OuterRoot.route("leaf", "/leaf", {
        component: defineComponent({
          setup() {
            outerService = useRouter(Outer)
            return () => h(Provider<typeof Inner>, { app: Inner, runtime: innerRuntime })
          }
        })
      })
      const Outer = make("NestedOuter", [OuterLeaf])
      const outerRuntime = Atom.runtime(
        Layer.fresh(Outer.layer.pipe(Layer.provide(MemoryHistory.layer("/outer/leaf"))))
      )
      const container = mount(h(Provider<typeof Outer>, { app: Outer, runtime: outerRuntime }))
      await vi.waitFor(() => expect(container.textContent).toContain("Inner endpoint"))
      if (layouts) {
        expect(container.textContent).toContain("Inner first")
        expect(container.textContent).toContain("Inner second")
      }
      if (innerService === undefined || outerService === undefined) throw new Error("missing independent services")
      expect(innerService()).not.toBe(outerService())
      container.querySelector("button")?.click()
      await vi.waitFor(() => expect(container.textContent).toContain("Inner target"))
      expect(Option.getOrThrow((await Effect.runPromise(innerService().state)).location).pathname).toBe("/target")
      expect(Option.getOrThrow((await Effect.runPromise(outerService().state)).location).pathname).toBe("/outer/leaf")
    }
  )

  it.each([
    ["Link", undefined, false],
    ["Link", false, false],
    ["Navigate", undefined, false],
    ["Navigate", false, false],
    ["Link", undefined, true],
    ["Link", false, true],
    ["Navigate", undefined, true],
    ["Navigate", false, true]
  ] as const)(
    "preserves destination replace defaults for %s (override: %s, bound: %s)",
    async (kind, replace, bound) => {
      let history: MemoryHistory.MemoryHistory | undefined
      const historyLayer = Layer.effect(
        History.History,
        MemoryHistory.make("/").pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              history = value
            })
          )
        )
      )
      const Target = route("target", "/target", { render: () => h("p", "Replace target") })
      const Home = route("home", "/", {
        render: (): ReturnType<typeof h> => {
          const props = {
            to: Target.to({}, { replace: true }),
            ...(replace === undefined ? {} : { replace })
          }
          const slots = { default: () => "Go" }
          if (bound)
            return kind === "Link"
              ? h(makeNavigation(App).Link, props, slots)
              : h(makeNavigation(App).Navigate, props, slots)
          return kind === "Link" ? h(Link, props, slots) : h(Navigate, props, slots)
        }
      })
      const App = make("ReplaceDefaults", [Home, Target])
      const runtime = Atom.runtime(Layer.fresh(App.layer.pipe(Layer.provide(historyLayer))))
      const container = mount(h(Provider<typeof App>, { app: App, runtime }))
      if (kind === "Link") {
        await vi.waitFor(() => expect(container.querySelector("a")).not.toBeNull())
        container.querySelector("a")?.click()
      }
      await vi.waitFor(() => expect(container.textContent).toContain("Replace target"))
      if (history === undefined) throw new Error("missing memory history")
      expect((await Effect.runPromise(history.current)).index).toBe(replace === false ? 1 : 0)
      expect((await Effect.runPromise(history.entries)).map((entry) => entry.pathname)).toEqual(
        replace === false ? ["/", "/target"] : ["/target"]
      )
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
      component: defineComponent({
        setup() {
          const input = useRouteInput(Child)
          return (): ReturnType<typeof h> => h("p", `Child hash: ${input.value.hash}`)
        }
      })
    })
    const Index = Nested.index({
      prepare: ({ hash }) =>
        Effect.sync(() => {
          seen.push(hash)
        }),
      component: defineComponent({
        setup() {
          const input = useRouteInput(Index)
          return (): ReturnType<typeof h> => h("p", `Index hash: ${input.value.hash}`)
        }
      })
    })
    const App = make("NativeInheritedHash", [Child, Index])
    for (const [url, text] of [
      ["/hash-parent/nested/child#7", "Child hash: 7"],
      ["/hash-parent/nested#8", "Index hash: 8"]
    ] as const) {
      // Vue's default registry is shared; isolate each intentionally independent history acquisition.
      const runtime = Atom.runtime(Layer.fresh(App.layer.pipe(Layer.provide(MemoryHistory.layer(url)))))
      const container = mount(h(Provider<typeof App>, { app: App, runtime }))
      // oxlint-disable-next-line no-await-in-loop -- Mount each independent runtime sequentially to observe gate order.
      await settle()
      // oxlint-disable-next-line no-await-in-loop -- Flush the native renderer before inspecting this runtime.
      await settle()
      expect(container.textContent).toContain(text)
    }
    expect(seen).toEqual([7, 8])
  })

  it("renders pending then the native component and navigates through a link", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const App = buildApp(() => Deferred.await(gate).pipe(Effect.as({ title: "Ready" })))
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/slow"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime, pending: SlowPending }))
    await settle()
    expect(container.textContent).toContain("Preparing…")
    Effect.runSync(Deferred.succeed(gate, undefined))
    await settle()
    expect(container.textContent).toContain("Ready")
  })

  it("renders home and follows a typed link", async () => {
    const App = buildApp(() => Effect.succeed({ title: "Ready" }))
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    expect(container.textContent).toContain("Home")
    expect(container.querySelector('[data-testid="slow-link"]')?.textContent).toBe("Slow")
    const link = container.querySelector("a")
    expect(link?.getAttribute("href")).toBe("/slow")
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await settle()
    await settle()
    expect(container.textContent).toContain("Ready")
  })

  it("keeps the retained branch while a different route is pending", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const App = buildApp(() => Deferred.await(gate).pipe(Effect.as({ title: "Ready" })))
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    expect(container.textContent).toContain("Home")
    container.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await settle()
    await settle()
    expect(container.textContent).toContain("Home")
    expect(container.textContent).not.toContain("Unable to display")
    Effect.runSync(Deferred.succeed(gate, undefined))
    await settle()
    await settle()
    expect(container.textContent).toContain("Ready")
  })

  it("keeps displayed input and runtime-owned resources coherent without remounting during preparation", async () => {
    const entered = Effect.runSync(Deferred.make<void>())
    const release = Effect.runSync(Deferred.make<void>())
    const resources: Array<number> = []
    let mounts = 0
    let submit: (() => Promise<Router.NavigationOutcome>) | undefined
    const Page = defineComponent({
      setup() {
        mounts++
        const input = useRouteInput(Item)
        const selected = computed(() => resource(input.value.params.id))
        const result = useAtomValue(() => selected.value)
        const navigate = makeNavigation<typeof App>().useNavigate()
        submit = () => navigate({ to: "/items/:id", params: { id: 2 } })
        return (): ReturnType<typeof h> =>
          h("p", [
            `Input ${input.value.params.id}; `,
            AsyncResult.isSuccess(result.value) ? result.value.value : "Resource loading"
          ])
      }
    })
    const Item = route("item", "/items/:id", {
      params: { id: Schema.FiniteFromString },
      prepare: ({ params }) =>
        params.id === 2
          ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
          : Effect.void,
      component: Page
    })
    const App = make("RetainedResources", [Item])
    const runtime = Atom.runtime(Layer.fresh(App.layer.pipe(Layer.provide(MemoryHistory.layer("/items/1")))))
    const resource = Atom.family((id: number) =>
      runtime.atom(
        Effect.sync(() => {
          resources.push(id)
          return `Resource ${id}`
        })
      )
    )
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await vi.waitFor(() => expect(container.textContent).toContain("Input 1; Resource 1"))
    if (submit === undefined) throw new Error("missing navigation")
    const completed = submit()
    await Effect.runPromise(Deferred.await(entered))
    await settle()
    expect(container.textContent).toContain("Input 1; Resource 1")
    expect(resources).toEqual([1])
    expect(mounts).toBe(1)
    Effect.runSync(Deferred.succeed(release, undefined))
    await completed
    await vi.waitFor(() => expect(container.textContent).toContain("Input 2; Resource 2"))
    expect(resources).toEqual([1, 2])
    expect(mounts).toBe(1)
  })

  it("keeps ancestor layouts around a nested route failure", async () => {
    const App = buildApp(() => Effect.succeed({ title: "Ready" }))
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/areas/7"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    await settle()
    expect(container.textContent).toContain("Areas layout")
    expect(container.textContent).toContain("Area failed")
    expect(container.textContent).not.toContain("Unable to display")
  })

  it("rejects bound helpers from a different application under another provider", async () => {
    let diagnosed: unknown
    const ForeignHome = route("home", "/", { component: () => h("h1", "Foreign home") })
    const ForeignSlow = route("slow", "/slow", {
      prepare: () => Effect.void,
      render: () => h("h1", "Foreign")
    })
    const ForeignApp = make("Vue", [ForeignHome, ForeignSlow])
    const ForeignHookHome = defineComponent({
      name: "ForeignHookHome",
      setup() {
        try {
          useRouter(ForeignApp)
        } catch (error) {
          diagnosed = error
        }
        return () => h("h1", "Leaked")
      }
    })
    const App = make("Vue", [
      route("home", "/", { component: ForeignHookHome }),
      route("slow", "/slow", { prepare: () => Effect.void, render: () => h("h1", "Ready") })
    ])
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    await settle()
    expect(diagnosed).toBeInstanceOf(RouteDefinitionError)
    expect(container.textContent).toContain("Leaked")
  })

  it("rejects headless and copied definitions at finalization", () => {
    const Leaf = route("leaf", "/leaf", { render: () => h("h1", "Leaf") })
    expect(() => make("Vue", [Leaf])).not.toThrow()
    expect(() => make("Vue", [{ ...(Leaf as object) } as never])).toThrow(RouteDefinitionError)
    const headless = Router.route("headless", "/headless", { prepare: () => Effect.void })
    expect(() => make("Vue", [headless as never])).toThrow(RouteDefinitionError)
  })

  it("carries an index hash through encode, decode, and the useRouteInput ref", async () => {
    const Parent = layout("hashParent", "/hash-parent", {
      prepare: () => Effect.void,
      component: () => h(Outlet)
    })
    const HashedIndex = Parent.index({
      hash: Schema.String,
      prepare: () => Effect.void,
      component: defineComponent({
        setup(): () => ReturnType<typeof h> {
          const input = useRouteInput(HashedIndex)
          return () => h("p", `${input.value.hash}:${input.value.hash}`)
        }
      })
    })
    const App = make("VueHash", [HashedIndex])
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/hash-parent#deep"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    expect(container.textContent).toContain("deep:deep")
  })

  it("navigates with a bound path link", async () => {
    const appRef = { Link: undefined as unknown as Component }
    const HomePage = defineComponent({
      name: "PathHome",
      setup: () => () =>
        h("main", [
          h("h1", "Path home"),
          h(appRef.Link as never, { to: "/projects/:projectId/details", params: { projectId: 7 } })
        ])
    })
    const Home = route("home", "/", { component: HomePage })
    const Projects = layout("projects", "/projects", { component: () => h(Outlet) })
    const ProjectsIndex = Projects.index({ component: () => h("p", "Path index") })
    const Project = Projects.layout("project", "/:projectId", {
      params: { projectId: Schema.FiniteFromString },
      prepare: () => Effect.void
    })
    const ProjectDetails = Project.route("details", "/details", { component: () => h("p", "Path details") })
    const App = make("VuePath", [Home, ProjectsIndex, ProjectDetails])
    appRef.Link = makeNavigation(App).Link as unknown as Component
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    expect(container.textContent).toContain("Path home")
    container
      .querySelector('a[href="/projects/7/details"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await settle()
    await settle()
    expect(container.textContent).toContain("Path details")
  })

  it("runs array click handlers in order and honors native cancellation", async () => {
    const calls: Array<string> = []
    const appRef = { Link: undefined as unknown as Component }
    const HomePage = defineComponent({
      name: "ArrayHome",
      setup: () => () =>
        h("main", [
          h("h1", "Array home"),
          h(
            appRef.Link as never,
            {
              to: "/target",
              onClick: [
                (event: MouseEvent) => {
                  calls.push("first")
                  event.preventDefault()
                },
                () => {
                  calls.push("second")
                }
              ]
            },
            { default: () => "Go" }
          )
        ])
    })
    const Home = route("home", "/", { component: HomePage })
    const Target = route("target", "/target", { component: () => h("p", "Array target") })
    const App = make("VueArray", [Home, Target])
    appRef.Link = makeNavigation(App).Link as unknown as Component
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    expect(container.textContent).toContain("Array home")
    container
      .querySelector('a[href="/target"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }))
    await settle()
    await settle()
    expect(calls).toEqual(["first", "second"])
    // preventDefault in an array handler cancels native router navigation.
    expect(container.textContent).toContain("Array home")
    expect(container.textContent).not.toContain("Array target")
  })

  it("stops remaining array handlers after stopImmediatePropagation and cancels routing", async () => {
    const calls: Array<string> = []
    const appRef = { Link: undefined as unknown as Component }
    const HomePage = defineComponent({
      name: "StopHome",
      setup: () => () =>
        h("main", [
          h("h1", "Stop home"),
          h(
            appRef.Link as never,
            {
              to: "/target",
              onClick: [
                (event: MouseEvent) => {
                  calls.push("first")
                  event.stopImmediatePropagation()
                },
                () => {
                  calls.push("second")
                }
              ]
            },
            { default: () => "Go" }
          )
        ])
    })
    const Home = route("home", "/", { component: HomePage })
    const Target = route("target", "/target", { component: () => h("p", "Stop target") })
    const App = make("VueStop", [Home, Target])
    appRef.Link = makeNavigation(App).Link as unknown as Component
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    container
      .querySelector('a[href="/target"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }))
    await settle()
    await settle()
    expect(calls).toEqual(["first"])
    expect(container.textContent).toContain("Stop home")
    expect(container.textContent).not.toContain("Stop target")
  })

  it("still routes on stopPropagation and lets the router prevent the anchor default", async () => {
    const calls: Array<string> = []
    const events: Array<MouseEvent> = []
    const documentClicks: Array<Event> = []
    const onDocument = (event: Event) => {
      documentClicks.push(event)
    }
    document.addEventListener("click", onDocument)
    cleanups.push(() => document.removeEventListener("click", onDocument))
    const appRef = { Link: undefined as unknown as Component }
    const HomePage = defineComponent({
      name: "PropagationHome",
      setup: () => () =>
        h("main", [
          h("h1", "Propagation home"),
          h(
            appRef.Link as never,
            {
              to: "/target",
              onClick: (event: MouseEvent) => {
                calls.push("user")
                events.push(event)
                event.stopPropagation()
              }
            },
            { default: () => "Go" }
          )
        ])
    })
    const Home = route("home", "/", { component: HomePage })
    const Target = route("target", "/target", { component: () => h("p", "Propagation target") })
    const App = make("VuePropagation", [Home, Target])
    appRef.Link = makeNavigation(App).Link as unknown as Component
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const container = mount(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    container
      .querySelector('a[href="/target"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }))
    await settle()
    await settle()
    // stopPropagation alone does not disable client routing...
    expect(calls).toEqual(["user"])
    expect(container.textContent).toContain("Propagation target")
    // ...the router still prevents the native anchor default...
    expect(events[0]?.defaultPrevented).toBe(true)
    // ...while the user's stopPropagation kept the event from bubbling.
    expect(documentClicks).toEqual([])
  })

  it("hands native listener rejections to the application boundary, not an unhandled rejection", async () => {
    const appRef = { Link: undefined as unknown as Component }
    const HomePage = defineComponent({
      name: "AsyncThrowHome",
      setup: () => () =>
        h("main", [
          h("h1", "Async home"),
          h(
            appRef.Link as never,
            {
              to: "/target",
              onClick: async (event: MouseEvent) => {
                event.preventDefault()
                throw new Error("async boom")
              }
            },
            { default: () => "Go" }
          )
        ])
    })
    const Home = route("home", "/", {
      component: HomePage,
      error: () => h("p", { "data-testid": "home-boundary" }, "Home boundary")
    })
    const Target = route("target", "/target", { component: () => h("p", "Async target") })
    const App = make("VueAsyncThrow", [Home, Target])
    appRef.Link = makeNavigation(App).Link as unknown as Component
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const container = mountWithBoundary(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    container
      .querySelector('a[href="/target"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }))
    await settle()
    await settle()
    // Vue's native invoker sends the rejection to the application boundary.
    expect(container.querySelector('[data-testid="home-boundary"]')).not.toBeNull()
    expect(container.textContent).not.toContain("Async target")
  })

  it("keeps invoking later array listeners after an earlier native listener rejection", async () => {
    const calls: Array<string> = []
    const appRef = { Link: undefined as unknown as Component }
    const HomePage = defineComponent({
      name: "ArrayThrowHome",
      setup: () => () =>
        h("main", [
          h("h1", "Array throw home"),
          h(
            appRef.Link as never,
            {
              to: "/target",
              onClick: [
                async (event: MouseEvent) => {
                  calls.push("first")
                  event.preventDefault()
                  throw new Error("first boom")
                },
                () => {
                  calls.push("second")
                }
              ]
            },
            { default: () => "Go" }
          )
        ])
    })
    const Home = route("home", "/", {
      component: HomePage,
      error: () => h("p", { "data-testid": "home-boundary" }, "Home boundary")
    })
    const Target = route("target", "/target", { component: () => h("p", "Array throw target") })
    const App = make("VueArrayThrow", [Home, Target])
    appRef.Link = makeNavigation(App).Link as unknown as Component
    const runtime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
    const container = mountWithBoundary(h(Provider<typeof App>, { app: App, runtime }))
    await settle()
    container
      .querySelector('a[href="/target"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }))
    await settle()
    await settle()
    // The first rejection is handled by Vue and the native sequence still
    // invokes the second listener.
    expect(calls).toEqual(["first", "second"])
    expect(container.querySelector('[data-testid="home-boundary"]')).not.toBeNull()
    expect(container.textContent).not.toContain("Array throw target")
  })
})
