import {
  createRootRoute,
  createRoute,
  type NavigationError,
  type useNavigate,
  type useNavigateEffect,
  useRouterState
} from "@effect-stack/router-vue"
import { Effect, Schema } from "effect"
import { expect, test } from "tstyche"
import type { Component, ComputedRef } from "vue"

const root = createRootRoute()
const project = createRoute({
  getParentRoute: () => root,
  path: "projects/:id",
  params: { id: Schema.FiniteFromString },
  loader: () => Effect.succeed({ name: "project", count: 42 })
})

test("route hook selectors return computed projections of the selected output", () => {
  expect(project.useParams((params) => params.id)).type.toBe<ComputedRef<number>>()
  expect(project.useLoaderData((data) => data.name)).type.toBe<ComputedRef<string>>()
  expect(project.useMatch((match) => match.loaderData.count)).type.toBe<ComputedRef<number>>()
  expect(project.useParams((params) => params.id, { equals: (left, right) => left === right }))
    .type.toBe<ComputedRef<number>>()
})

test("zero-argument route hooks preserve their plain computed output", () => {
  expect<ReturnType<typeof project.useParams>>().type.toBe<ComputedRef<{ readonly id: number }>>()
  expect<ReturnType<typeof project.useLoaderData>>().type.toBe<ComputedRef<{ name: string; count: number }>>()
})

test("navigation exposes awaitable and Effect composition surfaces", () => {
  expect<ReturnType<ReturnType<typeof useNavigate>>>().type.toBe<Promise<void>>()
  expect<ReturnType<ReturnType<typeof useNavigateEffect>>>().type.toBe<Effect.Effect<void, NavigationError, never>>()
  expect<Effect.Error<ReturnType<ReturnType<typeof useNavigateEffect>>>>().type.toBe<NavigationError>()
  const navigate = undefined as unknown as ReturnType<typeof useNavigate>
  expect(navigate).type.toBeCallableWith({ to: "/" })
  expect(navigate).type.toBeCallableWith({ to: "/" }, { signal: new AbortController().signal })
  const navigateEffect = undefined as unknown as ReturnType<typeof useNavigateEffect>
  expect(navigateEffect({ to: "/" })).type.toBe<Effect.Effect<void, NavigationError, never>>()
})

test("router state subscriptions select without losing the plain projection", () => {
  expect(useRouterState).type.toBeCallableWith()
  expect(useRouterState((state) => state._tag)).type.toBe<ComputedRef<"Initial" | "Success" | "Failure">>()
})

test("present-null lazy module views stay invalid while optional undefined exports pass", () => {
  expect(createRoute).type.not.toBeCallableWith({
    getParentRoute: () => root,
    path: "null-default",
    lazy: () => Effect.succeed({ default: null })
  })
  expect(createRoute).type.not.toBeCallableWith({
    getParentRoute: () => root,
    path: "null-component",
    lazy: () => Effect.succeed({ component: null })
  })
  expect(createRoute).type.not.toBeCallableWith({
    getParentRoute: () => root,
    path: "union-invalid",
    lazy: () => Effect.succeed({ default: 42 } as { readonly default: number } | { readonly title: string })
  })
  expect(createRoute).type.not.toBeCallableWith({
    getParentRoute: () => root,
    path: "array-default",
    lazy: () => Effect.succeed({ default: [] })
  })
  expect(createRoute).type.toBeCallableWith({
    getParentRoute: () => root,
    path: "optional-view",
    lazy: () => Effect.succeed({ default: undefined as Component | undefined })
  })
})
