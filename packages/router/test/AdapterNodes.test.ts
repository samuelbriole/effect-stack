import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Router from "@effect-stack/router/Router"
import {
  finishApplication,
  getApplicationNodes,
  getApplicationNode,
  getApplicationViews,
  makeDefinitionEngine
} from "@effect-stack/router/Adapter"

const makeEngine = () =>
  makeDefinitionEngine({
    renderer: "same-name",
    normalize: (options) => options as { readonly component?: string },
    isEmpty: (view) => view.component === undefined
  })

describe("application node bridge", () => {
  it("returns canonical selected nodes including ancestors, without gate metadata", () => {
    const engine = makeEngine()
    const parent = engine.layout(undefined, "parent", "/parent", {})
    const child = engine.route(parent, "child", "/child", { component: "child", prepare: () => Effect.void })
    engine.route(parent, "unselected", "/unselected", { component: "unselected" })
    const app = finishApplication(engine, "Nodes", [child] as never)
    const nodes = getApplicationNodes(engine, app)
    expect(nodes.map((node) => node.id)).toEqual(["parent", "parent.child"])
    expect(getApplicationNodes(engine, app)).toBe(nodes)
    const definition = child as { readonly to: () => Router.Destination<unknown> }
    expect(nodes[1]).toBe(definition.to().node)
    expect(nodes[1]?.parentId).toBe(nodes[0]?.id)
    for (const node of nodes) {
      expect(node).not.toHaveProperty("prepare")
      expect(node).not.toHaveProperty("component")
    }
  })

  it("requires both the exact finalized witness and the exact factory capability", () => {
    const engine = makeEngine()
    const child = engine.route(undefined, "child", "/", { component: "child" })
    const app = finishApplication(engine, "Owned", [child] as never)
    const core = Router.make("Core", [Router.route("home", "/")])
    for (const invalid of [undefined, null, {}, { ...app }, core, child]) {
      expect(() => getApplicationNodes(engine, invalid)).toThrow(Router.RouteDefinitionError)
      expect(() => getApplicationViews(engine, invalid)).toThrow(Router.RouteDefinitionError)
    }
    expect(() => getApplicationNodes(makeEngine(), app)).toThrow(Router.RouteDefinitionError)
    expect(getApplicationNodes({ ...engine }, app)).toBe(getApplicationNodes(engine, app))
  })

  it("resolves exact selected definitions and rejects copies, foreign definitions, and unselected nodes", () => {
    const engine = makeEngine()
    const parent = engine.layout(undefined, "parent", "/parent", {})
    const child = engine.route(parent, "child", "/child", { component: "child" })
    const unselected = engine.route(parent, "unselected", "/unselected", { component: "other" })
    const app = finishApplication(engine, "ExactNodes", [child] as never)
    const nodes = getApplicationNodes(engine, app)
    expect(getApplicationNode(engine, app, parent)).toBe(nodes[0])
    expect(getApplicationNode(engine, app, child)).toBe(nodes[1])
    const foreign = makeEngine().route(undefined, "parent", "/parent", { component: "foreign" })
    for (const invalid of [undefined, {}, { ...child }, unselected, foreign]) {
      expect(() => getApplicationNode(engine, app, invalid)).toThrow(Router.RouteDefinitionError)
    }
  })
})
