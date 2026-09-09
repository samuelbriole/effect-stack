import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Route from "@effect-stack/router/Route"
import * as Router from "@effect-stack/router/Router"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as Atom from "effect/unstable/reactivity/Atom"
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
  lazy: () => Effect.fail(new LazyError({ message: "failed" })).pipe(Effect.as({ title: "Lazy" as const }))
})
const routes = [home, lazy] as const
const router = Router.make({ routes, layer: MemoryHistory.layer() })

describe("Router", () => {
  test("navigation targets are selected by route", () => {
    expect(Router.push).type.toBeCallableWith(home, { params: {}, search: {}, hash: "" })
    expect(Router.push).type.toBeCallableWith(lazy, { params: { section: "intro" }, search: {}, hash: "" })
    expect(Router.push).type.not.toBeCallableWith(lazy, { params: {}, search: {}, hash: "" })
    expect(router.navigation).type.toBe<
      Atom.Atom<AsyncResult.AsyncResult<void, Router.NavigationError<typeof routes>>>
    >()
    expect(router.navigation).type.not.toBeAssignableTo<{
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

  test("lazy is the only code-loading option and infers module, error, and service types", () => {
    const viaLazy = Route.make({
      id: "via-lazy",
      path: "/via-lazy",
      params: {},
      search: {},
      lazy: () => Effect.fail(new LazyError({ message: "failed" })).pipe(Effect.as({ title: "Lazy" as const }))
    })
    expect<Route.Route.Module<typeof viaLazy>>().type.toBe<{ title: "Lazy" }>()
    expect<Route.Route.LoadError<typeof viaLazy>>().type.toBe<LazyError>()
    // The stored code loader lives on the route's `lazy` field.
    expect<NonNullable<typeof viaLazy.lazy>>().type.toBe<
      () => Effect.Effect<{ title: "Lazy" }, LazyError, Scope.Scope>
    >()
    // `load` is no longer an accepted option name.
    expect(Route.make).type.not.toBeCallableWith({
      id: "via-load",
      path: "/via-load",
      params: {},
      search: {},
      load: () => Effect.succeed({ title: "Lazy" as const })
    })
  })
})
