import type { Route } from "@effect-stack/router"
import { createRootRoute, createRoute } from "@effect-stack/router-react"
import { Effect } from "effect"
import * as React from "react"
import { describe, expect, test } from "tstyche"

function Home() {
  return <p>Home</p>
}

const root = createRootRoute()

describe("React lazy module view validation", () => {
  test("accepts function, memo, and lazy exports while preserving module inference", () => {
    const route = createRoute({
      getParentRoute: () => root,
      path: "valid",
      lazy: () => Effect.succeed({ default: Home } as const)
    })
    expect<Route.Route.Module<typeof route>>().type.toBe<{ readonly default: typeof Home }>()
    expect(createRoute).type.toBeCallableWith({
      getParentRoute: () => root,
      path: "memo",
      lazy: () => Effect.succeed({ component: React.memo(Home) })
    })
    expect(createRoute).type.toBeCallableWith({
      getParentRoute: () => root,
      path: "lazy",
      lazy: () => Effect.succeed({ default: React.lazy(async () => ({ default: Home })) })
    })
  })
  test("rejects present but invalid view exports under lazy", () => {
    expect(createRoute).type.not.toBeCallableWith({
      getParentRoute: () => root,
      path: "bad-default",
      lazy: () => Effect.succeed({ default: 42 })
    })
    expect(createRoute).type.not.toBeCallableWith({
      getParentRoute: () => root,
      path: "bad-component",
      lazy: () => Effect.succeed({ component: "div" })
    })
    expect(createRootRoute).type.not.toBeCallableWith({ lazy: () => Effect.succeed({ default: 42 }) })
    expect(createRootRoute).type.not.toBeCallableWith({ lazy: () => Effect.succeed({ component: 42 }) })
  })
  test("rejects the removed load option name", () => {
    expect(createRoute).type.not.toBeCallableWith({
      getParentRoute: () => root,
      path: "removed-load",
      load: () => Effect.succeed({ default: Home })
    })
    expect(createRootRoute).type.not.toBeCallableWith({ load: () => Effect.succeed({ default: Home }) })
  })
  test("allows renderer-neutral modules and preserves loader data inference", () => {
    const route = createRoute({
      getParentRoute: () => root,
      path: "neutral",
      lazy: () => Effect.succeed({ title: "descriptor" } as const),
      loader: () => Effect.succeed({ count: 1 })
    })
    expect<Route.Route.Module<typeof route>>().type.toBe<{ readonly title: "descriptor" }>()
    expect<ReturnType<typeof route.useLoaderData>>().type.toBe<{ count: number }>()
    expect(createRootRoute).type.toBeCallableWith({ lazy: () => Effect.succeed({ title: "descriptor" }) })
  })
})
