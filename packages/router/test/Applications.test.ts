import { describe, expect, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Result from "effect/Result"
import { MemoryHistory, Router } from "@effect-stack/router"

const Item = Router.route("item", "/items/:id", {
  params: { id: Schema.FiniteFromString },
  prepare: () => Effect.void
})

const assembly = Router.make("Shared", [Item])
const App1 = await Effect.runPromise(assembly)
const App2 = await Effect.runPromise(assembly)

const entryOf = (state: Router.RouterState<unknown>, id = "item") => {
  const presentation = Option.getOrThrow(state.presentation)
  if (presentation._tag === "Pending") throw new Error("expected a settled presentation")
  return presentation.entries.find((candidate) => candidate.id === id)
}

describe("one definition set, multiple applications", () => {
  it.effect.each([
    { id: 1, App: App1 },
    { id: 2, App: App2 }
  ])("application $id owns independent decoded branch input", ({ id, App }) =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.navigate(Item.to({ params: { id } }))
      const entry = entryOf(yield* router.state)
      expect(entry !== undefined && Result.getOrThrow(entry.input).params).toEqual({ id })
    }).pipe(Effect.provide(App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
  )

  it.effect("keeps service keys and tokens distinct across executions and application ids", () =>
    Effect.gen(function* () {
      expect(App1.service.key).not.toBe(App2.service.key)
      expect(App1.token).not.toBe(App2.token)
      const Other = yield* Router.make("SharedAgain", [Item])
      expect(App1.service.key).toContain("@effect-stack/router/Shared/service")
      expect(Other.service.key).toContain("@effect-stack/router/SharedAgain/service")
      expect(Other.service.key).not.toBe(App1.service.key)
      expect(Other.token).not.toBe(App1.token)
    })
  )

  it.effect("a supplied service Layer failure is a startup failure, not a navigation error", () =>
    Effect.gen(function* () {
      class Startup extends Schema.TaggedError<Startup>()("Startup", {}) {}
      class Dep extends Context.Service<Dep, {}>()("test/ApplicationStartup") {}
      const dependency = Layer.effect(Dep, Effect.fail(new Startup()))
      const FactoryItem = Router.route("item", "/items/:id", {
        params: { id: Schema.FiniteFromString },
        prepare: () => Effect.asVoid(Dep)
      })
      const App = yield* Router.make("Factory", [FactoryItem])
      const exit = yield* Effect.exit(
        App.service.pipe(
          Effect.provide(App.layer.pipe(Layer.provide(MemoryHistory.layer("/")), Layer.provide(dependency)))
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
    })
  )

  it.effect("a direct gate requirement is supplied by the application Layer", () =>
    Effect.gen(function* () {
      class Dep extends Context.Service<Dep, { readonly n: number }>()("test/ApplicationsDep") {}
      const DepItem = Router.route("item", "/items/:id", {
        params: { id: Schema.FiniteFromString },
        prepare: ({ params }) =>
          Effect.map(Dep, (dep) => {
            expect(params.id + dep.n).toBe(6)
          })
      })
      const App = yield* Router.make("Dep", [DepItem])
      const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")), Layer.provide(Layer.succeed(Dep, { n: 1 })))
      return yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.navigate(DepItem.to({ params: { id: 5 } }))
        const entry = entryOf(yield* router.state)
        expect(entry !== undefined && Result.getOrThrow(entry.input).params).toEqual({ id: 5 })
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect("an unselected definition is absent and imposes no requirements", () =>
    Effect.gen(function* () {
      class Dep extends Context.Service<Dep, { readonly n: number }>()("test/UnselectedDep") {}
      const Selected = Router.route("selected", "/selected", { prepare: () => Effect.void })
      const Unselected = Router.route("unselected", "/unselected", {
        prepare: () => Effect.asVoid(Dep)
      })
      const App = yield* Router.make("Partial", [Selected])
      // The unselected definition is not part of this application.
      void Unselected
      const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))
      return yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.navigate(Selected.to())
        const entry = entryOf(yield* router.state, "selected")
        expect(entry !== undefined && Result.getOrThrow(entry.input).params).toEqual({})
      }).pipe(Effect.provide(layer))
    })
  )

  it("rejects untrusted definitions and spread copies", () => {
    for (const definitions of [[{}], [{ ...Item }]]) {
      expect(Effect.runSyncExit(Router.make("App", definitions as never))).toMatchObject({
        _tag: "Failure",
        cause: { reasons: [{ _tag: "Die", defect: expect.any(Router.RouteDefinitionError) as unknown }] }
      })
    }
  })

  it.effect("keeps the trusted definition after a rejected copy", () =>
    Effect.gen(function* () {
      expect(yield* Effect.exit(Router.make("App", [{ ...Item }] as never))).toMatchObject({
        _tag: "Failure",
        cause: { reasons: [{ _tag: "Die", defect: expect.any(Router.RouteDefinitionError) as unknown }] }
      })
      const App = yield* Router.make("App", [Item])
      const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))
      return yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.navigate(Item.to({ params: { id: 1 } }))
        const entry = entryOf(yield* router.state)
        expect(entry !== undefined && Result.getOrThrow(entry.input).params).toEqual({ id: 1 })
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect("freezes definitions and binds the trusted routes", () =>
    Effect.gen(function* () {
      const Other = Router.route("other", "/other")
      expect(() => Object.assign(Item, { id: Other.id })).toThrow()
      const App = yield* Router.make("Shared", [Item])
      expect(App.appId).toBe("Shared")
      expect(App.routes).toEqual([Item])
    })
  )
})
