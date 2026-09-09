import type { Route } from "@effect-stack/router"
import { createRootRoute, createRoute } from "@effect-stack/router-solid"
import { Effect } from "effect"
import type { Component } from "solid-js"
import { describe, expect, test } from "tstyche"

const Home: Component = () => "Home"

const root = createRootRoute()

describe("Solid lazy module view validation", () => {
  test("accepts component exports while preserving module inference", () => {
    const route = createRoute({
      getParentRoute: () => root,
      path: "valid",
      lazy: () => Effect.succeed({ default: Home } as const)
    })
    expect<Route.Route.Module<typeof route>>().type.toBe<{ readonly default: Component }>()
    expect(createRoute).type.toBeCallableWith({
      getParentRoute: () => root,
      path: "renamed",
      lazy: () => Effect.succeed({ component: Home })
    })
  })
  test("rejects present but invalid view exports", () => {
    expect(createRoute).type.not.toBeCallableWith({
      getParentRoute: () => root,
      path: "bad-default",
      lazy: () => Effect.succeed({ default: 42 })
    })
    expect(createRoute).type.not.toBeCallableWith({
      getParentRoute: () => root,
      path: "bad-object",
      lazy: () => Effect.succeed({ component: { template: "div" } })
    })
    expect(createRootRoute).type.not.toBeCallableWith({ lazy: () => Effect.succeed({ default: 42 }) })
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
      loader: () => Effect.succeed(7)
    })
    expect<Route.Route.Module<typeof route>>().type.toBe<{ readonly title: "descriptor" }>()
    expect<ReturnType<ReturnType<typeof route.useLoaderData>>>().type.toBe<number>()
    expect(createRootRoute).type.toBeCallableWith({ lazy: () => Effect.succeed({ title: "descriptor" }) })
  })
})
