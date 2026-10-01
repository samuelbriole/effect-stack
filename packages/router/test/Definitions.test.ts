import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import { MemoryHistory, Router } from "@effect-stack/router"
import * as Adapter from "@effect-stack/router/Adapter"

const ProjectId = Schema.FiniteFromString

describe("route and layout validation", () => {
  it("rejects malformed local paths", () => {
    expect(() => Router.route("x", "no-slash" as `/${string}`)).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("x", "/a/")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("x", "/a//b")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("x", "/a/../b")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("x", "/a/./b")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("x", "/a?b")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("x", "/a#b")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("x", "/:id/:id", { params: { id: Schema.String } })).toThrow(Router.RouteDefinitionError)
  })

  it("requires local params to match the local path", () => {
    expect(() => Router.route("x", "/:id")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("x", "/a", { params: { id: ProjectId } })).toThrow(Router.RouteDefinitionError)
  })

  it("rejects invalid names", () => {
    expect(() => Router.route("", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("a.b", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("__proto__", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("constructor", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("toString", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.route("service", "/x")).toThrow(Router.RouteDefinitionError)
  })

  it("rejects duplicate qualified ids and repeated selections", () => {
    expect(() => Router.make("A", [Router.route("a", "/a"), Router.route("a", "/b")])).toThrow(
      Router.RouteDefinitionError
    )
    const shared = Router.route("shared", "/shared")
    expect(() => Router.make("A", [shared, shared])).toThrow(Router.RouteDefinitionError)
  })

  it("rejects inherited params and search redeclarations", () => {
    const Outer = Router.layout("outer", "/o/:projectId", { params: { projectId: ProjectId } })
    expect(() => Outer.layout("inner", "/i", { params: { projectId: ProjectId } })).toThrow(Router.RouteDefinitionError)
    const SearchOuter = Router.layout("searchOuter", "/s", {
      search: { tab: Schema.optionalKey(Schema.String) }
    })
    expect(() => SearchOuter.route("inner", "/i", { search: { tab: Schema.optionalKey(Schema.String) } })).toThrow(
      Router.RouteDefinitionError
    )
  })

  it("concatenates paths once and supports pathless layouts and index endpoints", () => {
    const Projects = Router.layout("projects", "/projects")
    const Settings = Projects.layout("settings", "/settings")
    const Index = Settings.index({ prepare: () => Effect.void })
    const Detail = Projects.route("detail", "/:projectId", { params: { projectId: ProjectId } })
    expect(Projects.path).toBe("/projects")
    expect(Settings.path).toBe("/projects/settings")
    expect(Index.path).toBe("/projects/settings")
    expect(Index.id).toBe("projects.settings.index")
    expect(Detail.path).toBe("/projects/:projectId")
    expect(Detail.id).toBe("projects.detail")
  })

  it("rejects an index declaration that adds params", () => {
    const Group = Router.layout("group", "/l")
    // oxlint-disable-next-line typescript/unbound-method -- Negative fixture: the erased index constructor is the assertion under test.
    const looseIndex = Group.index as unknown as (options: unknown) => unknown
    expect(() => looseIndex({ params: { id: Schema.String } })).toThrow(Router.RouteDefinitionError)
  })

  it("treats index as a same-path route with canonical selection identity", () => {
    const Parent = Router.layout("parent", "/parents/:id", { params: { id: Schema.String } })
    const Index = Parent.index()
    const Overview = Parent.route("overview", "/")
    expect((Index as unknown as Router.AnyNode).kind).toBe("route")
    expect((Overview as unknown as Router.AnyNode).kind).toBe("route")
    expect(Index.path).toBe(Overview.path)
    expect(Index["~parent"]).toBe(Parent)
    expect(Overview["~parent"]).toBe(Parent)
    for (const node of [Index, Overview]) {
      const App = Router.make("SamePath", [node])
      expect(Result.getOrThrow(Router.resolvePathDestination(App, node.path, { params: { id: "one" } })).node).toBe(
        node
      )
      expect(() => Router.make("Copied", [{ ...node }])).toThrow(Router.RouteDefinitionError)
    }
    // oxlint-disable-next-line typescript/unbound-method -- Negative fixture for the erased constructor boundary.
    const looseRoute = Parent.route as unknown as (name: string, path: string, options: unknown) => unknown
    expect(() => looseRoute("invalid", "/", { params: { extra: Schema.String } })).toThrow(Router.RouteDefinitionError)
  })

  it("registers native views on the single canonical application with exact factory ownership", () => {
    const spec = { renderer: "test", normalize: () => ({ title: "view" }), isEmpty: () => false }
    const engine = Adapter.makeDefinitionEngine(spec)
    const foreign = Adapter.makeDefinitionEngine(spec)
    const Leaf = engine.route(undefined, "leaf", "/leaf", {}) as Router.AnyDefinitionShape
    const App = Adapter.finishApplication(engine, "Native", [Leaf])
    const views = Adapter.getApplicationViews(engine, App)
    expect(views.get("leaf")).toEqual({ title: "view" })
    expect(Result.getOrThrow(Router.resolvePathDestination(App, "/leaf", {})).node).toBe(Leaf)
    expect(Adapter.getApplicationViews(engine, App)).toBe(views)
    expect(() => Adapter.getApplicationViews(foreign, App)).toThrow(Router.RouteDefinitionError)
    expect(() => Adapter.getApplicationViews(engine, { ...App })).toThrow(Router.RouteDefinitionError)
    const Headless = Router.make("Headless", [Router.route("headless", "/headless")])
    expect(() => Adapter.getApplicationViews(engine, Headless)).toThrow(Router.RouteDefinitionError)
    expect(() => Adapter.getApplicationViews(engine, undefined)).toThrow(Router.RouteDefinitionError)
  })

  it("rejects indistinguishable effective leaf templates", () => {
    const One = Router.route("one", "/x/:id", { params: { id: Schema.String } })
    const Two = Router.route("two", "/x/:name", { params: { name: Schema.String } })
    expect(() => Router.make("A", [One, Two])).toThrow(Router.RouteDefinitionError)
  })

  it("rejects application ids that would collide in encoded keys", () => {
    expect(() => Router.make("A/impl/b", [Router.route("a", "/a")])).toThrow(Router.RouteDefinitionError)
    expect(() => Router.make("A.B", [Router.route("a", "/a")])).toThrow(Router.RouteDefinitionError)
    expect(() => Router.make("", [Router.route("a", "/a")])).toThrow(Router.RouteDefinitionError)
  })

  it("keeps application service keys distinct across assemblies", () => {
    const Shared = Router.route("b", "/b")
    const oneApp = Router.make("A", [Shared])
    const oneAgain = Router.make("A", [Shared])
    const twoApp = Router.make("AB", [Shared])
    expect(oneApp.service.key).toContain("@effect-stack/router/A/service")
    expect(twoApp.service.key).toContain("@effect-stack/router/AB/service")
    expect(oneApp.service.key).not.toBe(twoApp.service.key)
    expect(oneApp.service.key).not.toBe(oneAgain.service.key)
  })

  it("does not materialize phantom schema or child props on definitions", () => {
    const Layout = Router.layout("group", "/group")
    const Leaf = Layout.route("leaf", "/leaf/:id", { params: { id: Schema.String } })
    expect(Leaf.id).toBe("group.leaf")
    expect(Leaf.path).toBe("/group/leaf/:id")
    expect(Leaf._tag).toBe("RouteDescriptor")
    expect("params" in Leaf).toBe(false)
    expect("search" in Leaf).toBe(false)
    expect("hash" in Leaf).toBe(false)
    expect("~node" in Leaf).toBe(false)
    expect("children" in Layout).toBe(false)
    expect(Layout._tag).toBe("GroupDescriptor")
  })

  it("does not execute codec transformations at construction time", () => {
    const calls: Array<string> = []
    const tracked = Schema.String.pipe(
      Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transform((value: string) => {
          calls.push("decode")
          return value
        }),
        encode: SchemaGetter.transform((value: string) => {
          calls.push("encode")
          return value
        })
      })
    )
    const Tracked = Router.route("tracked", "/tracked/:id", { params: { id: tracked } })
    const App = Router.make("Tracked", [Tracked])
    expect(calls).toEqual([])
    expect(Result.isSuccess(Router.href(Tracked.to({ params: { id: "x" } })))).toBe(true)
    expect(calls).toEqual(["encode"])
    void App
  })

  it.effect(
    "accepts a codec that is synchronous on one input and async on another, then fails typed at the boundary",
    () =>
      Effect.gen(function* () {
        const mixedCodec = Schema.String.pipe(
          Schema.decodeTo(Schema.String, {
            decode: SchemaGetter.transformEffect((value: string) =>
              value === "sync" ? Effect.succeed(value) : Effect.sleep("1 millis").pipe(Effect.as(value))
            ),
            encode: SchemaGetter.transformEffect((value: string) =>
              value === "sync" ? Effect.succeed(value) : Effect.sleep("1 millis").pipe(Effect.as(value))
            )
          })
        )
        const Mixed = Router.route("mixed", "/mixed/:id", { params: { id: mixedCodec } })
        const App = Router.make("Mixed", [Mixed])

        const syncDestination = Mixed.to({ params: { id: "sync" } })
        expect(Result.isSuccess(Router.href(syncDestination))).toBe(true)

        const encoded = Router.href(Mixed.to({ params: { id: "abc" } }))
        expect(Result.isFailure(encoded)).toBe(true)
        if (Result.isFailure(encoded)) expect(encoded.failure).toBeInstanceOf(Router.RouteEncodeError)

        const app = App.layer.pipe(Layer.provide(MemoryHistory.layer("/mixed/abc")))
        yield* Effect.gen(function* () {
          const router = yield* App.service
          const error = yield* Effect.flip(router.awaitInitial)
          expect(error).toBeInstanceOf(Router.RouteDecodeError)
        }).pipe(Effect.provide(app))
      })
  )

  it.effect("keeps layout hash failures as typed branch decoding failures", () =>
    Effect.gen(function* () {
      const G = Router.layout("g", "/g", { hash: Schema.Literals(["ok"]) })
      const Child = G.route("child", "/child", { prepare: () => Effect.void })
      const App = Router.make("Hash", [Child])
      const makeApp = (initial: string) => App.layer.pipe(Layer.provide(MemoryHistory.layer(initial)))

      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        expect(presentation._tag).toBe("Resolved")
      }).pipe(Effect.provide(makeApp("/g/child#ok")))

      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial.pipe(Effect.exit)
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        expect(presentation._tag).toBe("Failed")
        if (presentation._tag === "Failed") expect(presentation.owner).toBe("g")
      }).pipe(Effect.provide(makeApp("/g/child#nope")))
    })
  )

  it.effect("resolves nested layout data before descendants", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const Outer = Router.layout("outer", "/outer", {
        prepare: () =>
          Effect.sync(() => {
            order.push("outer")
          })
      })
      const Child = Outer.route("child", "/child", {
        prepare: () =>
          Effect.sync(() => {
            order.push("child")
          })
      })
      const App = Router.make("Order", [Child])
      const app = App.layer.pipe(Layer.provide(MemoryHistory.layer("/outer/child")))
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        expect(order).toEqual(["outer", "child"])
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        if (presentation._tag !== "Resolved") throw new Error("Expected a resolved branch")
        const entries = presentation.entries
        expect(entries.map((entry) => entry.id)).toEqual(["outer", "outer.child"])
        expect(entries[0] === undefined ? undefined : Result.getOrThrow(entries[0].input)).toMatchObject({
          params: {},
          search: {},
          hash: undefined
        })
      }).pipe(Effect.provide(app))
    })
  )

  it("rejects a path parameter that is not declared in params", () => {
    // A layout declaring a path parameter must also declare its schema.
    expect(() => Router.layout("broken", "/broken/:id")).toThrow(Router.RouteDefinitionError)
  })

  it("freezes definitions and does not mutate a parent when creating children", () => {
    const Parent = Router.layout("frozenParent", "/frozen")
    const Child = Parent.route("child", "/child")
    expect(Child["~parent"]).toBe(Parent)
    expect(Object.isFrozen(Parent)).toBe(true)
    expect(Object.isFrozen(Child)).toBe(true)
    expect(() => Object.assign(Child, { path: "/mutated" })).toThrow()
    // Creating a child does not attach anything to the parent's public surface.
    expect("child" in Parent).toBe(false)
  })

  it("rejects runtime handler factories and removed load options", () => {
    const construct = Router.route as unknown as (name: string, path: string, options: unknown) => unknown
    expect(() => construct("factory", "/factory", { prepare: Effect.succeed(() => Effect.void) })).toThrow(
      Router.RouteDefinitionError
    )
    expect(() => construct("load", "/load", { load: () => Effect.void })).toThrow(Router.RouteDefinitionError)
  })

  it.effect("encodes and decodes an index endpoint hash", () =>
    Effect.gen(function* () {
      const Parent = Router.layout("hashed", "/hashed", { prepare: () => Effect.void })
      const Index = Parent.index({
        hash: Schema.String,
        prepare: () => Effect.void
      })
      const App = Router.make("IndexHash", [Index])
      expect(Result.getOrThrow(Router.href(Index.to({ hash: "section" })))).toBe("/hashed#section")
      const app = App.layer.pipe(Layer.provide(MemoryHistory.layer("/hashed#section")))
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        if (presentation._tag !== "Resolved") throw new Error("Expected a resolved branch")
        const entry = presentation.entries.find((candidate) => candidate.id === "hashed.index")
        expect(entry === undefined ? undefined : Result.getOrThrow(entry.input)).toMatchObject({ hash: "section" })
      }).pipe(Effect.provide(app))
    })
  )

  it("resolves path destinations synchronously and rejects unknown paths", () => {
    const Home = Router.route("home", "/")
    const Item = Router.route("item", "/items/:id", { params: { id: Schema.FiniteFromString } })
    const App = Router.make("Nav", [Home, Item])
    const resolved = Router.resolvePathDestination(App, "/items/:id", { params: { id: 1 } })
    expect(Result.isSuccess(resolved)).toBe(true)
    if (Result.isSuccess(resolved)) {
      expect(Result.getOrThrow(Router.href(resolved.success))).toBe("/items/1")
    }
    expect(Result.isFailure(Router.resolvePathDestination(App, "/missing", {}))).toBe(true)
  })
})
