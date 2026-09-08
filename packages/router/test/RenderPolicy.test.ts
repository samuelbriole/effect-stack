import { History, RenderPolicy, Route } from "@effect-stack/router"
import { Option } from "effect"
import { AsyncResult } from "effect/unstable/reactivity"
import { describe, expect, it } from "vitest"

describe("declarative destination policy", () => {
  const location = Option.some({
    ...History.destinationFromHref("/projects/42?tab=activity#details", { n: 1 }),
    state: { n: 1 },
    key: "one",
    index: 0
  })
  it("detects state-only changes and equivalent newly allocated state", () => {
    const previous = { href: "/projects/42?tab=activity#details", replace: true, state: { n: 1 } }
    expect(RenderPolicy.sameIntent(previous, { ...previous, state: { n: 1 } })).toBe(true)
    expect(RenderPolicy.sameIntent(previous, { ...previous, state: { n: 2 } })).toBe(false)
    expect(RenderPolicy.isSatisfied(previous, location)).toBe(true)
    expect(RenderPolicy.isSatisfied({ ...previous, state: { n: 2 } }, location)).toBe(false)
    expect(RenderPolicy.isSatisfied({ ...previous, state: undefined }, location)).toBe(true)
    expect(RenderPolicy.isSatisfied(previous, Option.none())).toBe(false)
  })
})

describe("shared boundary selection", () => {
  const root = Route.make({ id: "root", path: "/", params: {}, search: {} })
  const parent = Route.make({ id: "parent", path: "/parent", params: {}, search: {} })
  const child = Route.make({ id: "child", path: "/parent/child", params: {}, search: {} })
  const declares = (route: Route.Any) => route.id === parent.id
  it("presents a transition-wide failure even when retained matches succeeded", () => {
    const failure = new Error("history unavailable")
    const branch = {
      matches: [{ route: root, result: AsyncResult.success(undefined) }],
      notFound: false,
      result: AsyncResult.fail(failure)
    }
    expect(RenderPolicy.select(branch, 0, declares)).toEqual({
      _tag: "Boundary",
      routeId: "root",
      kind: "errorComponent",
      error: failure
    })
  })
  it("prefers failure to pending and replaces descendants at the nearest boundary", () => {
    const failure = new Error("failed")
    const branch = {
      matches: [
        { route: root, result: AsyncResult.success(undefined) },
        { route: parent, result: AsyncResult.initial() },
        { route: child, result: AsyncResult.fail(failure) }
      ],
      notFound: true
    }
    expect(RenderPolicy.select(branch, 0, declares)).toEqual({ _tag: "View", routeId: "root" })
    expect(RenderPolicy.select(branch, 1, declares)).toEqual({
      _tag: "Boundary",
      routeId: "parent",
      kind: "errorComponent",
      error: failure
    })
    expect(RenderPolicy.select(branch, 2, declares)).toEqual({ _tag: "Empty" })
  })
  it("prefers pending to not-found and uses a root default when no fallback is declared", () => {
    const branch = {
      matches: [{ route: root, result: AsyncResult.success(undefined) }, {
        route: child,
        result: AsyncResult.initial()
      }],
      notFound: true
    }
    expect(RenderPolicy.select(branch, 0, () => false)).toEqual({
      _tag: "Boundary",
      routeId: "root",
      kind: "pendingComponent",
      error: undefined
    })
    const complete = {
      ...branch,
      matches: branch.matches.map((entry) => ({ route: entry.route, result: AsyncResult.success(undefined) }))
    }
    expect(RenderPolicy.select(complete, 0, () => false)).toEqual({
      _tag: "Boundary",
      routeId: "root",
      kind: "notFoundComponent",
      error: undefined
    })
  })
})
