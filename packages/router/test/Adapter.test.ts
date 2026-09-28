import { describe, expect, it } from "@effect/vitest"
import { makeDefinitionEngine, finishApplication, resolveNavigationTarget } from "@effect-stack/router/Adapter"
import { RouteDefinitionError } from "@effect-stack/router/Router"
import * as Router from "@effect-stack/router/Router"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

interface Presentation {
  readonly component?: unknown
  readonly empty?: boolean
}

const makeEngine = (renderer: string) =>
  makeDefinitionEngine<Presentation>({
    renderer,
    normalize: (options) => {
      const value = (options ?? {}) as Presentation
      return value.component === undefined ? {} : { component: value.component }
    },
    isEmpty: (presentation) => presentation.component === undefined && presentation.empty !== true
  })

const component = (): null => null

describe("shared navigation target policy", () => {
  const Home = Router.route("home", "/")
  const Item = Router.route("item", "/items/:id", {
    params: { id: Schema.FiniteFromString },
    search: { page: Schema.FiniteFromString },
    hash: Schema.String
  })
  const App = Router.make("Targets", [Home, Item])

  it("resolves path strings and path input records without acquiring a service", () => {
    expect(Result.getOrThrow(Router.href(Result.getOrThrow(resolveNavigationTarget(App, "/"))))).toBe("/")
    const resolved = Result.getOrThrow(
      resolveNavigationTarget(App, {
        to: "/items/:id",
        params: { id: 7 },
        search: { page: 2 },
        hash: "details"
      })
    )
    expect(resolved.node).toBe(Item.to({ params: { id: 7 }, search: { page: 2 }, hash: "details" }).node)
    expect(Result.getOrThrow(Router.href(resolved))).toBe("/items/7?page=2#details")
  })

  it("preserves exact identity and captured defaults, ignoring sibling URL input", () => {
    const destination = Item.to(
      { params: { id: 7 }, search: { page: 2 }, hash: "details" },
      {
        replace: true,
        state: { saved: true }
      }
    )
    expect(Result.getOrThrow(resolveNavigationTarget(App, destination))).toBe(destination)
    expect(
      Result.getOrThrow(
        resolveNavigationTarget(App, {
          to: destination,
          params: { id: 99 },
          search: { page: 99 },
          hash: "ignored"
        })
      )
    ).toBe(destination)
    expect(destination.replace).toBe(true)
    expect(destination.state).toEqual({ saved: true })
    const Foreign = Router.route("foreign", "/foreign").to()
    expect(Result.getOrThrow(resolveNavigationTarget(App, Foreign))).toBe(Foreign)
  })

  it("reports unknown templates but leaves schema encoding to href or submission", () => {
    const missing = resolveNavigationTarget(App, { to: "/missing" })
    expect(Result.isFailure(missing)).toBe(true)
    if (Result.isFailure(missing)) expect(missing.failure).toBeInstanceOf(Router.RouteEncodeError)
    const invalid = resolveNavigationTarget(App, { to: "/items/:id", params: { id: "invalid" } })
    expect(Result.isSuccess(invalid)).toBe(true)
    if (Result.isSuccess(invalid)) expect(Result.isFailure(Router.href(invalid.success))).toBe(true)
  })
})

describe("definition engine ownership", () => {
  it("exposes only a neutral factory plus construction methods", () => {
    const engine = makeEngine("test")
    expect(Object.keys(engine).sort()).toEqual(["factory", "index", "layout", "route"])
    expect(Object.keys(engine.factory).sort()).toEqual(["isEmpty", "normalize", "renderer", "requiresPresentation"])
  })

  it("rejects cross-renderer nested construction", () => {
    const a = makeEngine("same-name")
    const b = makeEngine("same-name")
    const layoutB = b.layout(undefined, "g", "/g", {})
    expect(() => a.route(layoutB, "child", "/child", { component })).toThrow(RouteDefinitionError)
    expect(() => b.route(layoutB, "child", "/child", { component })).not.toThrow()
  })

  it("rejects a definition from another engine at finalization", () => {
    const a = makeEngine("a")
    const b = makeEngine("b")
    const home = a.route(undefined, "home", "/", { component })
    expect(() => finishApplication(b, "App", [home] as never)).toThrow(RouteDefinitionError)
    expect(() => finishApplication(a, "App", [home] as never)).not.toThrow()
  })

  it("rejects a copied selection definition", () => {
    const a = makeEngine("a")
    const home = a.route(undefined, "home", "/", { component })
    expect(() => finishApplication(a, "App", [{ ...(home as object) }] as never)).toThrow(RouteDefinitionError)
  })
})
