// @vitest-environment happy-dom
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { MemoryHistory, Route, RouteGroup, Router } from "@effect-stack/router"
import { Link, Outlet, RouterProvider, useRoute, type Views } from "@effect-stack/router-vue"
import { Atom } from "effect/unstable/reactivity"
import { afterEach, describe, expect, it } from "vitest"
import { defineComponent, h, nextTick, render } from "vue"

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const Routes = Router.make("Vue").add(
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

const HomePage = defineComponent({
  name: "HomePage",
  setup: () => {
    useRoute(Routes.home)
    return () =>
      h("main", [
        h("h1", "Home"),
        h(Link, { to: Routes.slow() }, { default: () => h("span", { "data-testid": "slow-link" }, "Slow") })
      ])
  }
})

const SlowPending = defineComponent({
  name: "SlowPending",
  setup: () => () => h("p", { role: "status" }, "Preparing…")
})

const SlowPage = defineComponent({
  name: "SlowPage",
  setup() {
    const route = useRoute(Routes.slow)
    return () => h("h1", route.value.data.title)
  }
})

const AreasLayout = defineComponent({
  name: "AreasLayout",
  setup: () => () => h("div", { "data-testid": "areas-layout" }, [h("h2", "Areas layout"), h(Outlet)])
})

const AreaDetailPage = defineComponent({
  name: "AreaDetailPage",
  setup() {
    const route = useRoute(Routes.areas.detail)
    return () => h("p", route.value.data.name)
  }
})

const AreaDetailError = defineComponent({
  name: "AreaDetailError",
  props: { error: { type: null, required: true }, reset: { type: Function, required: true } },
  setup: (props) => () => h("p", { "data-testid": "area-error" }, `Area failed: ${String(props.error)}`)
})

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

const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await nextTick()
}

describe("Vue router adapter", { concurrent: false }, () => {
  it("renders pending then typed data and navigates through a link", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const SlowLive = Router.route(Routes.slow, () => Deferred.await(gate).pipe(Effect.as({ title: "Ready" })))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/slow"))
    )
    const runtime = Atom.runtime(AppLive)
    const container = document.createElement("div")
    document.body.append(container)
    render(h(RouterProvider, { routes: Routes, runtime, views }), container)
    cleanups.push(() => {
      render(null, container)
      container.remove()
    })
    await settle()
    expect(container.textContent).toContain("Preparing…")
    Effect.runSync(Deferred.succeed(gate, undefined))
    await settle()
    expect(container.textContent).toContain("Ready")
  })

  it("renders home and follows a typed link", async () => {
    const SlowLive = Router.route(Routes.slow, () => Effect.succeed({ title: "Ready" }))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/"))
    )
    const runtime = Atom.runtime(AppLive)
    const container = document.createElement("div")
    document.body.append(container)
    render(h(RouterProvider, { routes: Routes, runtime, views }), container)
    cleanups.push(() => {
      render(null, container)
      container.remove()
    })
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

  it("keeps hooks on the retained branch while a different route is pending", async () => {
    const gate = Effect.runSync(Deferred.make<void>())
    const SlowLive = Router.route(Routes.slow, () => Deferred.await(gate).pipe(Effect.as({ title: "Ready" })))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/"))
    )
    const runtime = Atom.runtime(AppLive)
    const container = document.createElement("div")
    document.body.append(container)
    render(h(RouterProvider, { routes: Routes, runtime, views }), container)
    cleanups.push(() => {
      render(null, container)
      container.remove()
    })
    await settle()
    expect(container.textContent).toContain("Home")
    const link = container.querySelector("a")
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    await settle()
    await settle()
    expect(container.textContent).toContain("Home")
    expect(container.textContent).not.toContain("Unable to display")
    Effect.runSync(Deferred.succeed(gate, undefined))
    await settle()
    await settle()
    expect(container.textContent).toContain("Ready")
  })

  it("keeps ancestor layouts around a nested route failure", async () => {
    const SlowLive = Router.route(Routes.slow, () => Effect.succeed({ title: "Ready" }))
    const AppLive = Router.layer(Routes).pipe(
      Layer.provide(Layer.merge(SlowLive, AreaDetailLive)),
      Layer.provide(MemoryHistory.layer("/areas/7"))
    )
    const runtime = Atom.runtime(AppLive)
    const container = document.createElement("div")
    document.body.append(container)
    render(h(RouterProvider, { routes: Routes, runtime, views }), container)
    cleanups.push(() => {
      render(null, container)
      container.remove()
    })
    await settle()
    await settle()
    expect(container.textContent).toContain("Areas layout")
    expect(container.textContent).toContain("Area failed")
    expect(container.textContent).not.toContain("Unable to display")
  })
})
