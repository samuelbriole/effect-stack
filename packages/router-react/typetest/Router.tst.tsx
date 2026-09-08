import { MemoryHistory } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter, type Destination } from "@effect-stack/router-react"
import { Context, Effect, Layer, Schema } from "effect"
import { describe, expect, test } from "tstyche"

class Projects extends Context.Service<Projects, { readonly name: string }>()("Projects") {}
const root = createRootRoute({ search: { tab: Schema.optionalKey(Schema.String) } })
const layout = createRoute({ getParentRoute: () => root, id: "layout" })
const project = createRoute({
  getParentRoute: () => layout,
  path: "projects/:id",
  params: { id: Schema.FiniteFromString },
  loader: ({ params, search }) => {
    expect(params.id).type.toBe<number>()
    expect(search.tab).type.toBe<string | undefined>()
    return Projects.use((service) => Effect.succeed({ id: params.id, name: service.name }))
  }
})
const tree = root.addChildren([layout.addChildren([project])])
describe("React routing inference", () => {
  test("preserves inherited paths and route-local data", () => {
    expect(layout.to).type.toBe<"/">()
    expect(project.to).type.toBe<"/projects/:id">()
    expect<ReturnType<typeof project.useLoaderData>>().type.toBe<{ id: number; name: string }>()
    expect<ReturnType<typeof project.useParams>>().type.toBe<{ readonly id: number }>()
  })
  test("requires services and destination params", () => {
    expect(createRouter).type.not.toBeCallableWith({ routeTree: tree })
    expect(createRouter).type.toBeCallableWith({
      routeTree: tree,
      history: MemoryHistory.layer(),
      layer: Layer.succeed(Projects, { name: "Project" })
    })
    const destination = (value: Destination<typeof tree>) => value
    expect(destination).type.toBeCallableWith({ to: "/projects/:id", params: { id: 42 } })
    expect(destination).type.not.toBeCallableWith({ to: "/projects/:id" })
    expect(destination).type.not.toBeCallableWith({ to: "/projects/:id", params: { id: "42" } })
    expect(destination).type.not.toBeCallableWith({ to: "/missing" })
  })
})
