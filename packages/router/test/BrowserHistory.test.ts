// @vitest-environment happy-dom
import { it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Queue from "effect/Queue"
import * as References from "effect/References"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import { afterEach, beforeEach, describe, expect, vi } from "vitest"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import type * as History from "@effect-stack/router/History"
import * as Router from "@effect-stack/router/Router"

const stateKey = "@effect-stack/router/history-state"
const uuid = "00000000-0000-4000-8000-000000000001"
const envelope = (value: unknown = "state") => ({
  [stateKey]: { version: 1, key: `browser-${uuid}`, index: 0, value }
})

const subscribe = Effect.fnUntraced(function* () {
  const logs = yield* Queue.unbounded<{
    readonly cause: Cause.Cause<unknown>
    readonly annotations: Readonly<Record<string, unknown>>
  }>()
  const logger = Logger.make<unknown, void>((options) => {
    Queue.offerUnsafe(logs, {
      cause: options.cause,
      annotations: options.fiber.getRef(References.CurrentLogAnnotations)
    })
  })
  // Logging must retain the acquisition context even when consumed elsewhere.
  const history = yield* BrowserHistory.make().pipe(Effect.provide(Logger.layer([logger])))
  const ready = yield* Deferred.make<void>()
  const locations = yield* Queue.unbounded<History.Location>()
  const addListener = window.addEventListener.bind(window)
  const add = vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    addListener(type, listener, options)
    if (type === "popstate") Deferred.doneUnsafe(ready, Effect.void)
  })
  const remove = vi.spyOn(window, "removeEventListener")
  const fiber = yield* history.changes.pipe(
    Stream.runForEach((location) => Queue.offer(locations, location)),
    Effect.exit,
    Effect.forkScoped
  )
  yield* Deferred.await(ready)
  return { history, logs, locations, fiber, add, remove }
})

describe("BrowserHistory recovery", { concurrent: false }, () => {
  let state: unknown

  beforeEach(() => {
    state = envelope()
    vi.spyOn(window.history, "state", "get").mockImplementation(() => state)
    vi.spyOn(window.history, "replaceState").mockImplementation((next) => {
      state = next
    })
    vi.spyOn(window.history, "pushState").mockImplementation((next) => {
      state = next
    })
    vi.spyOn(window.history, "go").mockImplementation(() => {})
    vi.spyOn(window.crypto, "randomUUID").mockReturnValue(uuid)
  })

  afterEach(() => vi.restoreAllMocks())

  it.effect("retries only reads at 25ms and 50ms, with three attempts total", () =>
    Effect.gen(function* () {
      const history = yield* BrowserHistory.make()
      const reads = yield* Queue.unbounded<void>()
      const error = new Error("unreadable")
      const getter = vi
        .spyOn(window.history, "state", "get")
        .mockClear()
        .mockImplementation(() => {
          Queue.offerUnsafe(reads, undefined)
          throw error
        })
      const fiber = yield* Effect.exit(history.current).pipe(Effect.forkScoped)
      yield* Queue.take(reads)
      yield* TestClock.adjust("24 millis")
      expect(getter).toHaveBeenCalledTimes(1)
      yield* TestClock.adjust("1 millis")
      yield* Queue.take(reads)
      yield* TestClock.adjust("49 millis")
      expect(getter).toHaveBeenCalledTimes(2)
      yield* TestClock.adjust("1 millis")
      yield* Queue.take(reads)
      const exit = yield* Fiber.join(fiber)
      expect(getter).toHaveBeenCalledTimes(3)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({ operation: "current", cause: error })
      }
      expect(vi.spyOn(window.history, "replaceState")).not.toHaveBeenCalled()
    }).pipe(Effect.scoped)
  )

  it.effect("types UUID failures as push errors without attempting a write", () =>
    Effect.gen(function* () {
      const history = yield* BrowserHistory.make()
      const error = new Error("UUID unavailable")
      vi.spyOn(window.crypto, "randomUUID").mockImplementation(() => {
        throw error
      })
      const exit = yield* Effect.exit(history.push({ pathname: "/next", search: "", hash: "" }))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(false)
        expect(Cause.squash(exit.cause)).toMatchObject({ operation: "push", cause: error })
      }
      expect(vi.spyOn(window.history, "pushState")).not.toHaveBeenCalled()
    })
  )

  it.effect("skips an exhausted popstate read and observes later events on the same listener", () =>
    Effect.gen(function* () {
      const { logs, locations, fiber, add, remove } = yield* subscribe()
      const reads = yield* Queue.unbounded<void>()
      const error = new Error("read failed")
      const getter = vi
        .spyOn(window.history, "state", "get")
        .mockClear()
        .mockImplementation(() => {
          Queue.offerUnsafe(reads, undefined)
          throw error
        })
      window.dispatchEvent(new PopStateEvent("popstate"))
      yield* Queue.take(reads)
      yield* TestClock.adjust("25 millis")
      yield* Queue.take(reads)
      yield* TestClock.adjust("50 millis")
      yield* Queue.take(reads)
      const log = yield* Queue.take(logs)
      expect(Cause.squash(log.cause)).toMatchObject({ operation: "current", cause: error })
      expect(log.annotations).toMatchObject({
        operation: "BrowserHistory.popstate",
        phase: "read",
        retries: 2,
        observation: "skipped"
      })
      expect(getter).toHaveBeenCalledTimes(3)
      expect(remove).not.toHaveBeenCalled()
      getter.mockImplementation(() => envelope("later"))
      window.dispatchEvent(new PopStateEvent("popstate"))
      expect((yield* Queue.take(locations)).state).toBe("later")
      expect(add.mock.calls.filter(([type]) => type === "popstate")).toHaveLength(1)
      yield* Fiber.interrupt(fiber)
      expect(remove.mock.calls.filter(([type]) => type === "popstate")).toHaveLength(1)
      expect(vi.spyOn(window.history, "replaceState")).not.toHaveBeenCalled()
    }).pipe(Effect.scoped)
  )

  it.effect("attempts a failing metadata repair once and keeps observing later events", () =>
    Effect.gen(function* () {
      const { logs, locations, fiber } = yield* subscribe()
      state = { external: true }
      const error = new Error("repair rejected")
      const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => {
        throw error
      })
      window.dispatchEvent(new PopStateEvent("popstate"))
      const log = yield* Queue.take(logs)
      expect(Cause.squash(log.cause)).toMatchObject({ operation: "current", cause: error })
      expect(log.annotations).toMatchObject({
        operation: "BrowserHistory.popstate",
        phase: "repair",
        retries: 0,
        observation: "skipped"
      })
      expect(replace).toHaveBeenCalledTimes(1)
      expect(vi.spyOn(window.crypto, "randomUUID")).toHaveBeenCalledTimes(1)
      replace.mockImplementation((next) => {
        state = next
      })
      window.dispatchEvent(new PopStateEvent("popstate"))
      const location = yield* Queue.take(locations)
      expect(location.state).toEqual({ external: true })
      expect(location.key).toBe(`browser-${uuid}`)
      expect(replace).toHaveBeenCalledTimes(2)
      yield* Fiber.interrupt(fiber)
    }).pipe(Effect.scoped)
  )

  it.effect("keeps startup repair failures typed and never replays the repair", () =>
    Effect.gen(function* () {
      state = "external"
      const error = new Error("startup repair rejected")
      vi.spyOn(window.history, "replaceState").mockImplementation(() => {
        throw error
      })
      const exit = yield* Effect.exit(BrowserHistory.make())
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(false)
        expect(Cause.squash(exit.cause)).toMatchObject({ operation: "current", cause: error })
      }
      expect(vi.spyOn(window.history, "replaceState")).toHaveBeenCalledTimes(1)
    })
  )

  it.effect("does not replay command metadata repairs or push writes", () =>
    Effect.gen(function* () {
      const history = yield* BrowserHistory.make()
      state = "external"
      const repairError = new Error("command repair rejected")
      const repair = vi.spyOn(window.history, "replaceState").mockImplementation(() => {
        throw repairError
      })
      const destination = { pathname: "/next", search: "", hash: "" }
      const repairExit = yield* Effect.exit(history.push(destination))
      expect(Exit.isFailure(repairExit)).toBe(true)
      expect(repair).toHaveBeenCalledTimes(1)
      expect(vi.spyOn(window.history, "pushState")).not.toHaveBeenCalled()
      state = envelope()
      const pushError = new Error("push rejected")
      const push = vi.spyOn(window.history, "pushState").mockImplementation(() => {
        throw pushError
      })
      const pushExit = yield* Effect.exit(history.push(destination))
      expect(Exit.isFailure(pushExit)).toBe(true)
      if (Exit.isFailure(pushExit)) {
        expect(Cause.squash(pushExit.cause)).toMatchObject({ operation: "push", cause: pushError })
      }
      expect(push).toHaveBeenCalledTimes(1)
    })
  )

  it.effect("preserves defects without event-level logging or retrying, then removes the listener", () =>
    Effect.gen(function* () {
      const { logs, fiber, remove } = yield* subscribe()
      const defect = new Error("error conversion defect")
      const error = new Error("read failed")
      Object.defineProperty(error, "message", {
        get: () => {
          throw defect
        }
      })
      const getter = vi
        .spyOn(window.history, "state", "get")
        .mockClear()
        .mockImplementation(() => {
          throw error
        })
      window.dispatchEvent(new PopStateEvent("popstate"))
      const exit = yield* Fiber.join(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true)
        expect(Cause.squash(exit.cause)).toBe(defect)
        expect(exit.cause.reasons).toHaveLength(1)
      }
      expect(yield* Queue.size(logs)).toBe(0)
      expect(getter).toHaveBeenCalledTimes(1)
      expect(remove.mock.calls.filter(([type]) => type === "popstate")).toHaveLength(1)
    }).pipe(Effect.scoped)
  )

  it.effect("lets Router report a terminal browser defect exactly once without restarting", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      const entries = yield* Queue.unbounded<Logger.Options<unknown>>()
      const logs: Array<Logger.Options<unknown>> = []
      const logger = Logger.make((entry: Logger.Options<unknown>) => {
        logs.push(entry)
        Queue.offerUnsafe(entries, entry)
      })
      const addListener = window.addEventListener.bind(window)
      const add = vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
        addListener(type, listener, options)
        if (type === "popstate") Deferred.doneUnsafe(ready, Effect.void)
      })
      const removeListener = window.removeEventListener.bind(window)
      const remove = vi.spyOn(window, "removeEventListener").mockImplementation((type, listener, options) => {
        removeListener(type, listener, options)
        if (type === "popstate") Deferred.doneUnsafe(closed, Effect.void)
      })
      const App = Router.make("BrowserObservationDiagnostics", [Router.route("home", "/")])
      const layer = App.layer.pipe(Layer.provide(BrowserHistory.layer), Layer.provide(Logger.layer([logger])))
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial
        yield* Deferred.await(ready)
        const before = yield* router.state
        const defect = new Error("error conversion defect")
        const error = new Error("read failed")
        Object.defineProperty(error, "message", {
          get: () => {
            throw defect
          }
        })
        const getter = vi
          .spyOn(window.history, "state", "get")
          .mockClear()
          .mockImplementation(() => {
            throw error
          })
        window.dispatchEvent(new PopStateEvent("popstate"))
        const entry = yield* Queue.take(entries)
        yield* Deferred.await(closed)
        expect(entry.message).toEqual(["Router.historyObservationStopped"])
        expect(entry.logLevel).toBe("Error")
        expect(Cause.hasDies(entry.cause)).toBe(true)
        expect(Cause.squash(entry.cause)).toBe(defect)
        expect(entry.cause.reasons).toHaveLength(1)
        yield* TestClock.adjust("100 millis")
        getter.mockImplementation(() => envelope("later"))
        window.dispatchEvent(new PopStateEvent("popstate"))
        expect(getter).toHaveBeenCalledTimes(1)
        expect(add.mock.calls.filter(([type]) => type === "popstate")).toHaveLength(1)
        expect(remove.mock.calls.filter(([type]) => type === "popstate")).toHaveLength(1)
        expect(yield* router.state).toEqual(before)
        expect(logs).toHaveLength(1)
      }).pipe(Effect.provide(layer))
      expect(logs).toHaveLength(1)
    })
  )

  for (const phase of ["read", "repair"] as const) {
    it.effect(`preserves the ${phase} failure alongside a throwing observation Logger`, () =>
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>()
        const entries = yield* Queue.unbounded<Logger.Options<unknown>>()
        const logs: Array<Logger.Options<unknown>> = []
        const loggingDefect = new Error("diagnostic emission failed")
        let failedLogs = 0
        const logger = Logger.make((entry: Logger.Options<unknown>) => {
          if (Array.isArray(entry.message) && entry.message[0] === "BrowserHistory.popstate failed") {
            failedLogs += 1
            throw loggingDefect
          }
          logs.push(entry)
          Queue.offerUnsafe(entries, entry)
        })
        const addListener = window.addEventListener.bind(window)
        const add = vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
          addListener(type, listener, options)
          if (type === "popstate") Deferred.doneUnsafe(ready, Effect.void)
        })
        const remove = vi.spyOn(window, "removeEventListener")
        const App = Router.make("ObservationLoggerFailure", [Router.route("home", "/")])
        const layer = App.layer.pipe(Layer.provide(BrowserHistory.layer), Layer.provide(Logger.layer([logger])))
        yield* Effect.gen(function* () {
          const router = yield* App.service
          yield* router.awaitInitial
          yield* Deferred.await(ready)
          const before = yield* router.state
          const original = new Error("history unavailable")
          const reads = yield* Queue.unbounded<void>()
          const getter = vi.spyOn(window.history, "state", "get").mockClear()
          const replace = vi.spyOn(window.history, "replaceState").mockClear()
          if (phase === "read") {
            getter.mockImplementation(() => {
              Queue.offerUnsafe(reads, undefined)
              throw original
            })
          } else {
            state = { external: true }
            replace.mockImplementation(() => {
              throw original
            })
          }
          window.dispatchEvent(new PopStateEvent("popstate"))
          if (phase === "read") {
            yield* Queue.take(reads)
            yield* TestClock.adjust("25 millis")
            yield* Queue.take(reads)
            yield* TestClock.adjust("50 millis")
            yield* Queue.take(reads)
          }
          const entry = yield* Queue.take(entries)
          expect(entry.message).toEqual(["Router.historyObservationStopped"])
          expect(entry.cause.reasons).toHaveLength(2)
          expect(entry.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject({
            operation: "current",
            cause: original
          })
          expect(entry.cause.reasons.find(Cause.isDieReason)?.defect).toBe(loggingDefect)
          expect(failedLogs).toBe(1)
          expect(getter).toHaveBeenCalledTimes(phase === "read" ? 3 : 1)
          expect(replace).toHaveBeenCalledTimes(phase === "read" ? 0 : 1)
          expect(add.mock.calls.filter(([type]) => type === "popstate")).toHaveLength(1)
          expect(remove.mock.calls.filter(([type]) => type === "popstate")).toHaveLength(1)
          expect(yield* router.state).toEqual(before)
        }).pipe(Effect.provide(layer))
        expect(logs).toHaveLength(1)
      })
    )
  }

  it.effect("recovers a transient popstate read without repairing or replacing the listener", () =>
    Effect.gen(function* () {
      const { locations, fiber, add, remove } = yield* subscribe()
      const attempted = yield* Deferred.make<void>()
      const getter = vi
        .spyOn(window.history, "state", "get")
        .mockClear()
        .mockImplementationOnce(() => {
          Deferred.doneUnsafe(attempted, Effect.void)
          throw new Error("transient read")
        })
        .mockImplementation(() => envelope("recovered"))
      window.dispatchEvent(new PopStateEvent("popstate"))
      yield* Deferred.await(attempted)
      yield* TestClock.adjust("25 millis")
      expect((yield* Queue.take(locations)).state).toBe("recovered")
      expect(getter).toHaveBeenCalledTimes(2)
      expect(add.mock.calls.filter(([type]) => type === "popstate")).toHaveLength(1)
      expect(remove).not.toHaveBeenCalled()
      expect(vi.spyOn(window.history, "replaceState")).not.toHaveBeenCalled()
      yield* Fiber.interrupt(fiber)
    }).pipe(Effect.scoped)
  )

  it.effect("repairs an external startup entry once with the compatible envelope", () =>
    Effect.gen(function* () {
      state = { external: true }
      const history = yield* BrowserHistory.make()
      const location = yield* history.current
      expect(location).toMatchObject({ state: { external: true }, key: `browser-${uuid}`, index: 0 })
      expect(state).toEqual(envelope({ external: true }))
      expect(vi.spyOn(window.history, "replaceState")).toHaveBeenCalledTimes(1)
      expect(vi.spyOn(window.crypto, "randomUUID")).toHaveBeenCalledTimes(1)
    })
  )
})
