import * as MemoryHistory from "@effect-web/router/MemoryHistory"
import * as Route from "@effect-web/router/Route"
import * as Router from "@effect-web/router/Router"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { describe, expect, test } from "tstyche"

class LazyError extends Schema.TaggedError<LazyError>()("LazyError", {
  message: Schema.String
}) {}

const home = Route.make({ id: "home", path: "/", params: {}, search: {} })
const lazy = Route.make({
  id: "lazy",
  path: "/lazy/:section",
  params: { section: Schema.String },
  search: {},
  load: () => Effect.fail(new LazyError({ message: "failed" })).pipe(Effect.as({ title: "Lazy" as const }))
})
const routes = [home, lazy] as const
const router = Router.make({ routes, layer: MemoryHistory.layer() })

describe("Router", () => {
  test("navigation targets are selected by route", () => {
    expect(Router.push).type.toBeCallableWith(home, { params: {}, search: {}, hash: "" })
    expect(Router.push).type.toBeCallableWith(lazy, { params: { section: "intro" }, search: {}, hash: "" })
    expect(Router.push).type.not.toBeCallableWith(lazy, { params: {}, search: {}, hash: "" })
    expect(router.navigate).type.toBeAssignableTo<{
      readonly write: unknown
    }>()
  })

  test("route ID discriminates route-specific data", () => {
    expect<Router.Resolved<typeof routes>>().type.toBeAssignableTo<
      | {
        readonly id: "home"
        readonly params: {}
        readonly module: void
      }
      | {
        readonly id: "lazy"
        readonly params: { readonly section: string }
        readonly module: { readonly title: "Lazy" }
      }
    >()
  })

  test("eager and lazy module and error types remain distinct", () => {
    expect<Route.Route.Module<typeof home>>().type.toBe<void>()
    expect<Route.Route.Module<typeof lazy>>().type.toBe<{ title: "Lazy" }>()
    expect<Route.Route.LoadError<typeof home>>().type.toBe<never>()
    expect<Route.Route.LoadError<typeof lazy>>().type.toBe<LazyError>()
  })
})
