// Isolated module augmentation, checked by TSTyche rather than the runtime-test project.
import { MemoryHistory, type Router, type RouteTree } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter, useNavigateEffect } from "@effect-stack/router-solid"
import { Effect, Schema } from "effect"
import { expect, test } from "tstyche"

class Unavailable extends Schema.TaggedError<Unavailable>()("Unavailable", { message: Schema.String }) {}
const root = createRootRoute()
const project = createRoute({
  getParentRoute: () => root,
  path: "projects/:id",
  params: { id: Schema.FiniteFromString },
  loader: () => Effect.fail(new Unavailable({ message: "offline" }))
})
const tree = root.addChildren([project])
const router = createRouter({ routeTree: tree, history: MemoryHistory.layer() })

declare module "@effect-stack/router-solid" {
  interface Register {
    router: typeof router
  }
}

test("registered Effect navigation preserves destinations and failures", () => {
  const navigate = useNavigateEffect()
  expect(navigate).type.toBeCallableWith({ to: "/projects/:id", params: { id: 42 } })
  expect(navigate).type.not.toBeCallableWith({ to: "/projects/:id" })
  expect(navigate).type.not.toBeCallableWith({ to: "/projects/:id", params: { id: "42" } })
  expect<Effect.Error<ReturnType<typeof navigate>>>().type.toBe<
    Router.NavigationError<ReadonlyArray<RouteTree.All<typeof tree>>>
  >()
  expect<Effect.Services<ReturnType<typeof navigate>>>().type.toBe<never>()
})
