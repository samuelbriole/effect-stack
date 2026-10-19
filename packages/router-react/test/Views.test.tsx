// @vitest-environment happy-dom
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { RegistryProvider, RegistryContext, useAtomValue, useAtomRefresh } from "@effect/atom-react"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { MemoryHistory } from "@effect-stack/router"
import { RouteDefinitionError } from "@effect-stack/router/Router"
import * as Router from "@effect-stack/router/Router"
import {
  Link,
  make,
  layer as routerLayer,
  Outlet,
  RouterProvider,
  layout,
  route,
  useRouteInput,
  type ViewFailureProps
} from "@effect-stack/router-react"
import { Atom } from "effect/reactivity"
import * as React from "react"
import { ErrorBoundary } from "./fixture/ErrorBoundary.tsx"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

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

function OuterLayout() {
  return (
    <div data-testid="outer">
      <h2>Outer</h2>
      <Outlet />
    </div>
  )
}

function LeafPage() {
  return <p>Leaf</p>
}

describe("transparent layouts and explicit empty endpoints", { concurrent: false }, () => {
  it("renders descendants through prep-only layouts", async () => {
    const Outer = layout("outer", "/outer")
    const Middle = Outer.layout("middle", "/middle", { prepare: () => Effect.void })
    const Leaf = Middle.route("leaf", "/leaf", { component: LeafPage })
    const Hidden = Outer.route("hidden", "/hidden", { empty: true })
    const App = await Effect.runPromise(make("Views", [Leaf, Hidden]))
    const runtime = Atom.runtime(
      routerLayer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/outer/middle/leaf")))
    )
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Leaf")).toBe(true)
  })

  it("advances past a transparent outer layout into a rendered inner layout", async () => {
    function InnerLayout() {
      return (
        <div data-testid="inner">
          <h2>Inner</h2>
          <Outlet />
        </div>
      )
    }
    const Outer = layout("outer", "/outer")
    const Inner = Outer.layout("inner", "/inner", { component: InnerLayout })
    const Leaf = Inner.route("leaf", "/leaf", { component: LeafPage })
    const App = await Effect.runPromise(make("Views", [Leaf]))
    const runtime = Atom.runtime(
      routerLayer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/outer/inner/leaf")))
    )
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Inner")).toBe(true)
    expect(await waitForText(container, "Leaf")).toBe(true)
  })

  it("renders an explicit empty endpoint as terminal content", async () => {
    const Outer = layout("outer", "/outer", { component: OuterLayout })
    const Hidden = Outer.route("hidden", "/hidden", { empty: true })
    const Leaf = Outer.route("leaf", "/leaf", { component: LeafPage })
    const App = await Effect.runPromise(make("Views", [Hidden, Leaf]))
    const runtime = Atom.runtime(
      routerLayer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/outer/hidden")))
    )
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Outer")).toBe(true)
    expect(container.textContent).not.toContain("Leaf")
  })

  it("rejects an endpoint that declares no presentation", () => {
    expect(Effect.runSyncExit(make("Views", [route("a", "/a", { prepare: () => Effect.void })]))).toMatchObject({
      _tag: "Failure",
      cause: { reasons: [{ _tag: "Die", defect: expect.any(RouteDefinitionError) as unknown }] }
    })
  })

  it("allows a gate-only transparent layout", () => {
    const Group = layout("group", "/group", { prepare: () => Effect.void })
    const Leaf = Group.route("leaf", "/leaf", { component: LeafPage })
    expect(Effect.runSyncExit(make("Views", [Leaf]))._tag).toBe("Success")
  })

  it("allows an explicit empty endpoint that also loads", async () => {
    const Home = route("home", "/", { component: () => <h1>Home</h1> })
    const Empty = route("empty", "/empty", { prepare: () => Effect.void, empty: true })
    const App = await Effect.runPromise(make("Views", [Home, Empty]))
    const runtime = Atom.runtime(routerLayer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/empty"))))
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(container.textContent).not.toContain("Unable to display")
  })

  it("shows a transparent layout pending boundary while its gate is pending", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const Group = layout("pendingGroup", "/pending-group", {
      prepare: () => Deferred.await(gate)
    })
    const Leaf = Group.route("leaf", "/leaf", { component: LeafPage })
    const App = await Effect.runPromise(make("Views", [Leaf]))
    const runtime = Atom.runtime(
      routerLayer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/pending-group/leaf")))
    )
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} pending={() => <p role="status">Group pending…</p>} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Group pending…")).toBe(true)
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(gate, undefined))
    })
    expect(await waitForText(container, "Leaf")).toBe(true)
  })

  it("rejects duplicate ids, copied definitions, and headless definitions in a native app", () => {
    const leaf = route("leaf", "/leaf", { component: LeafPage })
    const headless = Router.route("headless", "/headless", { prepare: () => Effect.void })
    for (const assembly of [
      make("Views", [route("a", "/a", { component: LeafPage }), route("a", "/b", { component: LeafPage })]),
      make("Views", [{ ...(leaf as object) } as never]),
      make("Views", [headless as never])
    ]) {
      expect(Effect.runSyncExit<unknown, never>(assembly)).toMatchObject({
        _tag: "Failure",
        cause: { reasons: [{ _tag: "Die", defect: expect.any(RouteDefinitionError) as unknown }] }
      })
    }
  })
})

describe("application-owned render error recovery", { concurrent: false }, () => {
  it("boundary reset and resource refresh never implicitly rerun gates", async () => {
    let reads = 0
    let gates = 0
    const resource = Atom.runtime(Layer.empty)
      .atom(
        Effect.suspend(() =>
          ++reads === 1 ? Effect.fail(new Error("resource failed")) : Effect.succeed("Recovered resource")
        )
      )
      .pipe(Atom.keepAlive)
    function Page() {
      const result = useAtomValue(resource)
      if (result._tag === "Failure") throw new Error("resource render failure")
      return <p>{result._tag === "Success" ? result.value : "Loading resource"}</p>
    }
    function ErrorView({ retry }: ViewFailureProps) {
      const refresh = useAtomRefresh(resource)
      return (
        <section>
          <button data-testid="gate-retry" onClick={retry}>
            Retry gate
          </button>
          <button
            data-testid="resource-refresh"
            onClick={() => {
              refresh()
              retry()
            }}
          >
            Refresh resource
          </button>
        </section>
      )
    }
    const Home = route("home", "/", {
      component: () => (
        <ErrorBoundary
          fallback={(retry) => <ErrorView failure={{ _tag: "Cause", cause: Cause.die("native") }} retry={retry} />}
        >
          <Page />
        </ErrorBoundary>
      ),
      error: () => <p>Route gate failed</p>,
      prepare: () =>
        Effect.sync(() => {
          gates++
        })
    })
    const App = await Effect.runPromise(make("ResourceRenderRetry", [Home]))
    const runtime = Atom.runtime(routerLayer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/"))))
    const registry = AtomRegistry.make()
    cleanups.push(() => registry.dispose())
    const { container } = mount(
      <RegistryContext.Provider value={registry}>
        <RouterProvider runtime={runtime} />
      </RegistryContext.Provider>
    )
    expect(await waitForText(container, "Retry gate")).toBe(true)
    await React.act(async () => {
      container
        .querySelector('[data-testid="gate-retry"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    })
    expect(await waitForText(container, "Retry gate")).toBe(true)
    expect(reads).toBe(1)
    expect(gates).toBe(1)
    await React.act(async () => {
      container
        .querySelector('[data-testid="resource-refresh"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    })
    expect(await waitForText(container, "Recovered resource")).toBe(true)
    expect(reads).toBe(2)
    expect(gates).toBe(1)
  })

  it("lets an application boundary reset a native failure without a route error view", async () => {
    let shouldThrow = true
    function ThrowingPage() {
      if (shouldThrow) throw new Error("render boom")
      return <h1>Recovered</h1>
    }
    const Project = route("project", "/projects/:projectId", {
      params: { projectId: Schema.FiniteFromString },
      prepare: () => Effect.void,
      component: () => (
        <ErrorBoundary fallback={(reset) => <button onClick={reset}>Retry</button>}>
          <ThrowingPage />
        </ErrorBoundary>
      ),
      error: () => <p>Route gate failed</p>
    })
    const Home = route("home", "/", { component: () => <h1>Home</h1> })
    const App = await Effect.runPromise(make("Recovery", [Home, Project]))
    const runtime = Atom.runtime(
      routerLayer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/projects/1")))
    )
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Retry")).toBe(true)
    shouldThrow = false
    await React.act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    })
    expect(await waitForText(container, "Recovered")).toBe(true)
  })

  it("allows an application-owned input key to reset a native boundary", async () => {
    function MaybeThrow(): React.ReactNode {
      const input = useRouteInput(Project)
      if (input.params.projectId === 1) throw new Error("bad input")
      return <h1>P{input.params.projectId}</h1>
    }
    const Project = route("project", "/projects/:projectId", {
      params: { projectId: Schema.FiniteFromString },
      prepare: () => Effect.void,
      component: () => {
        const input = useRouteInput(Project)
        return (
          <ErrorBoundary
            key={input.params.projectId}
            fallback={() => (
              <section>
                <p>Failed</p>
                <Link to={Project.to({ params: { projectId: 2 } })}>Next</Link>
              </section>
            )}
          >
            <MaybeThrow />
          </ErrorBoundary>
        )
      },
      error: () => <p>Route gate failed</p>
    })
    const Home = route("home", "/", { component: () => <h1>Home</h1> })
    const App = await Effect.runPromise(make("Recovery", [Home, Project]))
    const runtime = Atom.runtime(
      routerLayer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/projects/1")))
    )
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider runtime={runtime} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Next")).toBe(true)
    await React.act(async () => {
      container.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    })
    expect(await waitForText(container, "P2")).toBe(true)
  })
})
