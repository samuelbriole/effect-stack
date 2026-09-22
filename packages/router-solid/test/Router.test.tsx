// @vitest-environment happy-dom
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { RegistryProvider } from "@effect/atom-solid"
import { MemoryHistory, Route, RouteGroup, Router } from "@effect-stack/router"
import { Link, Outlet, RouterProvider, useRoute, type ErrorProps, type Views } from "@effect-stack/router-solid"
import { Atom } from "effect/unstable/reactivity"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it } from "vitest"

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

// A `_blank` link's default action would otherwise make happy-dom attempt a
// real page navigation; the router handler behavior is what is under test.
const happyDOMWindow = (
  window as unknown as { happyDOM?: { settings: { navigation: { disableMainFrameNavigation: boolean } } } }
).happyDOM
if (happyDOMWindow !== undefined) happyDOMWindow.settings.navigation.disableMainFrameNavigation = true

const Routes = Router.make("Solid").add(
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

const HomePage = () => {
  useRoute(Routes.home)
  return (
    <main>
      <h1>Home</h1>
      <Link to={Routes.slow()}>Slow</Link>
    </main>
  )
}

const SlowPending = () => <p role="status">Preparing…</p>

const SlowPage = () => {
  const route = useRoute(Routes.slow)
  return <h1>{route().data.title}</h1>
}

const AreasLayout = () => (
  <div data-testid="areas-layout">
    <h2>Areas layout</h2>
    <Outlet />
  </div>
)

const AreaDetailPage = () => {
  const route = useRoute(Routes.areas.detail)
  return <p>{route().data.name}</p>
}

const AreaDetailError = (props: ErrorProps) => <p data-testid="area-error">Area failed: {String(props.error)}</p>

const views = {
  home: HomePage,
  slow: { component: SlowPage, pending: SlowPending },
  areas: {
    component: AreasLayout,
    children: {
      detail: { component: AreaDetailPage, error: AreaDetailError }
    }
  }
} satisfies Views<typeof Routes>

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

describe("Solid router adapter", { concurrent: false }, () => {
  it("renders pending then typed data and navigates through a link", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const SlowLive = Router.route(Routes.slow, () => Deferred.await(gate).pipe(Effect.as({ title: "Ready" })))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/slow"))
    )
    const runtime = Atom.runtime(AppLive)
    const container = createContainer()
    const dispose = render(
      () => (
        <RegistryProvider>
          <RouterProvider routes={Routes} runtime={runtime} views={views} />
        </RegistryProvider>
      ),
      container
    )
    cleanups.push(() => {
      dispose()
      container.remove()
    })
    expect(await waitForText(container, "Preparing…")).toBe(true)
    Effect.runSync(Deferred.succeed(gate, undefined))
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("renders home and follows a typed link", async () => {
    const SlowLive = Router.route(Routes.slow, () => Effect.succeed({ title: "Ready" }))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/"))
    )
    const runtime = Atom.runtime(AppLive)
    const container = createContainer()
    const dispose = render(
      () => (
        <RegistryProvider>
          <RouterProvider routes={Routes} runtime={runtime} views={views} />
        </RegistryProvider>
      ),
      container
    )
    cleanups.push(() => {
      dispose()
      container.remove()
    })
    expect(await waitForText(container, "Home")).toBe(true)
    const link = container.querySelector("a")
    expect(link?.getAttribute("href")).toBe("/slow")
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
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
    const container = createContainer()
    const dispose = render(
      () => (
        <RegistryProvider>
          <RouterProvider routes={Routes} runtime={runtime} views={views} />
        </RegistryProvider>
      ),
      container
    )
    cleanups.push(() => {
      dispose()
      container.remove()
    })
    expect(await waitForText(container, "Home")).toBe(true)
    const link = container.querySelector("a")
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(container.textContent).toContain("Home")
    expect(container.textContent).not.toContain("Unable to display")
    Effect.runSync(Deferred.succeed(gate, undefined))
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("keeps ancestor layouts around a nested route failure", async () => {
    const SlowLive = Router.route(Routes.slow, () => Effect.succeed({ title: "Ready" }))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/areas/7"))
    )
    const runtime = Atom.runtime(AppLive)
    const container = createContainer()
    const dispose = render(
      () => (
        <RegistryProvider>
          <RouterProvider routes={Routes} runtime={runtime} views={views} />
        </RegistryProvider>
      ),
      container
    )
    cleanups.push(() => {
      dispose()
      container.remove()
    })
    expect(await waitForText(container, "Areas layout")).toBe(true)
    expect(container.textContent).toContain("Area failed")
    expect(container.textContent).not.toContain("Unable to display")
  })

  it("updates Link and Navigate targets when the destination changes", async () => {
    const SlowLive = Router.route(Routes.slow, () => Effect.succeed({ title: "Ready" }))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/"))
    )
    const runtime = Atom.runtime(AppLive)
    const [target, setTarget] = createSignal<Router.Destination<string>>(Routes.home())
    const DynamicHome = () => (
      <main>
        <Link to={target()}>Go</Link>
      </main>
    )
    const dynamicViews = { ...views, home: DynamicHome }
    const container = createContainer()
    const dispose = render(
      () => (
        <RegistryProvider>
          <RouterProvider routes={Routes} runtime={runtime} views={dynamicViews} />
        </RegistryProvider>
      ),
      container
    )
    cleanups.push(() => {
      dispose()
      container.remove()
    })
    expect(await waitForText(container, "Go")).toBe(true)
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/")
    setTarget(Routes.slow())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/slow")
    container.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    expect(await waitForText(container, "Ready")).toBe(true)
  })

  it("forwards reactive native attributes and honors live target changes in the click handler", async () => {
    const SlowLive = Router.route(Routes.slow, () => Effect.succeed({ title: "Ready" }))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/"))
    )
    const runtime = Atom.runtime(AppLive)
    const [linkTarget, setLinkTarget] = createSignal<string | undefined>("_self")
    const DynamicHome = () => (
      <main>
        <Link to={Routes.slow()} target={linkTarget()}>
          Go
        </Link>
      </main>
    )
    const dynamicViews = { ...views, home: DynamicHome }
    const container = createContainer()
    const dispose = render(
      () => (
        <RegistryProvider>
          <RouterProvider routes={Routes} runtime={runtime} views={dynamicViews} />
        </RegistryProvider>
      ),
      container
    )
    cleanups.push(() => {
      dispose()
      container.remove()
    })
    expect(await waitForText(container, "Go")).toBe(true)
    expect(container.querySelector("a")?.getAttribute("target")).toBe("_self")
    setLinkTarget("_blank")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container.querySelector("a")?.getAttribute("target")).toBe("_blank")
    // A live `_blank` target must block router navigation even though the
    // attribute was forwarded reactively after mount.
    container.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container.textContent).toContain("Go")
    expect(container.textContent).not.toContain("Ready")
  })
})
