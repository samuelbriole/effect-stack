import { type Route, RouteTree } from "@effect-stack/router"
import { Schema } from "effect"
import { describe, expect, test } from "tstyche"

const root = RouteTree.root()
const child = RouteTree.make({ getParentRoute: () => root, path: "child" })
const project = RouteTree.make({
  getParentRoute: () => root,
  path: "projects/:id",
  params: { id: Schema.FiniteFromString }
})
const layout = RouteTree.make({ getParentRoute: () => project, id: "layout" })
const index = RouteTree.make({ getParentRoute: () => layout, path: "/", search: { tab: Schema.String } })

describe("RouteTree.Node", () => {
  test("composes through pipe with the same inference as direct calls", () => {
    expect(root.pipe()).type.toBe<typeof root>()
    expect(root.pipe((node) => node.kind)).type.toBe<"root">()
    const direct = root.addChildren([child])
    const piped = root.pipe((node) => node.addChildren([child]))
    expect(piped).type.toBe<typeof direct>()
    expect(piped.children).type.toBe<readonly [typeof child]>()
    expect(piped.to).type.toBe<"/">()
  })

  test("threads the node through each stage", () => {
    expect(root.pipe((node) => node.addChildren([child]), (node) => node.children)).type.toBe<
      readonly [typeof child]
    >()
    const decorated = { ...root.addChildren([child]), component: "stub" }
    expect(decorated.pipe((node) => node.to)).type.toBe<"/">()
    expect(decorated.pipe()).type.toBe<typeof decorated>()
  })

  test("preserves the typed destination model through pipe-built trees", () => {
    const tree = root.pipe((node) => node.addChildren([child, project.addChildren([layout.addChildren([index])])]))
    const destination = (input: RouteTree.Destination<typeof tree>) => input
    expect(destination).type.toBeCallableWith({ to: "/child" })
    expect(destination).type.toBeCallableWith({ to: "/projects/:id", params: { id: 42 }, search: { tab: "overview" } })
    expect(destination).type.not.toBeCallableWith({ to: "/projects/:id", params: { id: 42 } })
    expect(destination).type.not.toBeCallableWith({ to: "/missing" })
  })

  test("narrows unknown values to native nodes", () => {
    expect(RouteTree.isNode).type.toBe<(value: unknown) => value is RouteTree.Node<Route.Any>>()
    const compileUnknown = (value: unknown): RouteTree.Compiled | undefined =>
      RouteTree.isNode(value) ? RouteTree.compile(value) : undefined
    expect(compileUnknown).type.toBe<(value: unknown) => RouteTree.Compiled | undefined>()
    expect(RouteTree.isNode(child)).type.toBe<boolean>()
  })
})

describe("RouteTree.compile", () => {
  const tree = root.addChildren([child, project.addChildren([layout.addChildren([index])])])
  const compiled = RouteTree.compile(tree)

  test("preserves the tree's route union", () => {
    expect(compiled).type.toBe<RouteTree.Compiled<RouteTree.All<typeof tree>>>()
    expect({} as (typeof compiled.routes)[number]).type.toBe<RouteTree.All<typeof tree>>()
    expect({} as (typeof compiled.ranked)[number]["route"]).type.toBe<RouteTree.All<typeof tree>>()
    expect({} as (typeof compiled.ranked)[number]["segments"]).type.toBe<ReadonlyArray<string>>()
    expect(compiled.byId.get(child.id)).type.toBe<RouteTree.Ranked<RouteTree.All<typeof tree>> | undefined>()
    expect(compiled.endpoints.get("/child")).type.toBe<RouteTree.All<typeof tree> | undefined>()
  })

  test("stays erased for renderer adapters", () => {
    const erased: RouteTree.Compiled = compiled
    expect(erased.routes).type.toBe<ReadonlyArray<RouteTree.Any>>()
    expect(erased.ranked).type.toBe<ReadonlyArray<RouteTree.Ranked>>()
    expect(erased.byId.get(child.id)).type.toBe<RouteTree.Ranked | undefined>()
    expect(erased.endpoints.get("/child")).type.toBe<RouteTree.Any | undefined>()
  })

  test("plans and selects endpoints from the compiled tree", () => {
    expect(compiled.plan).type.toBe<(location: Route.UrlParts) => RouteTree.Plan>()
    expect(compiled.target).type.toBe<
      (destination: RouteTree.DestinationInput) => {
        readonly route: RouteTree.Any
        readonly input: Route.Route.Input<Route.Any>
      }
    >()
  })
})
