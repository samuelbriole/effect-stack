import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { MemoryHistory, Route, RouteGroup, Router } from "@effect-stack/router"

const ProjectId = Schema.FiniteFromString

const nodeOf = (contract: unknown, id: string): Router.RuntimeNode => {
  const node = Router.nodes(contract)[id]
  if (node === undefined) throw new Error(`missing node ${id}`)
  return node
}

const groupChildren = (contract: unknown, groupId: string): ReadonlyArray<string> => {
  const node = nodeOf(contract, groupId)
  if (node._tag !== "GroupDescriptor") throw new Error(`expected group ${groupId}`)
  return Object.keys((node as Router.RuntimeGroupNode).children)
}

describe("route and group declaration validation", () => {
  it("rejects malformed local paths", () => {
    expect(() => Route.make("x", "no-slash" as `/${string}`)).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("x", "/a/")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("x", "/a//b")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("x", "/a/../b")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("x", "/a/./b")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("x", "/a?b")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("x", "/a#b")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("x", "/:id/:id", { params: { id: Schema.String } })).toThrow(Router.RouteDefinitionError)
  })

  it("requires local params to match the local path", () => {
    expect(() => Route.make("x", "/:id")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("x", "/a", { params: { id: ProjectId } })).toThrow(Router.RouteDefinitionError)
  })

  it("rejects invalid identifiers", () => {
    expect(() => Route.make("", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("a.b", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("__proto__", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("constructor", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("toString", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("service", "/x")).toThrow(Router.RouteDefinitionError)
  })

  it("rejects duplicate and reserved siblings across chained additions", () => {
    expect(() => Router.make("A").add(Route.make("a", "/a"), Route.make("a", "/b"))).toThrow(
      Router.RouteDefinitionError
    )
    const chained = Router.make("A").add(Route.make("a", "/a"))
    expect(() => chained.add(Route.make("a", "/b"))).toThrow(Router.RouteDefinitionError)
    expect(() => Router.make("A").add(Route.make("pipe", "/p"))).toThrow(Router.RouteDefinitionError)
    // oxlint-disable-next-line typescript/unbound-method -- Negative fixture: calling `add` with no declarations is the assertion under test.
    const looseAdd = Router.make("A").add as unknown as (...declarations: ReadonlyArray<unknown>) => unknown
    expect(() => looseAdd()).toThrow(Router.RouteDefinitionError)
  })

  it("rejects inherited params and search redeclarations at binding", () => {
    const outer = RouteGroup.make("outer", { params: { projectId: ProjectId } }).prefix("/o/:projectId")
    const redeclaresParams = RouteGroup.make("inner", { params: { projectId: ProjectId } })
    expect(() => Router.make("A").add(outer.add(redeclaresParams))).toThrow(Router.RouteDefinitionError)

    const search = RouteGroup.make("searchOuter", { search: { tab: Schema.optionalKey(Schema.String) } })
    const redeclaresSearch = RouteGroup.make("searchInner", { search: { tab: Schema.optionalKey(Schema.String) } })
    expect(() => Router.make("A").add(search.add(redeclaresSearch))).toThrow(Router.RouteDefinitionError)
  })

  it("rejects an incomplete group before its descendants can repair it", () => {
    expect(() => RouteGroup.make("broken").prefix("/b/:id")).toThrow(Router.RouteDefinitionError)
  })

  it("applies persistent prefixes once, with repeat and identity semantics", () => {
    const Routes = Router.make("A").add(
      RouteGroup.make("g").add(Route.make("index", "/")).prefix("/projects").prefix("/admin"),
      RouteGroup.make("identity").add(Route.make("index", "/")).prefix("/identity").prefix("/")
    )
    expect(Routes.g.path).toBe("/admin/projects")
    expect(Routes.g.index.path).toBe("/admin/projects")
    expect(Routes.identity.path).toBe("/identity")
  })

  it("treats prefix before and after add as equivalent", () => {
    const before = Router.make("A").add(
      RouteGroup.make("g")
        .prefix("/g")
        .add(Route.make("index", "/"), Route.make("detail", "/:id", { params: { id: ProjectId } }))
    )
    const after = Router.make("A").add(
      RouteGroup.make("g")
        .add(Route.make("index", "/"), Route.make("detail", "/:id", { params: { id: ProjectId } }))
        .prefix("/g")
    )
    expect(before.g.path).toBe(after.g.path)
    expect(before.g.detail.path).toBe(after.g.detail.path)
    expect(before.g.detail.id).toBe(after.g.detail.id)
  })

  it("keeps leading slashes local and supports pathless groups", () => {
    const Routes = Router.make("A").add(
      RouteGroup.make("projects")
        .add(
          Route.make("index", "/"),
          Route.make("detail", "/:projectId", { params: { projectId: ProjectId } }),
          RouteGroup.make("settings").add(Route.make("index", "/settings"))
        )
        .prefix("/projects")
    )
    expect(Routes.projects.path).toBe("/projects")
    expect(Routes.projects.index.path).toBe("/projects")
    expect(Routes.projects.detail.path).toBe("/projects/:projectId")
    expect(Routes.projects.settings.path).toBe("/projects")
    expect(Routes.projects.settings.index.path).toBe("/projects/settings")
  })

  it("returns new immutable values without mutating sources", () => {
    const group = RouteGroup.make("g").add(Route.make("a", "/a"))
    const extendedGroup = group.add(Route.make("b", "/b"))
    const base = Router.make("A").add(group)
    const extended = Router.make("A").add(extendedGroup)
    expect(base).not.toBe(extended)
    expect(groupChildren(base, "g")).toEqual(["a"])
    expect(groupChildren(extended, "g")).toEqual(["a", "b"])
    expect((base as unknown as { b?: unknown }).b).toBeUndefined()
  })

  it("preserves canonical node identity when adding siblings", () => {
    const Base = Router.make("A").add(Route.make("a", "/a"))
    const Extended = Base.add(Route.make("b", "/b"))
    expect(Router.nodes(Extended).a).toBe(Router.nodes(Base).a)
    expect(Router.nodes(Extended).b).not.toBe(Router.nodes(Base).a)
  })

  it("binds reused declarations to distinct canonical nodes", () => {
    const shared = Route.make("shared", "/shared")
    const one = Router.make("One").add(shared)
    const two = Router.make("Two").add(shared)
    expect(one.shared.id).toBe("shared")
    expect(two.shared.id).toBe("shared")
    expect(Router.nodes(one).shared).not.toBe(Router.nodes(two).shared)
  })

  it("rejects indistinguishable effective leaf templates", () => {
    const one = RouteGroup.make("one")
      .add(Route.make("detail", "/:id", { params: { id: Schema.String } }))
      .prefix("/x")
    const two = RouteGroup.make("two")
      .add(Route.make("detail", "/:name", { params: { name: Schema.String } }))
      .prefix("/x")
    const Routes = Router.make("A").add(one, two)
    expect(() => Router.layer(Routes)).toThrow(Router.RouteDefinitionError)
  })

  it.effect("keeps group hash failures as typed branch decoding failures", () =>
    Effect.gen(function* () {
      const Routes = Router.make("Hash").add(
        RouteGroup.make("g", { hash: Schema.Literals(["ok"]) })
          .add(Route.make("child", "/child", { success: Schema.Void }))
          .prefix("/g")
      )
      const ChildLive = Router.route(Routes.g.child, () => Effect.void)
      const makeApp = (initial: string) =>
        Router.layer(Routes).pipe(Layer.provide(ChildLive), Layer.provide(MemoryHistory.layer(initial)))

      yield* Effect.gen(function* () {
        const router = yield* Routes.service
        yield* router.awaitInitial
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        expect(presentation._tag).toBe("Resolved")
      }).pipe(Effect.provide(makeApp("/g/child#ok")))

      yield* Effect.gen(function* () {
        const router = yield* Routes.service
        yield* router.awaitInitial.pipe(Effect.exit)
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        expect(presentation._tag).toBe("Failed")
        if (presentation._tag === "Failed") expect(presentation.owner).toBe("g")
      }).pipe(Effect.provide(makeApp("/g/child#nope")))
    })
  )

  it.effect("resolves nested group data before descendants", () =>
    Effect.gen(function* () {
      const Routes = Router.make("Order").add(
        RouteGroup.make("outer", { success: Schema.Struct({ label: Schema.String }) })
          .add(Route.make("child", "/child", { success: Schema.Struct({ value: Schema.String }) }))
          .prefix("/outer")
      )
      const order: Array<string> = []
      const OuterLive = Router.route(Routes.outer, () =>
        Effect.sync(() => {
          order.push("outer")
          return { label: "outer" }
        })
      )
      const ChildLive = Router.route(Routes.outer.child, () =>
        Effect.sync(() => {
          order.push("child")
          return { value: "child" }
        })
      )
      const app = Router.layer(Routes).pipe(
        Layer.provide(Layer.merge(OuterLive, ChildLive)),
        Layer.provide(MemoryHistory.layer("/outer/child"))
      )
      yield* Effect.gen(function* () {
        const router = yield* Routes.service
        yield* router.awaitInitial
        expect(order).toEqual(["outer", "child"])
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        const entries = presentation.entries
        expect(entries.map((entry) => entry.id)).toEqual(["outer", "outer.child"])
        const first = entries[0]
        expect(first === undefined ? undefined : AsyncResult.value(first.data)).toEqual(Option.some({ label: "outer" }))
      }).pipe(Effect.provide(app))
    })
  )

  it("rejects identifiers and collection ids that would collide in encoded keys", () => {
    expect(() => Router.make("A/impl/b")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.make("A.B")).toThrow(Router.RouteDefinitionError)
    expect(() => Router.make("")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("b/impl/c", "/x")).toThrow(Router.RouteDefinitionError)
    expect(() => Route.make("a/b", "/x")).toThrow(Router.RouteDefinitionError)
  })

  it("keeps implementation keys injective across collections", () => {
    const one = Router.make("A").add(Route.make("b", "/b", { success: Schema.Void }))
    const two = Router.make("AB").add(Route.make("c", "/c", { success: Schema.Void }))
    const oneKey = nodeOf(one, "b").implementationTag?.key
    const twoKey = nodeOf(two, "c").implementationTag?.key
    expect(oneKey).toBe("@effect-stack/router/A/impl/b")
    expect(twoKey).toBe("@effect-stack/router/AB/impl/c")
    expect(oneKey).not.toBe(twoKey)
  })

  it("does not materialize phantom schema props on bound leaves or groups", () => {
    const Routes = Router.make("Shape").add(
      Route.make("leaf", "/leaf/:id", { params: { id: Schema.String }, success: Schema.Void }),
      RouteGroup.make("group").add(Route.make("child", "/child")).prefix("/group")
    )
    const leaf = nodeOf(Routes, "leaf")
    expect(leaf.id).toBe("leaf")
    expect(leaf.path).toBe("/leaf/:id")
    expect(leaf._tag).toBe("RouteDescriptor")
    expect("params" in leaf).toBe(false)
    expect("search" in leaf).toBe(false)
    expect("hash" in leaf).toBe(false)
    expect("success" in leaf).toBe(false)
    expect("error" in leaf).toBe(false)
    const group = nodeOf(Routes, "group")
    expect(group._tag).toBe("GroupDescriptor")
    expect("params" in group).toBe(false)
    expect("success" in group).toBe(false)
    expect("children" in group).toBe(true)
  })

  it("does not execute codec transformations at declaration time", () => {
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
    const Routes = Router.make("Tracked").add(
      Route.make("tracked", "/tracked/:id", { params: { id: tracked }, success: Schema.Void })
    )
    expect(calls).toEqual([])
    const destination = Routes.tracked({ params: { id: "x" } })
    expect(Result.isSuccess(Router.href(destination))).toBe(true)
    expect(calls).toEqual(["encode"])
  })

  it.effect(
    "accepts a codec that is synchronous on one input and async on another, then fails typed at the boundary",
    () =>
      Effect.gen(function* () {
        const mixedCodec = Schema.String.pipe(
          Schema.decodeTo(Schema.String, {
            decode: SchemaGetter.transformEffect((value: string) =>
              value === "" ? Effect.succeed(value) : Effect.sleep("1 millis").pipe(Effect.as(value))
            ),
            encode: SchemaGetter.transformEffect((value: string) =>
              value === "" ? Effect.succeed(value) : Effect.sleep("1 millis").pipe(Effect.as(value))
            )
          })
        )
        const Routes = Router.make("Mixed").add(
          Route.make("mixed", "/mixed/:id", { params: { id: mixedCodec }, success: Schema.Void })
        )
        const MixedLive = Router.route(Routes.mixed, () => Effect.void)

        // A synchronous input still encodes and the declaration was accepted.
        const syncDestination = Routes.mixed({ params: { id: "" } })
        expect(Result.isSuccess(Router.href(syncDestination))).toBe(true)

        // An asynchronous input produces a typed encode failure, not a Fiber defect.
        const encoded = Router.href(Routes.mixed({ params: { id: "abc" } }))
        expect(Result.isFailure(encoded)).toBe(true)
        if (Result.isFailure(encoded)) expect(encoded.failure).toBeInstanceOf(Router.RouteEncodeError)

        // Decoding an asynchronous input produces a typed decode failure.
        const app = Router.layer(Routes).pipe(
          Layer.provide(MixedLive),
          Layer.provide(MemoryHistory.layer("/mixed/abc"))
        )
        yield* Effect.gen(function* () {
          const router = yield* Routes.service
          const error = yield* Effect.flip(router.awaitInitial)
          expect(error).toBeInstanceOf(Router.RouteDecodeError)
        }).pipe(Effect.provide(app))
      })
  )
})
