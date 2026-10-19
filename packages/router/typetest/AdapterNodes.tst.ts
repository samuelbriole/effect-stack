import { describe, expect, test } from "tstyche"
import type * as Router from "@effect-stack/router/Router"
import { getApplicationNode, getApplicationNodes, makeDefinitionEngine } from "@effect-stack/router/Adapter"

describe("canonical application schema facts", () => {
  test("does not expose private gate or presentation records", () => {
    const engine = makeDefinitionEngine({ renderer: "Types", normalize: () => ({}), isEmpty: () => false })
    expect(getApplicationNodes(engine, {})).type.toBe<ReadonlyArray<Router.AnyNode>>()
    expect(getApplicationNode(engine, {}, {})).type.toBe<Router.AnyNode>()
  })
})
