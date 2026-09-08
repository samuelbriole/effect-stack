import { MemoryHistory, type Route, type RouteTree } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter, type Destination } from "@effect-stack/router-solid"
import { Context, Effect, Layer, Schema } from "effect"
import type { Accessor } from "solid-js"
import { describe, expect, test } from "tstyche"

class Projects extends Context.Service<Projects, { readonly name: string }>()("test/Projects") {}
class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}
const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
declare const id: typeof ProjectId.Type
const root = createRootRoute({ search: { tab: Schema.optionalKey(Schema.String) } })
const layout = createRoute({ getParentRoute: () => root, id: "layout" })
const project = createRoute({
  getParentRoute: () => layout,
  path: "projects/:id",
  params: { id: ProjectId },
  loader: ({ params, search }) => {
    expect(params.id).type.toBe<typeof ProjectId.Type>()
    expect(search.tab).type.toBe<string | undefined>()
    return Projects.use((service) =>
      service.name === "" ? Effect.fail(new Missing({})) : Effect.succeed({ id: params.id, name: service.name })
    )
  }
})
const inner = createRoute({ getParentRoute: () => project, id: "inner" })
const index = createRoute({
  getParentRoute: () => inner,
  path: "/",
  search: { page: Schema.FiniteFromString },
  hash: Schema.Literals(["top", "details"])
})
const tree = root.addChildren([layout.addChildren([project.addChildren([inner.addChildren([index])])])])
const destination = (value: Destination<typeof tree>) => value
declare const match: ReturnType<ReturnType<typeof project.useMatch>>

describe("Solid route inference", () => {
  test("preserves inherited paths and typed reactive accessors", () => {
    expect(layout.to).type.toBe<"/">()
    expect(project.to).type.toBe<"/projects/:id">()
    expect<ReturnType<typeof project.useParams>>().type.toBe<Accessor<{ readonly id: typeof ProjectId.Type }>>()
    expect<ReturnType<typeof project.useSearch>>().type.toBe<Accessor<{ readonly tab?: string }>>()
    expect<ReturnType<typeof project.useLoaderData>>().type.toBe<
      Accessor<{ id: typeof ProjectId.Type; name: string }>
    >()
    expect(match.loaderData).type.toBe<{ id: typeof ProjectId.Type; name: string }>()
    expect(match.id).type.toBe<"__root__/layout/projects/:id">()
    expect<Route.Route.LoaderError<typeof project>>().type.toBe<Missing>()
    expect<Route.Route.Services<RouteTree.All<typeof tree>>>().type.toBe<Projects>()
  })
  test("requires native service Layers and the ranked index's URL inputs", () => {
    expect(createRouter).type.not.toBeCallableWith({ routeTree: tree })
    expect(createRouter).type.toBeCallableWith({
      routeTree: tree,
      history: MemoryHistory.layer(),
      layer: Layer.succeed(Projects, { name: "Project" })
    })
    expect(destination).type.toBeCallableWith({ to: "/" })
    expect(destination).type.toBeCallableWith({ to: "/projects/:id", params: { id }, search: { page: 2 }, hash: "top" })
    expect(destination).type.not.toBeCallableWith({ to: "/projects/:id", params: { id } })
    expect(destination).type.not.toBeCallableWith({ to: "/projects/:id", params: { id }, search: { page: 2 } })
    expect(destination).type.not.toBeCallableWith({
      to: "/projects/:id",
      params: { id: 42 },
      search: { page: 2 },
      hash: "top"
    })
    expect(destination).type.not.toBeCallableWith({ to: "/missing" })
  })
})
