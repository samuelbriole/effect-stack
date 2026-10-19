import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import { MemoryHistory, Router } from "@effect-stack/router"

const Item = Router.route("item", "/items/:id", {
  params: { id: Schema.String },
  search: { q: Schema.optionalKey(Schema.String) },
  hash: Schema.String,
  prepare: () => Effect.void
})

const App = await Effect.runPromise(Router.make("Url", [Item]))
const makeApp = (initial: string) => App.layer.pipe(Layer.provide(MemoryHistory.layer(initial)))

const TwoSegments = Router.route("two", "/:first/:second", {
  params: { first: Schema.String, second: Schema.String }
})
const TwoHome = Router.route("twoHome", "/")
const TwoApp = await Effect.runPromise(Router.make("Two", [TwoHome, TwoSegments]))
const RequiredHash = Router.route("hashReq", "/hash-req", { hash: Schema.String })
const OptionalHash = Router.route("hashOpt", "/hash-opt", { hash: Schema.optional(Schema.String) })
const EmptyingHash = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value),
    encode: SchemaGetter.transform(() => "")
  })
)
const TransformHash = Router.route("hashTransform", "/hash-transform", { hash: EmptyingHash })
const HashHome = Router.route("hashHome", "/")
const HashApp = await Effect.runPromise(Router.make("Hash", [HashHome, RequiredHash, OptionalHash]))

describe("URL definitions", () => {
  it.effect("round-trips query arrays and rejects ambiguous or empty arrays", () =>
    Effect.gen(function* () {
      for (const codec of [Schema.Array(Schema.String), Schema.Union([Schema.String, Schema.Array(Schema.String)])]) {
        const observed: Array<unknown> = []
        const Query = Router.route("query", "/query", {
          search: { q: codec },
          prepare: ({ search }) =>
            Effect.sync(() => {
              observed.push(search.q)
            })
        })
        const QueryApp = yield* Router.make("Query", [Query])
        yield* Effect.gen(function* () {
          const router = yield* QueryApp.service
          yield* router.awaitInitial
          expect(observed.at(-1)).toEqual(Schema.is(codec)("a") ? "a" : ["a"])
          for (const q of [["a", "b"], ["a"], []]) {
            const destination = Query.to({ search: { q } })
            if (q.length === 0 || (q.length === 1 && Schema.is(codec)("a"))) {
              expect(Result.getFailure(Router.href(destination))).toEqual(
                Option.some(expect.any(Router.RouteEncodeError))
              )
            } else {
              expect(Result.getOrThrow(Router.href(destination))).toBe(
                `/query?${q.map((value) => `q=${value}`).join("&")}`
              )
              yield* router.navigate(destination)
              expect(observed.at(-1)).toEqual(q)
            }
          }
        }).pipe(Effect.provide(QueryApp.layer.pipe(Layer.provide(MemoryHistory.layer("/query?q=a")))))
      }
    })
  )

  it("reports invalid Unicode in every encoded URL section", () => {
    for (const [part, destination] of [
      ["path", Item.to({ params: { id: "\ud800" }, hash: "ok" })],
      ["search", Item.to({ params: { id: "ok" }, search: { q: "\ud800" }, hash: "ok" })],
      ["hash", Item.to({ params: { id: "ok" }, hash: "\ud800" })]
    ] as const) {
      expect(Result.getFailure(Router.href(destination))).toEqual(
        Option.some(expect.objectContaining({ _tag: "@effect-stack/router/RouteEncodeError", part }))
      )
    }
  })

  it.effect("propagates unrelated codec defects on encode and query scalar probes", () =>
    Effect.gen(function* () {
      const defect = new Error("codec defect")
      const broken = Schema.String.pipe(
        Schema.decodeTo(Schema.String, {
          decode: SchemaGetter.transformEffect(() => Effect.die(defect)),
          encode: SchemaGetter.transformEffect(() => Effect.die(defect))
        })
      )
      const Broken = Router.route("broken", "/broken", { search: { q: broken } })
      const { error: thrown } = yield* Effect.flip(
        Effect.try({
          try: () => Router.href(Broken.to({ search: { q: "ok" } })),
          catch: (error) => ({ error })
        })
      )
      expect(
        thrown instanceof Error
          && Cause.isCause(thrown.cause)
          && thrown.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === defect)
      ).toBe(true)
      const BrokenApp = yield* Router.make("Broken", [Broken])
      yield* Effect.gen(function* () {
        const router = yield* BrokenApp.service
        const cause = yield* Effect.flip(Effect.sandbox(router.awaitInitial))
        expect(Cause.pretty(cause)).toContain("codec defect")
        expect(cause.reasons.every(Cause.isDieReason)).toBe(true)
      }).pipe(Effect.provide(BrokenApp.layer.pipe(Layer.provide(MemoryHistory.layer("/broken?q=ok")))))
    })
  )

  it.effect(
    "inherits transformed branded hashes through nested layouts and index, including gate and displayed inputs",
    () =>
      Effect.gen(function* () {
        const Hash = Schema.FiniteFromString.pipe(Schema.brand("Hash"))
        const value = yield* Schema.decodeUnknownEffect(Hash)("7")
        const observed: Array<typeof Hash.Type> = []
        const Parent = Router.layout("parent", "/parent", {
          hash: Hash,
          prepare: ({ hash }) =>
            Effect.sync(() => {
              observed.push(hash)
            })
        })
        const Nested = Parent.layout("nested", "/nested", {
          prepare: ({ hash }) =>
            Effect.sync(() => {
              observed.push(hash)
            })
        })
        const Child = Nested.route("child", "/child", {
          prepare: ({ hash }) =>
            Effect.sync(() => {
              observed.push(hash)
            })
        })
        const Index = Nested.index({
          prepare: ({ hash }) =>
            Effect.sync(() => {
              observed.push(hash)
            })
        })
        const Home = Router.route("home", "/")
        const InheritedApp = yield* Router.make("InheritedHash", [Home, Child, Index])
        expect(Result.getOrThrow(Router.href(Child.to({ hash: value })))).toBe("/parent/nested/child#7")
        expect(Result.getOrThrow(Router.href(Index.to({ hash: value })))).toBe("/parent/nested#7")
        yield* Effect.gen(function* () {
          const router = yield* InheritedApp.service
          yield* router.awaitInitial
          for (const destination of [Child.to({ hash: value }), Index.to({ hash: value })]) {
            expect(yield* router.navigate(destination)).toBe("Committed")
            const presentation = Option.getOrThrow((yield* router.state).presentation)
            expect(presentation._tag).toBe("Resolved")
            if (presentation._tag !== "Resolved") throw new Error("Expected a resolved branch")
            expect(presentation.entries.map((entry) => Result.getOrThrow(entry.input).hash)).toEqual([7, 7, 7])
          }
          expect(observed).toEqual([7, 7, 7, 7, 7, 7])
          const before = Option.getOrThrow((yield* router.state).location)
          for (const node of [Child, Index]) {
            // @ts-expect-error exercise missing required input from untyped callers
            const invalid = node.to({})
            expect(yield* Effect.flip(router.navigate(invalid))).toBeInstanceOf(Router.RouteEncodeError)
            expect(Option.getOrThrow((yield* router.state).location).key).toBe(before.key)
          }
        }).pipe(Effect.provide(InheritedApp.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
      })
  )

  it.effect("child hash overrides decode independently without bypassing ancestor validation", () =>
    Effect.gen(function* () {
      const observed: Array<unknown> = []
      const Parent = Router.layout("parent", "/parent", {
        hash: Schema.FiniteFromString,
        prepare: ({ hash }) =>
          Effect.sync(() => {
            observed.push(hash)
          })
      })
      const Child = Parent.route("child", "/child", {
        hash: Schema.String,
        prepare: ({ hash }) =>
          Effect.sync(() => {
            observed.push(hash)
          })
      })
      const Index = Parent.index({
        hash: Schema.String,
        prepare: ({ hash }) =>
          Effect.sync(() => {
            observed.push(hash)
          })
      })
      const OverrideApp = yield* Router.make("OverrideHash", [Child, Index])
      expect(Result.getOrThrow(Router.href(Child.to({ hash: "7" })))).toBe("/parent/child#7")
      yield* Effect.gen(function* () {
        const router = yield* OverrideApp.service
        yield* router.awaitInitial
        expect(observed).toEqual([7, "7"])
        yield* router.navigate(Index.to({ hash: "8" }))
        expect(observed).toEqual([7, "7", 8, "8"])
        const error = yield* Effect.flip(router.navigate(Child.to({ hash: "not-a-number" })))
        expect(error).toBeInstanceOf(Router.RouteDecodeError)
        const presentation = Option.getOrThrow((yield* router.state).presentation)
        expect(presentation._tag).toBe("Failed")
        if (presentation._tag === "Failed") expect(presentation.owner).toBe("parent")
        expect(observed).toEqual([7, "7", 8, "8"])
      }).pipe(Effect.provide(OverrideApp.layer.pipe(Layer.provide(MemoryHistory.layer("/parent/child#7")))))
    })
  )

  it.effect("inherited required hash rejects a fragment-less initial URL", () => {
    return Effect.gen(function* () {
      const Parent = Router.layout("parent", "/parent", { hash: Schema.String })
      const Child = Parent.route("child", "/child")
      const MissingApp = yield* Router.make("MissingInheritedHash", [Child])
      yield* Effect.gen(function* () {
        const router = yield* MissingApp.service
        expect(yield* Effect.flip(router.awaitInitial)).toBeInstanceOf(Router.RouteDecodeError)
      }).pipe(Effect.provide(MissingApp.layer.pipe(Layer.provide(MemoryHistory.layer("/parent/child")))))
    })
  })

  it.effect("round-trips unicode params, search, and hash", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      const destination = Item.to({
        params: { id: "héllo wörld/🎉" },
        search: { q: "a+b c" },
        hash: "section"
      })
      const href = Result.getOrThrow(Router.href(destination))
      yield* router.navigate(destination)
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      if (presentation._tag !== "Resolved") throw new Error("Expected a resolved branch")
      const entry = presentation.entries.find((candidate) => candidate.id === "item")
      expect(entry).toBeDefined()
      expect(entry === undefined ? undefined : Result.getOrThrow(entry.input)).toMatchObject({
        params: { id: "héllo wörld/🎉" },
        search: { q: "a+b c" },
        hash: "section"
      })
      expect(href).toContain("/items/")
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("reports malformed percent-encoding without failing the Layer", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial.pipe(Effect.exit)
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      expect(presentation._tag).toBe("Failed")
    }).pipe(Effect.provide(makeApp("/items/%E0%A4%A")))
  )

  it("rejects an empty encoded path parameter and never emits a protocol-relative href", () => {
    const failure = Router.href(TwoSegments.to({ params: { first: "", second: "example.org" } }))
    expect(Result.isFailure(failure)).toBe(true)
    if (Result.isFailure(failure)) expect(failure.failure).toBeInstanceOf(Router.RouteEncodeError)
    const resolved = Router.resolvePathDestination(TwoApp, "/:first/:second", {
      params: { first: "", second: "example.org" }
    })
    // The path resolves to the canonical node, but its href cannot be encoded.
    expect(Result.isSuccess(resolved)).toBe(true)
    if (Result.isSuccess(resolved)) expect(Result.isFailure(Router.href(resolved.success))).toBe(true)
    // The canonical two-segment value stays an internal path with one leading slash.
    expect(Result.getOrThrow(Router.href(TwoSegments.to({ params: { first: "a", second: "b" } })))).toBe("/a/b")
  })

  it.effect("fails an empty path segment before writing history", () =>
    Effect.gen(function* () {
      const router = yield* TwoApp.service
      yield* router.awaitInitial
      const before = Option.getOrThrow((yield* router.state).location)
      const error = yield* Effect.flip(
        router.navigate(TwoSegments.to({ params: { first: "", second: "example.org" } }))
      )
      expect(error).toBeInstanceOf(Router.RouteEncodeError)
      const after = Option.getOrThrow((yield* router.state).location)
      expect(after.key).toBe(before.key)
      expect(after.pathname).toBe("/")
    }).pipe(Effect.provide(TwoApp.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
  )

  it("requires a declared hash on encode and accepts an optional hash absence", () => {
    const missing = Router.href(RequiredHash.to({} as never))
    expect(Result.isFailure(missing)).toBe(true)
    if (Result.isFailure(missing)) {
      expect(missing.failure).toBeInstanceOf(Router.RouteEncodeError)
      expect(missing.failure.message).not.toContain("undefined")
    }
    expect(Result.getOrThrow(Router.href(RequiredHash.to({ hash: "ok" })))).toBe("/hash-req#ok")
    expect(Result.getOrThrow(Router.href(OptionalHash.to({ hash: undefined })))).toBe("/hash-opt")
  })

  it.effect("fails a missing required hash before writing history", () =>
    Effect.gen(function* () {
      const router = yield* HashApp.service
      yield* router.awaitInitial
      const before = Option.getOrThrow((yield* router.state).location)
      const error = yield* Effect.flip(router.navigate(RequiredHash.to({} as never)))
      expect(error).toBeInstanceOf(Router.RouteEncodeError)
      const after = Option.getOrThrow((yield* router.state).location)
      expect(after.key).toBe(before.key)
    }).pipe(Effect.provide(HashApp.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
  )

  it.effect("a required hash schema rejects a URL without a fragment", () =>
    Effect.gen(function* () {
      const router = yield* HashApp.service
      const error = yield* Effect.flip(router.awaitInitial)
      expect(error).toBeInstanceOf(Router.RouteDecodeError)
    }).pipe(Effect.provide(HashApp.layer.pipe(Layer.provide(MemoryHistory.layer("/hash-req")))))
  )

  it("rejects an empty encoded hash instead of silently dropping the fragment", () => {
    for (const destination of [
      RequiredHash.to({ hash: "" }),
      OptionalHash.to({ hash: "" }),
      TransformHash.to({ hash: "value" })
    ]) {
      expect(Result.getFailure(Router.href(destination))).toEqual(Option.some(expect.any(Router.RouteEncodeError)))
    }
    expect(Result.getOrThrow(Router.href(OptionalHash.to({ hash: undefined })))).toBe("/hash-opt")
  })

  it.effect("fails an empty required hash before writing history", () =>
    Effect.gen(function* () {
      const router = yield* HashApp.service
      yield* router.awaitInitial
      const before = Option.getOrThrow((yield* router.state).location)
      const error = yield* Effect.flip(router.navigate(RequiredHash.to({ hash: "" })))
      expect(error).toBeInstanceOf(Router.RouteEncodeError)
      const after = Option.getOrThrow((yield* router.state).location)
      expect(after.key).toBe(before.key)
    }).pipe(Effect.provide(HashApp.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
  )
})
