import { describe, expect, test } from "tstyche"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"
import type * as AsyncResult from "effect/reactivity/AsyncResult"
import { AtomRouter, type History, MemoryHistory, Router } from "@effect-stack/router"

describe("router command factories", () => {
  const Page = Router.route("page", "/pages/:id", { params: { id: Schema.FiniteFromString } })
  const App = Effect.runSync(Router.make("ActionTypes", [Page]))
  const atoms = AtomRouter.make(
    Atom.runtime(Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/pages/1")))),
    App
  )
  test("preserves destinations, options, and independent read-only results", () => {
    expect(atoms.navigate).type.toBeCallableWith(Page.to({ params: { id: 1 } }))
    expect(atoms.navigate).type.toBeCallableWith(Page.to({ params: { id: 1 } }), { replace: true, state: "payload" })
    expect(atoms.navigate).type.not.toBeCallableWith({ to: "/pages/:id" })
    expect(atoms.navigate).type.not.toBeCallableWith(Page.to({ params: { id: 1 } }), { replace: "yes" })
    expect(atoms.navigate(Page.to({ params: { id: 1 } }))).type.toBe<
      Atom.Atom<AsyncResult.AsyncResult<Router.NavigationOutcome, Router.NavigationError<never>>>
    >()
    expect(atoms.retry()).type.toBe<
      Atom.Atom<AsyncResult.AsyncResult<Router.NavigationOutcome, Router.NavigationError<never>>>
    >()
    expect(atoms.retry).type.not.toBeCallableWith("argument")
  })

  test("mounting requires the acquired bundle, not its dynamic key", () => {
    const live = Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer()))
    expect<Layer.Success<typeof live>>().type.toBe<Router.RuntimeApplication>()
    expect<Layer.Error<typeof live>>().type.toBe<History.HistoryError>()
    expect<Layer.Services<typeof live>>().type.toBe<never>()
    const runtime = Atom.runtime(live)
    const selected = AtomRouter.make(runtime, App)
    expect(selected.navigate(Page.to({ params: { id: 1 } }))).type.toBe<
      Atom.Atom<AsyncResult.AsyncResult<Router.NavigationOutcome, Router.NavigationError<never>>>
    >()
    expect(AtomRouter.make).type.not.toBeCallableWith(
      Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer()))),
      App
    )
    expect(AtomRouter.make).type.not.toBeCallableWith(Atom.runtime(Layer.empty), App)
  })

  test("preserves gate and runtime startup failures in both action factories", () => {
    class Dep extends Context.Service<Dep, {}>()("type/ActionDep") {}
    class GateError extends Schema.TaggedError<GateError>()("ActionGateError", {}) {}
    class StartupError extends Schema.TaggedError<StartupError>()("ActionStartupError", {}) {}
    const Guarded = Router.route("guarded", "/guarded", {
      prepare: () => Dep.pipe(Effect.andThen(Effect.fail(new GateError())))
    })
    const GuardedApp = Effect.runSync(Router.make("GuardedActions", [Guarded]))
    const assembly = Effect.succeed(GuardedApp)
    const applicationLayer = Router.layer(assembly)
    expect<Layer.Services<typeof applicationLayer>>().type.toBe<Dep | History.History>()
    expect<Layer.Error<typeof applicationLayer>>().type.toBe<History.HistoryError>()
    const runtime = Atom.runtime(
      applicationLayer.pipe(
        Layer.provide(Layer.effect(Dep, Effect.fail(new StartupError()))),
        Layer.provide(MemoryHistory.layer())
      )
    )
    const guarded = AtomRouter.make(runtime, GuardedApp)
    expect(guarded).type.toBe<AtomRouter.AtomRouter<typeof GuardedApp, History.HistoryError | StartupError>>()
    expect(guarded.navigate(Guarded.to())).type.toBe<
      Atom.Atom<AsyncResult.AsyncResult<Router.NavigationOutcome, Router.NavigationError<GateError> | StartupError>>
    >()
    expect(guarded.retry()).type.toBe<
      Atom.Atom<AsyncResult.AsyncResult<Router.NavigationOutcome, Router.NavigationError<GateError> | StartupError>>
    >()
    const fallibleAssembly = Effect.fail(new StartupError()) as Effect.Effect<typeof GuardedApp, StartupError>
    const fallibleLayer = Router.layer(fallibleAssembly)
    expect<Layer.Error<typeof fallibleLayer>>().type.toBe<StartupError | History.HistoryError>()
    const erased: AtomRouter.AtomRouter<typeof GuardedApp> = guarded
    expect(erased.retry()).type.toBe<Atom.Atom<AsyncResult.AsyncResult<Router.NavigationOutcome, unknown>>>()
  })

  test("retains unknown failures for explicitly erased gates", () => {
    const Unknown = Router.route("unknown", "/unknown", {
      prepare: (): Effect.Effect<void, unknown> => Effect.void
    })
    const UnknownApp = Effect.runSync(Router.make("UnknownActions", [Unknown]))
    const unknown = AtomRouter.make(
      Atom.runtime(Router.layer(Effect.succeed(UnknownApp)).pipe(Layer.provide(MemoryHistory.layer()))),
      UnknownApp
    )
    expect(unknown.navigate(Unknown.to())).type.toBe<
      Atom.Atom<AsyncResult.AsyncResult<Router.NavigationOutcome, unknown>>
    >()
    expect(unknown.retry()).type.toBe<Atom.Atom<AsyncResult.AsyncResult<Router.NavigationOutcome, unknown>>>()
  })
})
