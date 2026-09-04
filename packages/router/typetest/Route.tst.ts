import * as Route from "@effect-stack/router/Route"
import * as Schema from "effect/Schema"
import { describe, expect, test } from "tstyche"

const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
type ProjectId = typeof ProjectId.Type

declare const projectId: ProjectId

const project = Route.make({
  id: "project",
  path: "/projects/:projectId",
  params: { projectId: ProjectId },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  hash: Schema.Literals(["", "details"])
})

describe("Route", () => {
  test("preserves route IDs and decoded Schema types", () => {
    expect(project.id).type.toBe<"project">()
    expect<Route.Route.Params<typeof project>>().type.toBe<{ readonly projectId: ProjectId }>()
    expect<Route.Route.Search<typeof project>>().type.toBe<{
      readonly tab?: "overview" | "activity"
    }>()
    expect<Route.Route.Hash<typeof project>>().type.toBe<"" | "details">()
  })

  test("requires exactly the named path fields", () => {
    expect(Route.make).type.not.toBeCallableWith({
      id: "missing",
      path: "/projects/:projectId",
      params: {},
      search: {}
    })
    expect(Route.make).type.not.toBeCallableWith({
      id: "extra",
      path: "/projects",
      params: { projectId: ProjectId },
      search: {}
    })
  })

  test("accepts only inferred values when building hrefs", () => {
    expect(Route.href).type.toBeCallableWith(project, {
      params: { projectId },
      search: { tab: "activity" },
      hash: "details"
    })
    expect(Route.href).type.not.toBeCallableWith(project, {
      params: { projectId: 42 },
      search: { tab: "activity" },
      hash: "details"
    })
    expect(Route.href).type.not.toBeCallableWith(project, {
      params: { projectId, other: "extra" },
      search: { tab: "activity" },
      hash: "details"
    })
    expect(Route.href).type.not.toBeCallableWith(project, {
      params: { projectId },
      search: { tab: "invalid" },
      hash: "details"
    })
  })
})
