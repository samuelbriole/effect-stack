import { RouteTree } from "@effect-stack/router"
import { Schema } from "effect"
import { describe, expect, test } from "tstyche"

const root = RouteTree.root()
const project = RouteTree.make({
  getParentRoute: () => root,
  path: "projects/:id",
  params: { id: Schema.FiniteFromString }
})
const layout = RouteTree.make({ getParentRoute: () => project, id: "layout" })
const index = RouteTree.make({ getParentRoute: () => layout, path: "/", search: { tab: Schema.String } })
const tree = root.addChildren([project.addChildren([layout.addChildren([index])])])
const destination = (input: RouteTree.Destination<typeof tree>) => input

describe("headless destinations", () => {
  test("requires the ranked index's inherited params and search", () => {
    expect(destination).type.toBeCallableWith({ to: "/" })
    expect(destination).type.toBeCallableWith({ to: "/projects/:id", params: { id: 42 }, search: { tab: "overview" } })
    expect(destination).type.not.toBeCallableWith({ to: "/projects/:id", params: { id: 42 } })
    expect(destination).type.not.toBeCallableWith({
      to: "/projects/:id",
      params: { id: "42" },
      search: { tab: "overview" }
    })
    expect(destination).type.not.toBeCallableWith({ to: "/missing" })
  })
})
