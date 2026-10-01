import { describe, expect, it } from "@effect/vitest"
import { History, MemoryHistory, Router } from "@effect-stack/router"
import { navigateDetached, retryDetached } from "@effect-stack/router/Adapter"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as References from "effect/References"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

interface Diagnostic {
  readonly message: unknown
  readonly cause: Cause.Cause<unknown>
  readonly annotations: Readonly<Record<string, unknown>>
}

const captureDiagnostics = Effect.fnUntraced(function* () {
  const emitted = yield* Queue.unbounded<Diagnostic>()
  const entries: Array<Diagnostic> = []
  const logger = Logger.make((entry: Logger.Options<unknown>) => {
    const diagnostic = {
      message: entry.message,
      cause: entry.cause,
      annotations: entry.fiber.getRef(References.CurrentLogAnnotations)
    }
    entries.push(diagnostic)
    Queue.offerUnsafe(emitted, diagnostic)
  })
  return { logger, entries, next: Queue.take(emitted) }
})

const settledState = <Routes, E>(router: Router.RouterService<Routes, E>) =>
  router.changes.pipe(
    Stream.filter((state) => state.status._tag === "Failed"),
    Stream.runHead,
    Effect.map(Option.getOrThrow)
  )

describe("detached command diagnostics", () => {
  for (const target of ["foreign", "missing", "invalid"] as const) {
    it.effect(
      `reports ${target} target rejection through the application's Logger without changing accepted work`,
      () =>
        Effect.gen(function* () {
          const diagnostic = yield* captureDiagnostics()
          const Home = Router.route("home", "/")
          const Item = Router.route("item", "/items/:id", { params: { id: Schema.FiniteFromString } })
          const Foreign = Router.route("foreign", "/foreign")
          const App = Router.make("DetachedTargets", [Home, Item])
          const layer = App.layer.pipe(
            Layer.provide(MemoryHistory.layer()),
            Layer.provide(Logger.layer([diagnostic.logger]))
          )
          yield* Effect.gen(function* () {
            const router = yield* App.service
            yield* router.awaitInitial
            const before = yield* router.state
            const destination =
              target === "foreign"
                ? Foreign.to()
                : target === "missing"
                  ? { to: "/missing" }
                  : { to: "/items/:id", params: { id: "not-a-number" } }
            // Deliberately invalid inputs exercise the runtime seam.
            navigateDetached(router, destination as never)
            const entry = yield* diagnostic.next
            expect(entry.message).toEqual(["Router.commandFailed"])
            expect(Cause.squash(entry.cause)).toBeInstanceOf(Router.RouteEncodeError)
            expect(entry.annotations).toMatchObject({
              applicationId: "DetachedTargets",
              operation: "navigate",
              phase: "pre-acceptance"
            })
            expect(yield* router.state).toEqual(before)
            expect(diagnostic.entries).toHaveLength(1)
          }).pipe(Effect.provide(layer))
        })
    )
  }

  it.effect("preserves a mixed pre-acceptance Cause and never repeats the history write", () =>
    Effect.gen(function* () {
      const diagnostic = yield* captureDiagnostics()
      const memory = yield* MemoryHistory.make()
      const failure = new History.HistoryError({ operation: "push", message: "write failed", cause: "host" })
      const defect = new Error("write defect")
      const cause = Cause.combine(Cause.fail(failure), Cause.die(defect))
      let writes = 0
      const history: History.Interface = {
        ...memory,
        push: () => {
          writes += 1
          return Effect.failCause(cause)
        }
      }
      const Home = Router.route("home", "/")
      const Target = Router.route("target", "/target")
      const App = Router.make("DetachedWrite", [Home, Target])
      const layer = App.layer.pipe(
        Layer.provide(Layer.succeed(History.History, history)),
        Layer.provide(Logger.layer([diagnostic.logger]))
      )
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        const before = yield* router.state
        navigateDetached(router, Target.to())
        const entry = yield* diagnostic.next
        expect(entry.cause.reasons).toHaveLength(2)
        expect(entry.cause.reasons.some((reason) => Cause.isFailReason(reason) && reason.error === failure)).toBe(true)
        expect(entry.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true)
        expect(yield* router.state).toEqual(before)
        expect(writes).toBe(1)
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect("reports a retry read failure without accepting work or replaying it", () =>
    Effect.gen(function* () {
      const diagnostic = yield* captureDiagnostics()
      const memory = yield* MemoryHistory.make()
      const failure = new History.HistoryError({ operation: "current", message: "read failed", cause: "host" })
      let fail = false
      const history: History.Interface = {
        ...memory,
        current: Effect.suspend(() => (fail ? Effect.fail(failure) : memory.current))
      }
      const App = Router.make("DetachedRetry", [Router.route("home", "/")])
      const layer = App.layer.pipe(
        Layer.provide(Layer.succeed(History.History, history)),
        Layer.provide(Logger.layer([diagnostic.logger]))
      )
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        const before = yield* router.state
        fail = true
        retryDetached(router)
        const entry = yield* diagnostic.next
        expect(Cause.squash(entry.cause)).toBe(failure)
        expect(entry.annotations).toMatchObject({ operation: "retry", phase: "pre-acceptance" })
        expect(yield* router.state).toEqual(before)
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect("does not duplicate a published Gate failure, even when the error is later reused by a command", () =>
    Effect.gen(function* () {
      const diagnostic = yield* captureDiagnostics()
      const memory = yield* MemoryHistory.make()
      const failure = new History.HistoryError({ operation: "push", message: "reused error", cause: "host" })
      const Home = Router.route("home", "/")
      const Gate = Router.route("gate", "/gate", { prepare: () => Effect.fail(failure) })
      const Unwritten = Router.route("unwritten", "/unwritten")
      const App = Router.make("DetachedProvenance", [Home, Gate, Unwritten])
      const history: History.Interface = {
        ...memory,
        push: (destination) => (destination.pathname === "/unwritten" ? Effect.fail(failure) : memory.push(destination))
      }
      const layer = App.layer.pipe(
        Layer.provide(Layer.succeed(History.History, history)),
        Layer.provide(Logger.layer([diagnostic.logger]))
      )
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        navigateDetached(router, Gate.to())
        const failed = yield* settledState(router)
        expect(failed.status._tag).toBe("Failed")
        navigateDetached(router, Unwritten.to())
        const entry = yield* diagnostic.next
        expect(Cause.squash(entry.cause)).toBe(failure)
        expect(entry.annotations.phase).toBe("pre-acceptance")
        expect(yield* router.state).toEqual(failed)
      }).pipe(Effect.provide(layer))
      expect(diagnostic.entries).toHaveLength(1)
    })
  )

  it.effect("reports an unpublished obsolete attempt's cleanup defect after newer work commits", () =>
    Effect.gen(function* () {
      const diagnostic = yield* captureDiagnostics()
      const entered = yield* Deferred.make<void>()
      const defect = new Error("obsolete cleanup failed")
      const Home = Router.route("home", "/")
      const Slow = Router.route("slow", "/slow", {
        prepare: () =>
          Effect.acquireRelease(Deferred.succeed(entered, undefined), () => Effect.die(defect)).pipe(
            Effect.andThen(Effect.never)
          )
      })
      const App = Router.make("DetachedObsolete", [Home, Slow])
      const layer = App.layer.pipe(
        Layer.provide(MemoryHistory.layer()),
        Layer.provide(Logger.layer([diagnostic.logger]))
      )
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        navigateDetached(router, Slow.to())
        yield* Deferred.await(entered)
        yield* router.navigate(Home.to())
        const entry = yield* diagnostic.next
        expect(entry.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true)
        expect(entry.annotations).toMatchObject({ operation: "navigate", phase: "accepted" })
        expect((yield* router.state).status._tag).toBe("Committed")
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect("leaves explicit Effect failures in their original channel without detached diagnostics", () =>
    Effect.gen(function* () {
      const diagnostic = yield* captureDiagnostics()
      const Home = Router.route("home", "/")
      const Gate = Router.route("gate", "/gate", { prepare: () => Effect.fail("expected gate error") })
      const App = Router.make("ExplicitFailure", [Home, Gate])
      const layer = App.layer.pipe(
        Layer.provide(MemoryHistory.layer()),
        Layer.provide(Logger.layer([diagnostic.logger]))
      )
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        expect(yield* Effect.flip(router.navigate(Gate.to()))).toBe("expected gate error")
      }).pipe(Effect.provide(layer))
      expect(diagnostic.entries).toEqual([])
    })
  )

  it.effect("owns detached waiters in the router Scope without shutdown interruption noise", () =>
    Effect.gen(function* () {
      const diagnostic = yield* captureDiagnostics()
      const entered = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      const Home = Router.route("home", "/")
      const Slow = Router.route("slow", "/slow", {
        prepare: () =>
          Effect.acquireRelease(Deferred.succeed(entered, undefined), () =>
            Deferred.succeed(released, undefined).pipe(Effect.asVoid)
          ).pipe(Effect.andThen(Effect.never))
      })
      const App = Router.make("DetachedCleanup", [Home, Slow])
      const layer = App.layer.pipe(
        Layer.provide(MemoryHistory.layer()),
        Layer.provide(Logger.layer([diagnostic.logger]))
      )
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        navigateDetached(router, Slow.to())
        yield* Deferred.await(entered)
      }).pipe(Effect.provide(layer))
      expect(yield* Deferred.isDone(released)).toBe(true)
      expect(diagnostic.entries).toEqual([])
    })
  )
})
