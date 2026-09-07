import type { Route } from "@effect-stack/router"
import { createRootRoute, createRoute } from "@effect-stack/router-vue"
import { Effect } from "effect"
import { describe, expect, test } from "tstyche"
import { type Component, type ComputedRef, defineComponent, h } from "vue"

const Home = defineComponent({ render: () => h("p", "Home") })
const Functional: Component = () => h("p", "Home")

const root = createRootRoute()

describe("Vue lazy module view validation", () => {
  test("accepts object and functional exports while preserving module inference", () => {
    const route = createRoute({
      getParentRoute: () => root,
      path: "valid",
      load: () => Effect.succeed({ default: Home } as const)
    })
    expect<Route.Route.Module<typeof route>>().type.toBe<{ readonly default: typeof Home }>()
    expect(createRoute).type.toBeCallableWith({
      getParentRoute: () => root,
      path: "renamed",
      load: () => Effect.succeed({ component: Functional })
    })
  })
  test("rejects present but invalid view exports", () => {
    expect(createRoute).type.not.toBeCallableWith({
      getParentRoute: () => root,
      path: "bad-default",
      load: () => Effect.succeed({ default: 42 })
    })
    expect(createRoute).type.not.toBeCallableWith({
      getParentRoute: () => root,
      path: "bad-component",
      load: () => Effect.succeed({ component: 42 })
    })
    expect(createRootRoute).type.not.toBeCallableWith({ load: () => Effect.succeed({ default: 42 }) })
  })
  test("allows renderer-neutral modules and preserves loader data inference", () => {
    const route = createRoute({
      getParentRoute: () => root,
      path: "neutral",
      load: () => Effect.succeed({ title: "descriptor" } as const),
      loader: () => Effect.succeed(true)
    })
    expect<Route.Route.Module<typeof route>>().type.toBe<{ readonly title: "descriptor" }>()
    expect<ReturnType<typeof route.useLoaderData>>().type.toBe<ComputedRef<boolean>>()
    expect(createRootRoute).type.toBeCallableWith({ load: () => Effect.succeed({ title: "descriptor" }) })
  })
})
