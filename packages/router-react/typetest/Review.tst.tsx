import { createRootRoute, createRoute, type useNavigate, type useNavigateEffect } from "@effect-stack/router-react"
import { Effect, Schema } from "effect"
import { expect, test } from "tstyche"

const root = createRootRoute()
const project = createRoute({
  getParentRoute: () => root,
  path: "projects/:id",
  params: { id: Schema.FiniteFromString },
  loader: () => Effect.succeed({ name: "project", count: 42 })
})

test("route hook selectors preserve their selected output", () => {
  expect(project.pipe((route) => route.useParams())).type.toBe<{ readonly id: number }>()
  expect(createRootRoute).type.not.toBeCallableWith({ lazy: () => Effect.succeed({ default: null }) })
  const unionModule = () => Effect.succeed<{ readonly default: number } | { readonly title: string }>({ default: 42 })
  expect(createRootRoute).type.not.toBeCallableWith({ lazy: unionModule })
  expect(project.useParams((params) => params.id)).type.toBe<number>()
  expect(project.useLoaderData((data) => data.name)).type.toBe<string>()
  expect(project.useMatch((match) => match.loaderData.count)).type.toBe<number>()
  expect<ReturnType<typeof project.useParams>>().type.toBe<{ readonly id: number }>()
})

test("renderer navigation has awaitable and Effect composition surfaces", () => {
  expect<ReturnType<ReturnType<typeof useNavigate>>>().type.toBe<Promise<void>>()
  expect<Effect.Success<ReturnType<ReturnType<typeof useNavigateEffect>>>>().type.toBe<void>()
  expect<Effect.Services<ReturnType<ReturnType<typeof useNavigateEffect>>>>().type.toBe<never>()
})
