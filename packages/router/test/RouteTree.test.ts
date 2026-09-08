import { MemoryHistory, Route, Router, RouteTree } from "@effect-stack/router"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"

describe("RouteTree", () => {
  it("ranks static paths before dynamic paths and retains pathless ancestors", () => {
    const root = RouteTree.root()
    const layout = RouteTree.make({ getParentRoute: () => root, id: "layout" })
    const dynamic = RouteTree.make({ getParentRoute: () => layout, path: ":id", params: { id: Schema.String } })
    const fixed = RouteTree.make({ getParentRoute: () => layout, path: "new" })
    const tree = root.addChildren([layout.addChildren([dynamic, fixed])])
    const routes = RouteTree.flatten(tree)
    const plan = RouteTree.plan(routes, { pathname: "/new", search: "", hash: "" })
    expect(plan.entries.map(({ route }) => route.id)).toEqual([root.id, layout.id, fixed.id])
    expect(plan.notFound).toBe(false)
    const missing = RouteTree.plan(routes, { pathname: "/new/missing", search: "", hash: "" })
    expect(missing.notFound).toBe(true)
    expect(missing.entries.at(-1)?.route.id).toBe(fixed.id)
  })

  it("rejects ambiguous paths, misplaced children, and inherited field overrides", () => {
    const root = RouteTree.root({ search: { tab: Schema.String } })
    const a = RouteTree.make({ getParentRoute: () => root, path: ":a", params: { a: Schema.String } })
    const b = RouteTree.make({ getParentRoute: () => root, path: ":b", params: { b: Schema.String } })
    expect(() => RouteTree.flatten(root.addChildren([a, b]))).toThrow("Ambiguous")
    const child = RouteTree.make({ getParentRoute: () => a, path: "child" })
    expect(() => RouteTree.flatten(root.addChildren([child]))).toThrow("different parent")
    expect(() => RouteTree.make({ getParentRoute: () => root, path: "bad", search: { tab: Schema.String } })).toThrow(
      "redefined"
    )
  })

  it("compiles the tree once with the same ranking, ancestors, and not-found behavior", () => {
    const root = RouteTree.root()
    const layout = RouteTree.make({ getParentRoute: () => root, id: "layout" })
    const dynamic = RouteTree.make({ getParentRoute: () => layout, path: ":id", params: { id: Schema.String } })
    const fixed = RouteTree.make({ getParentRoute: () => layout, path: "new" })
    const tree = root.addChildren([layout.addChildren([dynamic, fixed])])
    const compiled = RouteTree.compile(tree)
    const routes = RouteTree.flatten(tree)
    expect(RouteTree.compile(tree)).toBe(compiled)
    expect(compiled.routes).toEqual(routes)
    expect(compiled.ranked.map(({ route }) => route.id)).toEqual([fixed.id, dynamic.id, layout.id, root.id])
    expect(compiled.byId.get(dynamic.id)?.route).toBe(dynamic)
    for (const pathname of ["/new", "/42", "/new/missing", "/"]) {
      const location = { pathname, search: "", hash: "" }
      expect(compiled.plan(location)).toEqual(RouteTree.plan(routes, location))
    }
    const branch = compiled.plan({ pathname: "/new", search: "", hash: "" })
    expect(branch.entries.map(({ route }) => route.id)).toEqual([root.id, layout.id, fixed.id])
    const missing = compiled.plan({ pathname: "/new/missing", search: "", hash: "" })
    expect(missing.notFound).toBe(true)
    expect(missing.entries.at(-1)?.route.id).toBe(fixed.id)
  })

  it("selects ranked endpoints from compiled trees and rejects unknown destinations", () => {
    const root = RouteTree.root()
    const project = RouteTree.make({
      getParentRoute: () => root,
      path: "projects/:id",
      params: { id: Schema.FiniteFromString }
    })
    const layout = RouteTree.make({ getParentRoute: () => project, id: "layout" })
    const index = RouteTree.make({ getParentRoute: () => layout, path: "/" })
    const tree = root.addChildren([project.addChildren([layout.addChildren([index])])])
    const compiled = RouteTree.compile(tree)
    const routes = RouteTree.flatten(tree)
    expect(compiled.target({ to: "/projects/:id" }).route).toBe(index)
    expect(RouteTree.target(routes, { to: "/projects/:id" }).route).toBe(index)
    expect(compiled.target({ to: "/" }).route).toBe(tree)
    expect(() => compiled.target({ to: "/missing" })).toThrow("Unknown route destination")
    const a = RouteTree.make({ getParentRoute: () => root, path: ":a", params: { a: Schema.String } })
    const b = RouteTree.make({ getParentRoute: () => root, path: ":b", params: { b: Schema.String } })
    expect(() => RouteTree.compile(root.addChildren([a, b]))).toThrow("Ambiguous route template")
    expect(() => RouteTree.compile(project)).toThrow("different parent")
  })

  it("makes nodes pipeable and recognizable across adapter spreads", () => {
    const root = RouteTree.root()
    const child = RouteTree.make({ getParentRoute: () => root, path: "child" })
    expect(child.pipe()).toBe(child)
    expect(child.pipe((value) => value.to)).toBe("/child")
    const tree = root.pipe((value) => value.addChildren([child]))
    expect(tree.children).toEqual([child])
    expect(RouteTree.isNode(tree)).toBe(true)
    expect(RouteTree.isNode(child)).toBe(true)
    const decorated = { ...tree, component: "stub" }
    expect(RouteTree.isNode(decorated)).toBe(true)
    expect(decorated.pipe()).toBe(decorated)
    expect(RouteTree.isNode({ ...decorated, addChildren: () => decorated })).toBe(true)
    expect(RouteTree.isNode(Route.make({ id: "standalone", path: "/standalone", params: {}, search: {} }))).toBe(false)
    expect(RouteTree.isNode(undefined)).toBe(false)
    expect(RouteTree.isNode("__root__")).toBe(false)
  })

  it.effect("resolves ancestor loaders with inherited inputs and attributes child failures", () =>
    Effect.gen(function*() {
      const calls: Array<string> = []
      const root = RouteTree.root({
        loader: () =>
          Effect.sync(() => {
            calls.push("root")
            return "root"
          })
      })
      const parent = RouteTree.make({
        getParentRoute: () => root,
        path: "projects/:id",
        params: { id: Schema.FiniteFromString },
        loader: ({ params }) =>
          Effect.sync(() => {
            calls.push(`parent:${params.id}`)
            return params.id
          })
      })
      const child = RouteTree.make({
        getParentRoute: () => parent,
        path: "details",
        loader: ({ params }) => Effect.fail(`missing:${params.id}`)
      })
      const router = Router.fromTree({
        routeTree: root.addChildren([parent.addChildren([child])]),
        layer: MemoryHistory.layer("/projects/42/details")
      })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      yield* AtomRegistry.mount(registry, router.branch)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(Effect.exit)
      expect(calls).toEqual(["root", "parent:42"])
      const branch = registry.get(router.branch)
      expect(branch.matches.map((entry) => entry.result._tag)).toEqual(["Success", "Success", "Failure"])
    }))
})
