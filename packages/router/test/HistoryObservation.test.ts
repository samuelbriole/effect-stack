import { describe, expect, it } from "@effect/vitest"
import { History, MemoryHistory, Router } from "@effect-stack/router"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

describe("history observation supervision", () => {
  for (const defect of [false, true]) {
    it.effect(`reports a terminal ${defect ? "defect" : "HistoryError"} without restarting an unknown source`, () =>
      Effect.gen(function* () {
        const failed = yield* Deferred.make<void>()
        const logs = yield* Queue.unbounded<Logger.Options<unknown>>()
        const logger = Logger.make((entry: Logger.Options<unknown>) => {
          Queue.offerUnsafe(logs, entry)
        })
        const memory = yield* MemoryHistory.make()
        const failure = new History.HistoryError({ operation: "current", message: "observation failed", cause: "host" })
        let subscriptions = 0
        const history: History.Interface = {
          ...memory,
          changes: Stream.unwrap(
            Effect.sync(() => {
              subscriptions += 1
              return Stream.fromEffect(
                Deferred.await(failed).pipe(Effect.andThen(defect ? Effect.die(failure) : Effect.fail(failure)))
              )
            })
          )
        }
        const App = Router.make("ObservationDiagnostics", [Router.route("home", "/")])
        const layer = App.layer.pipe(
          Layer.provide(Layer.succeed(History.History, history)),
          Layer.provide(Logger.layer([logger]))
        )
        yield* Effect.gen(function* () {
          const router = yield* App.service
          yield* router.awaitInitial
          const before = yield* router.state
          yield* Deferred.succeed(failed, undefined)
          const entry = yield* Queue.take(logs)
          expect(entry.message).toEqual(["Router.historyObservationStopped"])
          expect(entry.logLevel).toBe("Error")
          expect(Cause.squash(entry.cause)).toBe(failure)
          expect(entry.cause.reasons.some(Cause.isDieReason)).toBe(defect)
          expect(yield* router.state).toEqual(before)
          expect(subscriptions).toBe(1)
        }).pipe(Effect.provide(layer))
      })
    )
  }

  it.effect("reports a self-interrupted source while the router Scope remains open", () =>
    Effect.gen(function* () {
      const stop = yield* Deferred.make<void>()
      const entries = yield* Queue.unbounded<Logger.Options<unknown>>()
      const logs: Array<Logger.Options<unknown>> = []
      const logger = Logger.make((entry: Logger.Options<unknown>) => {
        logs.push(entry)
        Queue.offerUnsafe(entries, entry)
      })
      const memory = yield* MemoryHistory.make()
      let subscriptions = 0
      const history: History.Interface = {
        ...memory,
        changes: Stream.unwrap(
          Effect.sync(() => {
            subscriptions += 1
            return Stream.fromEffect(Deferred.await(stop).pipe(Effect.andThen(Effect.interrupt)))
          })
        )
      }
      const App = Router.make("ObservationSelfInterrupt", [Router.route("home", "/")])
      const layer = App.layer.pipe(
        Layer.provide(Layer.succeed(History.History, history)),
        Layer.provide(Logger.layer([logger]))
      )
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        const before = yield* router.state
        yield* Deferred.succeed(stop, undefined)
        const entry = yield* Queue.take(entries)
        expect(entry.message).toEqual(["Router.historyObservationStopped"])
        expect(Cause.hasInterruptsOnly(entry.cause)).toBe(true)
        expect(yield* router.state).toEqual(before)
        expect(subscriptions).toBe(1)
      }).pipe(Effect.provide(layer))
      expect(logs).toHaveLength(1)
    })
  )

  it.effect("closes observation on scope shutdown without an interruption diagnostic", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      const logs: Array<Logger.Options<unknown>> = []
      const logger = Logger.make((entry: Logger.Options<unknown>) => {
        logs.push(entry)
      })
      const memory = yield* MemoryHistory.make()
      const history: History.Interface = {
        ...memory,
        changes: Stream.unwrap(
          Effect.acquireRelease(Deferred.succeed(ready, undefined), () =>
            Deferred.succeed(closed, undefined).pipe(Effect.asVoid)
          ).pipe(Effect.as(Stream.never))
        )
      }
      const App = Router.make("ObservationCleanup", [Router.route("home", "/")])
      const layer = App.layer.pipe(
        Layer.provide(Layer.succeed(History.History, history)),
        Layer.provide(Logger.layer([logger]))
      )
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        yield* Deferred.await(ready)
      }).pipe(Effect.provide(layer))
      expect(yield* Deferred.isDone(closed)).toBe(true)
      expect(logs).toEqual([])
    })
  )

  it.effect("preserves and reports an observation cleanup defect even during shutdown", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const defect = new Error("observation cleanup failed")
      const logs: Array<Logger.Options<unknown>> = []
      const logger = Logger.make((entry: Logger.Options<unknown>) => {
        logs.push(entry)
      })
      const memory = yield* MemoryHistory.make()
      const history: History.Interface = {
        ...memory,
        changes: Stream.unwrap(
          Effect.acquireRelease(Deferred.succeed(ready, undefined), () => Effect.die(defect)).pipe(
            Effect.as(Stream.never)
          )
        )
      }
      const App = Router.make("ObservationCleanupDefect", [Router.route("home", "/")])
      const layer = App.layer.pipe(
        Layer.provide(Layer.succeed(History.History, history)),
        Layer.provide(Logger.layer([logger]))
      )
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        yield* Deferred.await(ready)
      }).pipe(Effect.provide(layer))
      expect(logs).toHaveLength(1)
      expect(logs[0]?.message).toEqual(["Router.historyObservationStopped"])
      expect(logs[0]?.cause.reasons.find(Cause.isDieReason)?.defect).toBe(defect)
    })
  )

  it.effect("does not diagnose intentional stream completion as an observation failure", () =>
    Effect.gen(function* () {
      const logs: Array<Logger.Options<unknown>> = []
      const logger = Logger.make((entry: Logger.Options<unknown>) => {
        logs.push(entry)
      })
      const memory = yield* MemoryHistory.make()
      const history: History.Interface = { ...memory, changes: Stream.empty }
      const App = Router.make("ObservationCompletion", [Router.route("home", "/")])
      const layer = App.layer.pipe(
        Layer.provide(Layer.succeed(History.History, history)),
        Layer.provide(Logger.layer([logger]))
      )
      yield* App.service.pipe(
        Effect.flatMap((router) => router.awaitInitial),
        Effect.provide(layer)
      )
      expect(logs).toEqual([])
    })
  )
})
