import type { Route, RouteTree } from "@effect-stack/router"
import {
  createRootRoute,
  createRoute,
  createRouter,
  type Destination,
  useNavigate,
  useNavigateEffect,
  useRouterState
} from "@effect-stack/router-solid"
import { Effect, Schema } from "effect"
import type { Accessor, Component } from "solid-js"
import { describe, expect, test } from "tstyche"

const root = createRootRoute()
const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
declare const id: typeof ProjectId.Type
const project = createRoute({
  getParentRoute: () => root,
  path: "projects/:id",
  params: { id: ProjectId },
  loader: () => Effect.succeed({ name: "Effect" })
})
const tree = root.addChildren([project])
const router = createRouter({ routeTree: tree })
declare const destination: Destination<typeof tree>

describe("Solid review type regressions", () => {
  test("route hook selectors stay accessors and the zero-arg overload keeps plain values", () => {
    // The final zero-argument overload determines ReturnType, preserving prior tests.
    expect<ReturnType<typeof project.useParams>>().type.toBe<Accessor<{ readonly id: typeof ProjectId.Type }>>()
    expect<ReturnType<typeof project.useLoaderData>>().type.toBe<Accessor<{ name: string }>>()
    expect(project.useParams()).type.toBe<Accessor<{ readonly id: typeof ProjectId.Type }>>()
    expect(project.useParams((params) => params.id)).type.toBe<Accessor<typeof ProjectId.Type>>()
    expect(project.useLoaderData((data) => data.name)).type.toBe<Accessor<string>>()
    expect(project.useMatch((match) => match.location.pathname)).type.toBe<Accessor<string>>()
    expect(
      project.useParams((params) => String(params.id), { equals: (left: string, right: string) => left === right })
    )
      .type.toBe<Accessor<string>>()
  })
  test("router state exposes a selected navigation status as an accessor", () => {
    expect(useRouterState((result) => result._tag)).type.toBe<Accessor<"Initial" | "Success" | "Failure">>()
    expect(
      useRouterState((result) => result._tag === "Success", {
        equals: (left: boolean, right: boolean) => left === right
      })
    )
      .type.toBe<Accessor<boolean>>()
  })
  test("the navigate bridge exposes Promises and registry-free Effects", () => {
    const navigate = useNavigate()
    const controller = new AbortController()
    expect(navigate(destination)).type.toBe<Promise<void>>()
    expect(navigate(destination, { signal: controller.signal })).type.toBe<Promise<void>>()
    const navigateEffect = useNavigateEffect()
    // The provider's registry is already supplied: no residual requirements remain.
    expect(navigateEffect(destination)).type.toBe<Effect.Effect<void, unknown, never>>()
  })
  test("the client router exposes one compiled target for the tree", () => {
    expect(router.compiled).type.toBe<RouteTree.Compiled<RouteTree.All<typeof tree>>>()
    expect(router.compiled.target).type.toBe<RouteTree.Compiled["target"]>()
    expect(router.compiled.routes).type.toBe<ReadonlyArray<RouteTree.All<typeof tree>>>()
    expect<ReturnType<typeof router.compiled.target>["input"]>().type.toBe<
      Route.Route.Input<Route.Any>
    >()
    expect(router.href).type.toBeCallableWith({ to: "/projects/:id", params: { id } })
    expect(router.href).type.not.toBeCallableWith({ to: "/projects/:id", params: { id: 42 } })
  })
  test("lazy module view validation distributes over unions and rejects present nulls", () => {
    expect(createRoute).type.not.toBeCallableWith({
      getParentRoute: () => root,
      path: "null-default",
      load: () => Effect.succeed({ default: null })
    })
    expect(createRoute).type.not.toBeCallableWith({
      getParentRoute: () => root,
      path: "null-component",
      load: () => Effect.succeed({ component: null })
    })
    // A union member without view keys must not shield an invalid view member.
    expect(createRoute).type.not.toBeCallableWith({
      getParentRoute: () => root,
      path: "union-default",
      load: () => Effect.succeed<{ default: 42 } | { title: string }>({ title: "descriptor" })
    })
    expect(createRoute).type.toBeCallableWith({
      getParentRoute: () => root,
      path: "union-component",
      load: () => Effect.succeed<{ component: Component } | { title: string }>({ title: "descriptor" })
    })
    // Optional undefined exports still count as absent.
    expect(createRoute).type.toBeCallableWith({
      getParentRoute: () => root,
      path: "optional-default",
      load: () => Effect.succeed<{ default?: Component; title: string }>({ title: "descriptor" })
    })
  })
})
