import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { AtomRouter, History, MemoryHistory, Router } from "@effect-stack/router"

const makeRegistry = Effect.acquireRelease(
  Effect.sync(() => AtomRegistry.make()),
  (registry) => Effect.sync(() => registry.dispose())
)

describe("runtime-owned router actions", () => {
  it.live("acquires one scoped application and routes through its bundle without a dynamic key", () =>
    Effect.gen(function* () {
      let assemblies = 0
      let acquisitions = 0
      const closed = yield* Deferred.make<void>()
      class Dep extends Context.Service<Dep, {}>()("test/SelectedBundleDependency") {}
      const dependency = Layer.effect(
        Dep,
        Effect.acquireRelease(
          Effect.sync(() => {
            acquisitions++
            return {}
          }),
          () => Deferred.succeed(closed, undefined)
        )
      )
      const Home = Router.route("home", "/", { prepare: () => Effect.asVoid(Dep) })
      const assembly = Router.make("SelectedBundle", [Home]).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            assemblies++
          })
        )
      )
      const live = Router.layer(assembly).pipe(Layer.provide(Layer.merge(dependency, MemoryHistory.layer("/"))))
      const runtime = Atom.runtime(live)
      const selection = runtime.atom(Router.RuntimeApplication)
      expect(assemblies).toBe(0)
      expect(acquisitions).toBe(0)
      const registry = yield* makeRegistry
      yield* AtomRegistry.mount(registry, selection)
      const selected = yield* AtomRegistry.getResult(registry, selection)
      const context = yield* AtomRegistry.getResult(registry, runtime)
      expect(Context.getOption(context, selected.app.service)._tag).toBe("None")
      const atoms = AtomRouter.make(runtime, selected.app)
      expect(yield* AtomRegistry.getResult(registry, atoms.service)).toBe(selected.router)
      expect(yield* AtomRegistry.getResult(registry, atoms.navigate(Home.to()))).toBe("Committed")
      expect(assemblies).toBe(1)
      expect(acquisitions).toBe(1)
      registry.dispose()
      yield* Deferred.await(closed)
    })
  )

  it.effect("rejects copied application witnesses when building a runtime Layer", () =>
    Effect.gen(function* () {
      const App = yield* Router.make("UntrustedLayer", [Router.route("home", "/")])
      const exit = yield* Effect.exit(
        Layer.build(Router.layer(Effect.succeed({ ...App })).pipe(Layer.provide(MemoryHistory.layer("/"))))
      )
      expect(exit).toMatchObject({
        _tag: "Failure",
        cause: { reasons: [{ _tag: "Die", defect: expect.any(Router.RouteDefinitionError) as unknown }] }
      })
    })
  )

  it.effect("rejects copied application witnesses when constructing atoms", () =>
    Effect.gen(function* () {
      const App = yield* Router.make("UntrustedAtoms", [Router.route("home", "/")])
      const runtime = Atom.runtime(Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/"))))
      expect(() => AtomRouter.make(runtime, { ...App })).toThrow(Router.RouteDefinitionError)
    })
  )

  it.live("marks the service as waiting while runtime acquisition retains a previous success", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const App = yield* Router.make("WaitingService", [Router.route("home", "/")])
      let acquisitions = 0
      const assembly = Effect.suspend(() =>
        ++acquisitions === 1
          ? Effect.succeed(App)
          : Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
      )
      const runtime = Atom.runtime(Router.layer(assembly).pipe(Layer.provide(MemoryHistory.layer("/"))))
      const atoms = AtomRouter.make(runtime, App)
      const registry = yield* makeRegistry
      yield* AtomRegistry.mount(registry, atoms.service)
      const original = yield* AtomRegistry.getResult(registry, atoms.service)
      registry.refresh(runtime)
      yield* Deferred.await(started)
      expect(registry.get(runtime)).toMatchObject({ _tag: "Success", waiting: true })
      expect(registry.get(atoms.service)).toMatchObject({ _tag: "Success", waiting: true, value: original })
    })
  )

  it.live("executes commands with the supplied runtime context", () =>
    Effect.gen(function* () {
      const marker = Context.Reference("test/CommandContext", { defaultValue: () => "outside" })
      let observed = ""
      const historyLayer = Layer.effect(
        History.History,
        Effect.gen(function* () {
          const history = yield* MemoryHistory.make("/")
          return {
            ...history,
            push: (destination: History.Destination) =>
              Effect.flatMap(marker, (value) => {
                observed = value
                return history.push(destination)
              })
          }
        })
      )
      const Home = Router.route("home", "/")
      const App = yield* Router.make("Context", [Home])
      const runtime = Atom.runtime(
        Router.layer(Effect.succeed(App)).pipe(
          Layer.provide(historyLayer),
          Layer.provideMerge(Layer.succeed(marker, "runtime"))
        )
      )
      const atoms = AtomRouter.make(runtime, App)
      const registry = yield* makeRegistry
      expect(yield* AtomRegistry.getResult(registry, atoms.navigate(Home.to()))).toBe("Committed")
      expect(observed).toBe("runtime")
    })
  )

  it.live("does not replay an accepted navigation when its runtime is refreshed", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const history = yield* MemoryHistory.make("/")
      let pushes = 0
      const Home = Router.route("home", "/", { prepare: () => Effect.void })
      const Slow = Router.route("slow", "/slow", {
        prepare: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      const App = yield* Router.make("RefreshAction", [Home, Slow])
      const runtime = Atom.runtime(
        Router.layer(Effect.succeed(App)).pipe(
          Layer.provide(
            Layer.succeed(History.History, {
              ...history,
              push: (destination) =>
                Effect.sync(() => {
                  pushes++
                }).pipe(Effect.andThen(history.push(destination)))
            })
          )
        )
      )
      const atoms = AtomRouter.make(runtime, App)
      const registry = yield* makeRegistry
      yield* AtomRegistry.mount(registry, atoms.service)
      const original = yield* AtomRegistry.getResult(registry, atoms.service)
      const action = atoms.navigate(Slow.to())
      yield* AtomRegistry.mount(registry, action)
      const result = yield* AtomRegistry.getResult(registry, action).pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      expect(pushes).toBe(1)
      registry.refresh(runtime)
      const refreshed = yield* AtomRegistry.getResult(registry, atoms.service, { suspendOnWaiting: true })
      expect(refreshed).not.toBe(original)
      expect(pushes).toBe(1)
      // Refresh closes the original router scope; its waiter still owns that attempt's outcome.
      expect(yield* Fiber.join(result)).toBe("Superseded")
      yield* Deferred.succeed(release, undefined)
      yield* refreshed.awaitInitial
      registry.refresh(runtime)
      const again = yield* AtomRegistry.getResult(registry, atoms.service, { suspendOnWaiting: true })
      yield* again.awaitInitial
      expect(yield* AtomRegistry.getResult(registry, action)).toBe("Superseded")
      expect(pushes).toBe(1)
      expect((yield* history.entries).map((entry) => entry.pathname)).toEqual(["/", "/slow"])
    })
  )

  it.live("creates cold, fresh action slots and closes pending gate scopes on disposal", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      let acquisitions = 0
      const Home = Router.route("home", "/", { prepare: () => Effect.void })
      const Slow = Router.route("slow", "/slow", {
        prepare: () =>
          Effect.acquireRelease(
            Effect.sync(() => {
              acquisitions++
            }),
            () => Deferred.succeed(closed, undefined)
          ).pipe(Effect.andThen(Deferred.succeed(started, undefined)), Effect.andThen(Effect.never))
      })
      const App = yield* Router.make("ActionCleanup", [Home, Slow])
      const atoms = AtomRouter.make(
        Atom.runtime(Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/")))),
        App
      )
      const first = atoms.navigate(Slow.to())
      expect(first).not.toBe(atoms.navigate(Slow.to()))
      expect(atoms.retry()).not.toBe(atoms.retry())
      expect(acquisitions).toBe(0)
      const registry = yield* makeRegistry
      registry.mount(first)
      yield* Deferred.await(started)
      expect(acquisitions).toBe(1)
      registry.dispose()
      yield* Deferred.await(closed)
    })
  )

  it.live("accepts navigation options and retries a failed observed location", () =>
    Effect.gen(function* () {
      let fail = true
      const Home = Router.route("home", "/", { prepare: () => Effect.void })
      const Page = Router.route("page", "/page", {
        prepare: () => Effect.suspend(() => (fail ? Effect.fail("unavailable") : Effect.void))
      })
      const App = yield* Router.make("Actions", [Home, Page])
      const atoms = AtomRouter.make(
        Atom.runtime(Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/")))),
        App
      )
      const registry = yield* makeRegistry
      const navigation = atoms.navigate(Page.to(), { replace: true, state: "payload" })
      yield* AtomRegistry.mount(registry, navigation)
      expect(yield* Effect.flip(AtomRegistry.getResult(registry, navigation))).toBe("unavailable")
      const router = yield* AtomRegistry.getResult(registry, atoms.service)
      expect(Option.getOrThrow((yield* router.state).location).state).toBe("payload")
      fail = false
      expect(yield* AtomRegistry.getResult(registry, atoms.retry())).toBe("Committed")
    })
  )

  it.live.each([
    { mismatch: "app", action: "navigate" },
    { mismatch: "app", action: "retry" },
    { mismatch: "router", action: "navigate" },
    { mismatch: "router", action: "retry" }
  ] as const)("rejects a mismatched bundle $mismatch before $action", ({ mismatch, action }) =>
    Effect.gen(function* () {
      const Home = Router.route("home", "/", { prepare: () => Effect.void })
      const First = yield* Router.make("SameId", [Home])
      const Second = yield* Router.make("SameId", [Home])
      const bundle = Layer.effect(
        Router.RuntimeApplication,
        Effect.map(Router.RuntimeApplication, (selected) =>
          mismatch === "app" ? selected : { ...selected, app: Second }
        )
      ).pipe(Layer.provide(Router.layer(Effect.succeed(First))), Layer.provide(MemoryHistory.layer("/")))
      const atoms = AtomRouter.make(Atom.runtime(bundle), Second)
      const registry = yield* makeRegistry
      const command = action === "navigate" ? atoms.navigate(Home.to()) : atoms.retry()
      const exit = yield* Effect.exit(AtomRegistry.getResult(registry, command))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit))
        expect(
          exit.cause.reasons.some(
            (reason) => Cause.isDieReason(reason) && reason.defect instanceof Router.RouteDefinitionError
          )
        ).toBe(true)
    })
  )

  it.live("preserves independent outcomes when a navigation supersedes another", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const Home = Router.route("home", "/", { prepare: () => Effect.void })
      const Slow = Router.route("slow", "/slow", {
        prepare: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
      })
      const App = yield* Router.make("ConcurrentActions", [Home, Slow])
      const atoms = AtomRouter.make(
        Atom.runtime(Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/")))),
        App
      )
      const registry = yield* makeRegistry
      const command = atoms.navigate(Slow.to())
      const first = yield* AtomRegistry.getResult(registry, command).pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      const second = yield* AtomRegistry.getResult(registry, atoms.navigate(Home.to()))
      expect(yield* Fiber.join(first)).toBe("Superseded")
      expect(second).toBe("Committed")
    })
  )
})
