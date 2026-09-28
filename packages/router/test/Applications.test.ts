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

const App1 = Router.make("Shared", [Item])
const App2 = Router.make("Shared", [Item])

const entryOf = (state: Router.RouterState<unknown>) => {
  const presentation = Option.getOrThrow(state.presentation)
  if (presentation._tag === "Pending") throw new Error("expected a settled presentation")
  return presentation.entries.find((candidate) => candidate.id === "item")
}

describe("one definition set, multiple applications", () => {
  it.effect("each application owns independent decoded branch input", () =>
    Effect.gen(function* () {
      const first = yield* App1.service
      yield* first.navigate(Item.to({ params: { id: 1 } }))
      const firstEntry = entryOf(yield* first.state)
      expect(firstEntry !== undefined && Result.getOrThrow(firstEntry.input).params).toEqual({ id: 1 })
    }).pipe(Effect.provide(App1.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
  )

  it.effect("a second application over the same definition has an independent runtime", () =>
    Effect.gen(function* () {
      const second = yield* App2.service
      yield* second.navigate(Item.to({ params: { id: 2 } }))
      const secondEntry = entryOf(yield* second.state)
      expect(secondEntry !== undefined && Result.getOrThrow(secondEntry.input).params).toEqual({ id: 2 })
    }).pipe(Effect.provide(App2.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
  )

  it("gives every finalized application a distinct service key", () => {
    expect(App1.service.key).not.toBe(App2.service.key)
    const Again = Router.make("Shared", [Item])
    expect(Again.service.key).not.toBe(App1.service.key)
  })

  it.effect("a supplied service Layer failure is a startup failure, not a navigation error", () =>
    Effect.gen(function* () {
      class Startup extends Schema.TaggedError<Startup>()("Startup", {}) {}
      class Dep extends Context.Service<Dep, {}>()("test/ApplicationStartup") {}
      const dependency = Layer.effect(Dep, Effect.fail(new Startup()))
      const FactoryItem = Router.route("item", "/items/:id", {
        params: { id: Schema.FiniteFromString },
        prepare: () => Effect.asVoid(Dep)
      })
      const App = Router.make("Factory", [FactoryItem])
      const exit = yield* Effect.exit(
        App.service.pipe(
          Effect.provide(App.layer.pipe(Layer.provide(MemoryHistory.layer("/")), Layer.provide(dependency)))
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
    })
  )

  it.effect("a direct gate requirement is supplied by the application Layer", () => {
    class Dep extends Context.Service<Dep, { readonly n: number }>()("test/ApplicationsDep") {}
    const DepItem = Router.route("item", "/items/:id", {
      params: { id: Schema.FiniteFromString },
      prepare: ({ params }) =>
        Effect.map(Dep, (dep) => {
          expect(params.id + dep.n).toBe(6)
        })
    })
    const App = Router.make("Dep", [DepItem])
    const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")), Layer.provide(Layer.succeed(Dep, { n: 1 })))
    return Effect.gen(function* () {
      const router = yield* App.service
      yield* router.navigate(DepItem.to({ params: { id: 5 } }))
      const entry = entryOf(yield* router.state)
      expect(entry !== undefined && Result.getOrThrow(entry.input).params).toEqual({ id: 5 })
    }).pipe(Effect.provide(layer))
  })

  it.effect("an unselected definition is absent and imposes no requirements", () => {
    class Dep extends Context.Service<Dep, { readonly n: number }>()("test/UnselectedDep") {}
    const Selected = Router.route("selected", "/selected", { prepare: () => Effect.void })
    const Unselected = Router.route("unselected", "/unselected", {
      prepare: () => Effect.asVoid(Dep)
    })
    const App = Router.make("Partial", [Selected])
    // The unselected definition is not part of this application.
    void Unselected
    const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))
    return Effect.gen(function* () {
      const router = yield* App.service
      yield* router.navigate(Selected.to())
      const entry = entryOf2(yield* router.state, "selected")
      expect(entry !== undefined && Result.getOrThrow(entry.input).params).toEqual({})
    }).pipe(Effect.provide(layer))
  })

  it("rejects untrusted definitions and spread copies", () => {
    const loose = Router.make as unknown as (appId: string, definitions: ReadonlyArray<unknown>) => unknown
    expect(() => loose("App", [{}])).toThrow(Router.RouteDefinitionError)
    expect(() => loose("App", [{ ...Item }])).toThrow(Router.RouteDefinitionError)
  })

  it.effect("keeps the trusted definition after a rejected copy", () => {
    expect(() => Router.make("App", [{ ...Item }] as never)).toThrow(Router.RouteDefinitionError)
    const App = Router.make("App", [Item])
    const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))
    return Effect.gen(function* () {
      const router = yield* App.service
      yield* router.navigate(Item.to({ params: { id: 1 } }))
      const entry = entryOf(yield* router.state)
      expect(entry !== undefined && Result.getOrThrow(entry.input).params).toEqual({ id: 1 })
    }).pipe(Effect.provide(layer))
  })

  it("freezes definitions and binds the trusted routes", () => {
    const Other = Router.route("other", "/other")
    expect(() => Object.assign(Item, { id: Other.id })).toThrow()
    const App = Router.make("Shared", [Item])
    expect(App.appId).toBe("Shared")
    expect(App.routes).toEqual([Item])
  })
})

const entryOf2 = (state: Router.RouterState<unknown>, id: string) => {
  const presentation = Option.getOrThrow(state.presentation)
  if (presentation._tag === "Pending") throw new Error("expected a settled presentation")
  return presentation.entries.find((candidate) => candidate.id === id)
}
