// @vitest-environment happy-dom
import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { RegistryProvider } from "@effect/atom-react"
import { MemoryHistory, Route, RouteGroup, Router } from "@effect-stack/router"
import { Link, Outlet, RouterProvider, useRoute, type ErrorProps, type Views } from "@effect-stack/router-react"
import { Atom } from "effect/unstable/reactivity"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const Routes = Router.make("React").add(
  Route.make("home", "/"),
  Route.make("slow", "/slow", {
    success: Schema.Struct({ title: Schema.String })
  }),
  RouteGroup.make("areas")
    .add(
      Route.make("detail", "/:areaId", {
        params: { areaId: Schema.FiniteFromString },
        success: Schema.Struct({ name: Schema.String }),
        error: Schema.Struct({ code: Schema.Number })
      })
    )
    .prefix("/areas")
)

class AreaMissing extends Schema.TaggedError<AreaMissing>()("AreaMissing", { code: Schema.Number }) {}

const AreaDetailLive = Router.route(Routes.areas.detail, () => Effect.fail(new AreaMissing({ code: 1 })))

function HomePage() {
  useRoute(Routes.home)
  return (
    <main>
      <h1>Home</h1>
      <Link to={Routes.slow()}>Slow</Link>
    </main>
  )
}

function SlowPending() {
  return <p role="status">Preparing…</p>
}

function SlowError(props: ErrorProps) {
  return <button onClick={props.reset}>Retry</button>
}

function SlowPage() {
  const { data } = useRoute(Routes.slow)
  return <h1>{data.title}</h1>
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
  const { data } = useRoute(Routes.areas.detail)
  return <p>{data.name}</p>
}

function AreaDetailError(props: ErrorProps) {
  return <p data-testid="area-error">Area failed: {String(props.error)}</p>
}

const views = {
  home: HomePage,
  slow: { component: SlowPage, pending: SlowPending, error: SlowError },
  areas: {
    component: AreasLayout,
    children: {
      detail: { component: AreaDetailPage, error: AreaDetailError }
    }
  }
} satisfies Views<typeof Routes>

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
  it("shows pending views, resolves typed data, and navigates through links", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const SlowLive = Router.route(Routes.slow, () => Deferred.await(gate).pipe(Effect.as({ title: "Ready" })))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/slow"))
    )
    const runtime = Atom.runtime(AppLive)
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider routes={Routes} runtime={runtime} views={views} />
      </RegistryProvider>
    )
    expect(await waitForText(container, "Preparing…")).toBe(true)
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(gate, undefined))
    })
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("renders home and follows a typed link", async () => {
    const SlowLive = Router.route(Routes.slow, () => Effect.succeed({ title: "Ready" }))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/"))
    )
    const runtime = Atom.runtime(AppLive)
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider routes={Routes} runtime={runtime} views={views} />
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

  it("keeps hooks on the retained branch while a different route is pending", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const SlowLive = Router.route(Routes.slow, () => Deferred.await(gate).pipe(Effect.as({ title: "Ready" })))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/"))
    )
    const runtime = Atom.runtime(AppLive)
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider routes={Routes} runtime={runtime} views={views} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Home")).toBe(true)
    const link = container.querySelector("a")
    await React.act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
      // Keep act active while the pending navigation transition publishes, so
      // its updates are covered by act rather than warned about.
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    // While the new route prepares, the retained branch (and `useRoute(home)`)
    // must remain consistent rather than throwing or showing the pending route.
    expect(container.textContent).toContain("Home")
    expect(container.textContent).not.toContain("Unable to display")
    await React.act(async () => {
      Effect.runSync(Deferred.succeed(gate, undefined))
    })
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("keeps ancestor layouts around a nested route failure", async () => {
    const SlowLive = Router.route(Routes.slow, () => Effect.succeed({ title: "Ready" }))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/areas/7"))
    )
    const runtime = Atom.runtime(AppLive)
    const { container } = mount(
      <RegistryProvider>
        <RouterProvider routes={Routes} runtime={runtime} views={views} />
      </RegistryProvider>
    )
    await React.act(async () => {})
    expect(await waitForText(container, "Areas layout")).toBe(true)
    expect(container.textContent).toContain("Area failed")
    expect(container.textContent).not.toContain("Unable to display")
  })
})
