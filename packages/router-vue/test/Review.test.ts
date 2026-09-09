// @vitest-environment happy-dom
import { MemoryHistory, Router, type RouteTree } from "@effect-stack/router"
import {
  type ClientRouter,
  createRootRoute,
  createRoute,
  createRouter,
  type Destination,
  type ErrorProps,
  Navigate,
  Outlet,
  RouterProvider,
  useNavigate,
  useNavigateEffect
} from "@effect-stack/router-vue"
import { Cause, Context, Deferred, Effect, Layer, Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type Component, defineComponent, h, nextTick, ref, render, type VNode } from "vue"

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
    AtomRegistry.getResult(registry, command ? router.core.navigation : router.core.state, { suspendOnWaiting: true })
      .pipe(Effect.exit)
  )
  await nextTick()
}
const readState = async <T extends RouteTree.Any, E>(
  router: ClientRouter<T, E>,
  registry: AtomRegistry.AtomRegistry
) => await Effect.runPromise(AtomRegistry.getResult(registry, router.core.state))

describe.sequential("Vue review regressions", () => {
  it("makes decoded params available in pending views before the loader settles", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    let decoded: number | undefined
    const root = createRootRoute({ component: Outlet })
    const Pending = defineComponent({
      setup() {
        const params = project.useParams()
        return (): VNode => {
          decoded = params.value.id
          return h("p", `Loading ${params.value.id}`)
        }
      }
    })
    const project = createRoute({
      getParentRoute: () => root,
      path: "projects/:id",
      params: { id: Schema.FiniteFromString },
      loader: () => Deferred.await(ready),
      pendingComponent: Pending
    })
    const router = createRouter({
      routeTree: root.addChildren([project]),
      history: MemoryHistory.layer("/projects/42")
    })
    const { container } = mount(router)
    await nextTick()
    await nextTick()
    expect(container.textContent).toBe("Loading 42")
    expect(decoded).toBe(42)
  })

  it("recovers from bad data only after the asynchronous refresh succeeds", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    let loads = 0
    const root = createRootRoute({
      component: Outlet,
      errorComponent: (props: ErrorProps) => h("button", { onClick: props.reset }, "Retry")
    })
    const child = createRoute({
      getParentRoute: () => root,
      path: "/",
      loader: () => ++loads === 1 ? Effect.succeed("bad") : Deferred.await(ready).pipe(Effect.as("good")),
      component: defineComponent({
        setup() {
          const data = child.useLoaderData()
          return (): VNode => {
            if (data.value === "bad") throw new Error("bad data")
            return h("p", data.value)
          }
        }
      })
    })
    const router = createRouter({ routeTree: root.addChildren([child]), history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    await settle(router, registry)
    expect(container.textContent).toBe("Retry")
    container.querySelector("button")!.click()
    await nextTick()
    // The refresh is still loading; the ancestor boundary keeps its latched failure
    // instead of flashing stale bad data or a generic pending view.
    expect(container.textContent).toBe("Retry")
    Effect.runSync(Deferred.succeed(ready, undefined))
    await settle(router, registry, true)
    expect(container.textContent).toBe("good")
  })

  it("retries initialization after a Layer fails its first construction", async () => {
    class Config extends Context.Service<Config, string>()("test/Config") {}
    let attempts = 0
    const layer = Layer.effect(
      Config,
      Effect.suspend(() => ++attempts === 1 ? Effect.fail("startup") : Effect.succeed("ready"))
    )
    const route = createRootRoute({
      loader: () => Config.use((config) => Effect.succeed(config)),
      component: defineComponent({
        setup() {
          const data = route.useLoaderData()
          return (): VNode => h("p", data.value)
        }
      }),
      errorComponent: (props: ErrorProps) => h("button", { onClick: props.reset }, "Retry startup")
    })
    const router = createRouter({ routeTree: route, layer, history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    await settle(router, registry)
    expect(container.textContent).toBe("Retry startup")
    container.querySelector("button")!.click()
    await nextTick()
    await settle(router, registry)
    expect(attempts).toBe(2)
    expect(container.textContent).toBe("ready")
  })

  it("applies state-only Navigate changes without repeated remounts", async () => {
    let mounts = 0
    const counter = ref(1)
    const View = defineComponent({
      setup() {
        mounts++
        return (): VNode => h("main", [h(Navigate, { to: "/", replace: true, state: { n: counter.value } }), h(Outlet)])
      }
    })
    const root = createRootRoute({ component: View })
    const router = createRouter({ routeTree: root, history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    await settle(router, registry)
    expect(mounts).toBe(1)
    counter.value = 2
    await nextTick()
    await settle(router, registry)
    const match = await readState(router, registry)
    expect(match.location.state).toEqual({ n: 2 })
    expect(match.location.index).toBe(0)
    // The state-only replace settled through the same route without remounting the view.
    expect(mounts).toBe(1)
    expect(container.textContent).toBe("")
  })

  it("bridges awaitable navigation and typed Effect navigation through one transition", async () => {
    const ready = Effect.runSync(Deferred.make<void>())
    let navigate!: ReturnType<typeof useNavigate>
    let navigateEffect!: ReturnType<typeof useNavigateEffect>
    const root = createRootRoute({
      component: defineComponent({
        setup() {
          navigate = useNavigate()
          navigateEffect = useNavigateEffect()
          return (): VNode => h(Outlet)
        }
      })
    })
    const home = createRoute({ getParentRoute: () => root, path: "/", component: () => h("p", "Home") })
    const child = createRoute({
      getParentRoute: () => root,
      path: "child",
      loader: () => Deferred.await(ready),
      component: () => h("p", "Child")
    })
    const broken = createRoute({
      getParentRoute: () => root,
      path: "broken",
      loader: () => Effect.fail("missing"),
      component: () => h("p", "Broken")
    })
    const tree = root.addChildren([home, child, broken])
    const router = createRouter({ routeTree: tree, history: MemoryHistory.layer() })
    const { container, registry } = mount(router)
    await settle(router, registry)
    expect((await readState(router, registry)).id).toBe(home.id)

    const toChild = navigateEffect({ to: "/child" } as Destination)
    expect(Effect.isEffect(toChild)).toBe(true)
    // Composing the Effect does not navigate; running it starts the transition.
    expect((await readState(router, registry)).id).toBe(home.id)
    let done = false
    const running = Effect.runPromise(toChild).then(() => {
      done = true
    })
    await nextTick()
    expect(done).toBe(false)
    Effect.runSync(Deferred.succeed(ready, undefined))
    await running
    expect(done).toBe(true)
    await settle(router, registry)
    expect((await readState(router, registry)).id).toBe(child.id)
    expect(container.textContent).toBe("Child")

    // The Promise bridge awaits terminal state: typed loader failures reject it.
    const rejected = await navigate({ to: "/broken" } as unknown as Destination).catch((error: unknown) => error)
    expect(rejected).toBeInstanceOf(Router.RouteLoaderError)
    expect((rejected as { readonly routeId: string; readonly error: unknown }).routeId).toBe(broken.id)
    const exit = await Effect.runPromiseExit(navigateEffect({ to: "/broken" } as unknown as Destination))
    expect(exit._tag).toBe("Failure")
    // Squashing a defect would wrap the failure instead of yielding the typed error.
    if (exit._tag === "Failure") expect(Cause.squash(exit.cause)).toBeInstanceOf(Router.RouteLoaderError)
  })

  it("surfaces a present-null lazy module view as an invalid selection", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const root = createRootRoute({ component: () => h("main", [h("h1", "Shell"), h(Outlet)]) })
      // Untyped dynamic-import shape: the runtime receives null where a view is required.
      const nullModule = { default: null } as unknown as { readonly default: Component }
      const broken = createRoute({
        getParentRoute: () => root,
        path: "broken",
        lazy: () => Effect.succeed(nullModule),
        errorComponent: (props: ErrorProps) => h("p", `Boundary: ${String(props.error)}`)
      })
      const router = createRouter({
        routeTree: root.addChildren([broken]),
        history: MemoryHistory.layer("/broken")
      })
      const { container, registry } = mount(router)
      await settle(router, registry)
      const text = container.textContent ?? ""
      expect(text).toContain("Shell")
      expect(text).toContain("Boundary:")
      expect(text).toContain("not a Vue component")
      expect(text).toContain("received null")
    } finally {
      logged.mockRestore()
    }
  })
})
