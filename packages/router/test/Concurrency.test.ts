import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { History, MemoryHistory, Router } from "@effect-stack/router"
import { entryFailure } from "@effect-stack/router/Presentation"

class Gate extends Context.Service<
  Gate,
  {
    readonly wait: (key: string) => Effect.Effect<void>
    readonly open: (key: string) => Effect.Effect<void>
  }
>()("test/Gate") {}

const makeGate = Effect.gen(function* () {
  const map = yield* Ref.make(new Map<string, Deferred.Deferred<void>>())
  const get = (key: string) =>
    Ref.modify(map, (current) => {
      const existing = current.get(key)
      if (existing !== undefined) return [existing, current] as const
      const created = Deferred.makeUnsafe<void>()
      return [created, new Map(current).set(key, created)] as const
    })
  return Gate.of({
    wait: (key) => Effect.flatMap(get(key), Deferred.await),
    open: (key) => Effect.flatMap(get(key), (deferred) => Deferred.succeed(deferred, undefined).pipe(Effect.asVoid))
  })
})

const Home = Router.route("home", "/")
const Slow = Router.route("slow", "/slow/:key", {
  params: { key: Schema.String },
  prepare: ({ params }) =>
    Gate.use((gate) => gate.open(`started-slow-${params.key}`).pipe(Effect.andThen(gate.wait(params.key))))
})

const events: Array<string> = []

const finalizeLoad = () =>
  Effect.acquireRelease(
    Effect.sync(() => {
      events.push("acquire")
    }),
    () =>
      Effect.sync(() => {
        events.push("release")
      })
  )

const Finalize = Router.route("finalize", "/finalize", { prepare: () => finalizeLoad().pipe(Effect.asVoid) })

// A gate whose scoped release dies: successful work followed by failed
// cleanup must not publish data.
const BadRelease = Router.route("badRelease", "/bad-release", {
  prepare: () => Effect.acquireRelease(Effect.void, () => Effect.die(new Error("release-boom")))
})

// Ignores interruption and completes even after it was superseded.
const Stubborn = Router.route("stubborn", "/stubborn/:key", {
  params: { key: Schema.String },
  prepare: () => Effect.uninterruptible(Gate.use((gate) => gate.wait("hold-stubborn")))
})

// Ignores interruption end-to-end and only reaches its redirect write after supersession.
const RedirectStubborn = Router.route("redirectStubborn", "/redirect-stubborn", {
  prepare: () =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        yield* Gate.use((gate) => gate.wait("hold-redir"))
        return yield* Effect.fail(Router.redirect(Slow.to({ params: { key: "target" } })))
      })
    )
})

// Acquires, waits for a hold gate, and blocks its release on a separate gate so
// a supersession/cancellation interrupt parks inside gate cleanup. The "new"
// key remains free to finish. Readiness keys prove cleanup really was entered.
const Guarded = Router.route("guarded", "/guarded/:key", {
  params: { key: Schema.String },
  prepare: ({ params }) =>
    Effect.acquireRelease(
      Gate.use((gate) => gate.open(`started-${params.key}`)),
      () =>
        params.key === "old" || params.key === "cancel"
          ? Gate.use((gate) =>
              gate
                .open(`releasing-${params.key}`)
                .pipe(
                  Effect.andThen(gate.wait(`release-${params.key}`)),
                  Effect.andThen(gate.open(`released-${params.key}`))
                )
            )
          : Effect.void
    ).pipe(Effect.andThen(Gate.use((gate) => gate.wait(`hold-${params.key}`))), Effect.asVoid)
})

const App = Router.make("Conc", [Home, Slow, Finalize, BadRelease, Stubborn, RedirectStubborn, Guarded])

const slow = (key: string) => Slow.to({ params: { key } })
const guarded = (key: string) => Guarded.to({ params: { key } })

type AppRouter = Context.Service.Shape<typeof App.service>

const runWithRouter = <A, E, R>(
  program: (router: AppRouter, gate: Context.Service.Shape<typeof Gate>) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | History.HistoryError, R> =>
  Effect.gen(function* () {
    const gate = yield* makeGate
    const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")), Layer.provide(Layer.succeed(Gate, gate)))
    const programWithRouter = Effect.gen(function* () {
      const router = yield* App.service
      return yield* program(router, gate)
    })
    return yield* programWithRouter.pipe(Effect.provide(layer), Effect.provideService(Gate, gate))
  })

const resolvedKey = (state: Router.RouterState<unknown>): string | undefined => {
  const presentation = Option.getOrUndefined(state.presentation)
  if (presentation === undefined || presentation._tag !== "Resolved") return undefined
  const entry = presentation.entries.find((candidate) => candidate.id === "slow")
  if (entry === undefined) return undefined
  return Result.isSuccess(entry.input) ? (entry.input.success.params as { readonly key: string }).key : undefined
}

const awaitResolvedKey = (router: AppRouter, key: string): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    for (let index = 0; index < 500; index++) {
      const state = yield* router.state
      const value = resolvedKey(state)
      if (value === key) return value
      yield* Effect.yieldNow
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${key}`))
  })

const awaitEntrySuccess = (router: AppRouter, id: string): Effect.Effect<unknown, Error> =>
  Effect.gen(function* () {
    for (let index = 0; index < 500; index++) {
      const state = yield* router.state
      const presentation = Option.getOrUndefined(state.presentation)
      if (presentation !== undefined && presentation._tag === "Resolved") {
        const entry = presentation.entries.find((candidate) => candidate.id === id)
        if (entry !== undefined && Result.isSuccess(entry.input)) return entry.input.success.params
      }
      yield* Effect.yieldNow
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${id}`))
  })

describe("Router concurrency", () => {
  for (const initial of [true, false]) {
    it.effect(
      `a self-interrupted gate settles ${initial ? "initial" : "accepted"} navigation with a terminal snapshot`,
      () => {
        const LocalHome = Router.route("home", "/")
        const Interrupting = Router.route("interrupting", "/interrupting", {
          prepare: () => Effect.interrupt
        })
        const LocalApp = Router.make("SelfInterrupt", [LocalHome, Interrupting])
        const layer = LocalApp.layer.pipe(Layer.provide(MemoryHistory.layer(initial ? "/interrupting" : "/")))
        return Effect.gen(function* () {
          const router = yield* LocalApp.service
          if (!initial) yield* router.awaitInitial
          const exit = yield* Effect.exit(initial ? router.awaitInitial : router.navigate(Interrupting.to()))
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isSuccess(exit)) throw new Error("expected the gate's interruption Cause")
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
          const settled = yield* router.state
          const presentation = Option.getOrThrow(settled.presentation)
          expect(settled.status._tag).toBe("Failed")
          expect(presentation._tag).toBe("Failed")
          if (presentation._tag !== "Failed" || settled.status._tag !== "Failed") {
            throw new Error("expected terminal failure")
          }
          expect(settled.status.owner).toBe(Interrupting.id)
          expect(presentation.owner).toBe(Interrupting.id)
          expect(presentation.cause).toEqual(exit.cause)
          expect(settled.status.cause).toBe(presentation.cause)
          const entry = presentation.entries.find((candidate) => candidate.id === Interrupting.id)
          if (entry === undefined) throw new Error("missing failure owner entry")
          expect(Option.getOrThrow(entry.failure)).toBe(presentation.cause)
          expect(Option.getOrThrow(entryFailure(entry))).toEqual({ _tag: "Cause", cause: presentation.cause })
          expect(yield* router.navigate(LocalHome.to())).toBe("Committed")
          expect((yield* router.state).status._tag).toBe("Committed")
        }).pipe(Effect.provide(layer))
      }
    )
  }

  it.effect("closes gate scopes before publishing the resolved branch", () =>
    Effect.gen(function* () {
      events.length = 0
      const gate = yield* makeGate
      const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")), Layer.provide(Layer.succeed(Gate, gate)))
      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.navigate(Finalize.to())
        expect(events).toEqual(["acquire", "release"])
        const state = yield* router.state
        expect(Option.getOrThrow(state.presentation)._tag).toBe("Resolved")
      }).pipe(Effect.provide(layer))
    })
  )

  it.effect("supersedes an older accepted attempt", () =>
    runWithRouter((router, gate) =>
      Effect.gen(function* () {
        const h1 = yield* router.submit(slow("a"))
        const h2 = yield* router.submit(slow("b"))
        yield* gate.open("a")
        yield* gate.open("b")
        expect(yield* h2.await).toBe("Committed")
        expect(yield* h1.await).toBe("Superseded")
        const state = yield* router.state
        expect(resolvedKey(state)).toBe("b")
      })
    )
  )

  it.effect("explicit cancellation settles the handle and publishes a terminal status", () =>
    runWithRouter((router) =>
      Effect.gen(function* () {
        const handle = yield* router.submit(slow("c"))
        yield* Effect.yieldNow
        yield* handle.cancel
        expect(yield* handle.await).toBe("Cancelled")
        const state = yield* router.state
        expect(state.status._tag).toBe("Cancelled")
      })
    )
  )

  it.effect("caller interruption stops waiting while accepted work continues", () =>
    runWithRouter((router, gate) =>
      Effect.gen(function* () {
        const waiter = yield* Effect.forkChild(router.navigate(slow("d")))
        yield* Effect.yieldNow
        yield* Fiber.interrupt(waiter)
        yield* gate.open("d")
        expect(yield* awaitResolvedKey(router, "d")).toBe("d")
      })
    )
  )

  it.effect("pre-acceptance rejection does not cancel accepted work", () =>
    runWithRouter((router, gate) =>
      Effect.gen(function* () {
        const first = yield* router.submit(slow("e"))
        yield* gate.wait("started-slow-e")
        const before = yield* router.state
        const destination = slow("e")
        const invalid = {
          ...destination,
          input: { params: { key: 1 }, search: {}, hash: undefined }
        } as unknown as typeof destination
        const error = yield* Effect.flip(router.navigate(invalid))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
        const after = yield* router.state
        expect(after).toStrictEqual(before)
        expect(after.status).toBe(before.status)
        expect(after.presentation).toBe(before.presentation)
        yield* gate.open("e")
        expect(yield* first.await).toBe("Committed")
        const state = yield* router.state
        expect(resolvedKey(state)).toBe("e")
        expect(state.status).toEqual({ _tag: "Committed", attempt: first.id })
      })
    )
  )

  it.effect("supersession completes the handoff even when the caller is interrupted in a blocked finalizer", () =>
    runWithRouter((router, gate) =>
      Effect.gen(function* () {
        const old = yield* router.submit(guarded("old"))
        yield* Effect.yieldNow
        const superseder = yield* Effect.forkChild(router.navigate(guarded("new")))
        yield* Effect.yieldNow
        yield* Fiber.interrupt(superseder)
        yield* gate.open("hold-new")
        expect(yield* awaitEntrySuccess(router, "guarded")).toEqual({ key: "new" })
        yield* gate.open("release-old")
        expect(yield* old.await).toBe("Superseded")
      })
    )
  )

  it.effect("treats a failed gate finalizer as a failed preparation and stays usable", () =>
    runWithRouter((router) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(router.navigate(BadRelease.to()))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(true)
        }
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
        expect(presentation.owner).toBe("badRelease")
        yield* router.navigate(Finalize.to())
        expect(Option.getOrThrow((yield* router.state).presentation)._tag).toBe("Resolved")
      })
    )
  )

  it.effect("a superseded attempt that completes successfully cannot publish over the newer attempt", () =>
    runWithRouter((router, gate) =>
      Effect.gen(function* () {
        const published: Array<string> = []
        const collector = yield* Effect.forkChild(
          router.changes.pipe(
            Stream.runForEach((state) =>
              Effect.sync(() => {
                const presentation = Option.getOrUndefined(state.presentation)
                if (presentation === undefined || presentation._tag !== "Resolved") return
                const entry = presentation.entries.find((candidate) => candidate.id === "stubborn")
                if (entry === undefined) return
                if (Result.isSuccess(entry.input))
                  published.push((entry.input.success.params as { readonly key: string }).key)
              })
            )
          )
        )
        const old = yield* router.submit(Stubborn.to({ params: { key: "old" } }))
        yield* Effect.yieldNow
        const next = yield* router.submit(Stubborn.to({ params: { key: "new" } }))
        yield* Effect.yieldNow
        yield* gate.open("hold-stubborn")
        expect(yield* next.await).toBe("Committed")
        expect(yield* old.await).toBe("Superseded")
        yield* Effect.yieldNow
        yield* Fiber.interrupt(collector)
        const state = yield* router.state
        expect(published).not.toContain("old")
        if (published.length > 0) expect(published[published.length - 1]).toBe("new")
        expect(Option.getOrThrow(state.presentation)._tag).toBe("Resolved")
      })
    )
  )

  it.effect("a stale worker cannot accept or move history after supersession", () =>
    runWithRouter((router, gate) =>
      Effect.gen(function* () {
        const old = yield* router.submit(RedirectStubborn.to())
        yield* Effect.yieldNow
        const next = yield* router.submit(slow("new"))
        yield* Effect.yieldNow
        yield* gate.open("new")
        expect(yield* next.await).toBe("Committed")
        yield* gate.open("hold-redir")
        expect(yield* old.await).toBe("Superseded")
        const state = yield* router.state
        const location = Option.getOrThrow(state.location)
        expect(location.pathname).toBe("/slow/new")
        const presentation = Option.getOrThrow(state.presentation)
        expect(presentation._tag).toBe("Resolved")
        if (presentation._tag !== "Resolved") throw new Error("expected a resolved presentation")
        const entry = presentation.entries.find((candidate) => candidate.id === "slow")
        expect(entry).toBeDefined()
        if (entry !== undefined && Result.isSuccess(entry.input)) {
          expect(entry.input.success.params).toEqual({ key: "new" })
        }
      })
    )
  )

  it.effect("cancel completes publication even when the cancelling caller is interrupted in a blocked finalizer", () =>
    runWithRouter((router, gate) =>
      Effect.gen(function* () {
        yield* router.awaitInitial
        const handle = yield* router.submit(guarded("cancel"))
        yield* gate.wait("started-cancel")
        const canceller = yield* Effect.forkChild(handle.cancel)
        yield* gate.wait("releasing-cancel")
        const interrupt = yield* Effect.forkChild(Fiber.interrupt(canceller))
        const blocked = yield* router.state
        const retained = Option.getOrThrow(blocked.resolved)
        expect(retained.entries.some((entry) => entry.id === "guarded")).toBe(false)
        yield* gate.open("release-cancel")
        yield* gate.wait("released-cancel")
        yield* Fiber.join(interrupt)
        expect(yield* handle.await).toBe("Cancelled")
        const state = yield* router.state
        expect(state.status._tag).toBe("Cancelled")
        expect(Option.getOrThrow(state.resolved)).toBe(retained)
        expect(yield* router.navigate(Finalize.to())).toBe("Committed")
        const newer = Option.getOrThrow((yield* router.state).resolved)
        yield* handle.cancel
        const afterStaleCancel = yield* router.state
        expect(afterStaleCancel.status._tag).toBe("Committed")
        expect(Option.getOrThrow(afterStaleCancel.resolved)).toBe(newer)
      })
    )
  )

  it.effect("disposes in-flight preparation and runs gate finalizers", () =>
    Effect.gen(function* () {
      const released = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const hold = yield* Deferred.make<void>()
      const DisposalSlow = Router.route("disposalSlow", "/disposal/:x", {
        params: { x: Schema.String },
        prepare: () =>
          Effect.acquireRelease(Deferred.succeed(started, undefined).pipe(Effect.asVoid), () =>
            Deferred.succeed(released, undefined).pipe(Effect.asVoid)
          ).pipe(Effect.andThen(Deferred.await(hold)), Effect.as({ key: "x" }))
      })
      const DisposalApp = Router.make("Disposal", [DisposalSlow, Finalize])
      const gate = yield* makeGate
      const layer = DisposalApp.layer.pipe(
        Layer.provide(MemoryHistory.layer("/disposal/x")),
        Layer.provide(Layer.succeed(Gate, gate))
      )
      const program = Effect.gen(function* () {
        const router = yield* DisposalApp.service
        yield* router.navigate(DisposalSlow.to({ params: { x: "x" } }))
      }).pipe(Effect.provide(layer))
      const fiber = yield* Effect.forkChild(program)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      yield* Deferred.await(released)
    })
  )

  it.effect("router Scope disposal releases a gate and settles its handle without a self-interruption failure", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      const Blocked = Router.route("blocked", "/blocked", {
        prepare: () =>
          Effect.acquireRelease(Deferred.succeed(started, undefined), () =>
            Deferred.succeed(closed, undefined).pipe(Effect.asVoid)
          ).pipe(Effect.andThen(Effect.never))
      })
      const DisposalApp = Router.make("DisposalOutcome", [Router.route("root", "/"), Blocked])
      const accepted = yield* Deferred.make<{
        readonly handle: Router.NavigationHandle
        readonly router: Context.Service.Shape<typeof DisposalApp.service>
      }>()
      const owner = yield* Effect.forkChild(
        Effect.gen(function* () {
          const router = yield* DisposalApp.service
          yield* router.awaitInitial
          const handle = yield* router.submit(Blocked.to())
          yield* Deferred.succeed(accepted, { handle, router })
          return yield* Effect.never
        }).pipe(Effect.provide(DisposalApp.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
      )
      const { handle, router } = yield* Deferred.await(accepted)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(owner)
      expect(yield* Deferred.isDone(closed)).toBe(true)
      expect(yield* handle.await).toBe("Superseded")
      expect((yield* router.state).status._tag).not.toBe("Failed")
      expect(Option.getOrThrow((yield* router.state).presentation)._tag).not.toBe("Failed")
    })
  )

  it.effect("a newer invalid command does not stop an older accepted redirect from committing", () => {
    const RedirectHome = Router.route("redirectHome", "/redirect-home", {
      prepare: () =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* Gate.use((gate) => gate.wait("hold-redir-home"))
            return yield* Effect.fail(Router.redirect(Home.to()))
          })
        )
    })
    const LocalApp = Router.make("RejectAuthority", [Home, RedirectHome])
    const Foreign = Router.route("foreignOnly", "/foreign-only")
    return Effect.gen(function* () {
      const gate = yield* makeGate
      const layer = LocalApp.layer.pipe(
        Layer.provide(MemoryHistory.layer("/")),
        Layer.provide(Layer.succeed(Gate, gate))
      )
      yield* Effect.gen(function* () {
        const router = yield* LocalApp.service
        yield* router.awaitInitial
        const handle = yield* router.submit(RedirectHome.to())
        yield* Effect.yieldNow
        // A newer command is rejected before writing history.
        const error = yield* Effect.flip(router.submit(Foreign.to() as never))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
        yield* gate.open("hold-redir-home")
        expect(yield* handle.await).toBe("Committed")
        const state = yield* router.state
        expect(Option.getOrThrow(state.presentation)._tag).toBe("Resolved")
        expect(state.status).toEqual({ _tag: "Committed", attempt: handle.id })
      }).pipe(Effect.provide(layer), Effect.provideService(Gate, gate))
    })
  })

  it.effect("a failing initial history read fails Layer acquisition with the original error", () => {
    const failure = new History.HistoryError({
      operation: "current",
      message: "no initial location",
      cause: new Error("current failed")
    })
    const history: History.Interface = {
      current: Effect.fail(failure),
      push: () => Effect.die("push is not used"),
      replace: () => Effect.die("replace is not used"),
      go: () => Effect.die("go is not used"),
      changes: Stream.empty
    }
    const FailRoot = Router.route("home", "/")
    const FailApp = Router.make("FailCurrent", [FailRoot])
    const layer = FailApp.layer.pipe(Layer.provide(Layer.succeed(History.History, history)))
    return Effect.gen(function* () {
      expect(yield* Effect.flip(FailApp.service.pipe(Effect.provide(layer)))).toBe(failure)
    })
  })

  const heldInitialHistory = Effect.fnUntraced(function* () {
    const listenerReady = yield* Deferred.make<void>()
    const listenerClosed = yield* Deferred.make<void>()
    const currentStarted = yield* Deferred.make<void>()
    const current = yield* Deferred.make<History.Location, History.HistoryError>()
    const locations = yield* Queue.unbounded<History.Location>()
    const history: History.Interface = {
      current: Deferred.await(listenerReady).pipe(
        Effect.andThen(Deferred.succeed(currentStarted, undefined)),
        Effect.andThen(Deferred.await(current))
      ),
      push: () => Effect.die("push is not used"),
      replace: () => Effect.die("replace is not used"),
      go: () => Effect.die("go is not used"),
      changes: Stream.unwrap(
        Effect.acquireRelease(Deferred.succeed(listenerReady, undefined), () =>
          Deferred.succeed(listenerClosed, undefined).pipe(Effect.asVoid)
        ).pipe(Effect.as(Stream.fromQueue(locations)))
      )
    }
    return { history, current, currentStarted, listenerClosed, locations }
  })

  it.effect("closes the acquired history listener when a held initial read fails", () =>
    Effect.gen(function* () {
      const held = yield* heldInitialHistory()
      const LocalApp = Router.make("ListenerStartupFailure", [Router.route("root", "/")])
      const layer = LocalApp.layer.pipe(Layer.provide(Layer.succeed(History.History, held.history)))
      const build = yield* Effect.forkChild(Effect.exit(LocalApp.service.pipe(Effect.provide(layer))))
      yield* Deferred.await(held.currentStarted)
      expect(yield* Deferred.isDone(held.listenerClosed)).toBe(false)
      const failure = new History.HistoryError({ operation: "current", message: "held read failed", cause: "current" })
      yield* Deferred.fail(held.current, failure)
      const exit = yield* Fiber.join(build)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(failure)
      expect(yield* Deferred.isDone(held.listenerClosed)).toBe(true)
    })
  )

  it.effect("closes an external-event gate and listener when initial read acquisition fails", () =>
    Effect.gen(function* () {
      const held = yield* heldInitialHistory()
      const gateStarted = yield* Deferred.make<void>()
      const gateClosed = yield* Deferred.make<void>()
      const gateRelease = yield* Deferred.make<void>()
      const Event = Router.route("event", "/event", {
        prepare: () =>
          Effect.acquireRelease(Deferred.succeed(gateStarted, undefined), () =>
            Deferred.succeed(gateClosed, undefined).pipe(Effect.asVoid)
          ).pipe(Effect.andThen(Deferred.await(gateRelease)))
      })
      const LocalApp = Router.make("EventStartupFailure", [Event])
      const layer = LocalApp.layer.pipe(Layer.provide(Layer.succeed(History.History, held.history)))
      const build = yield* Effect.forkChild(Effect.exit(LocalApp.service.pipe(Effect.provide(layer))))
      yield* Deferred.await(held.currentStarted)
      yield* Queue.offer(held.locations, {
        ...History.destinationFromHref("/event"),
        state: undefined,
        key: "event",
        index: 1
      })
      yield* Deferred.await(gateStarted)
      expect(yield* Deferred.isDone(gateClosed)).toBe(false)
      const failure = new History.HistoryError({ operation: "current", message: "held read failed", cause: "current" })
      yield* Deferred.fail(held.current, failure)
      const exit = yield* Fiber.join(build)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(failure)
      expect(yield* Deferred.isDone(gateClosed)).toBe(true)
      expect(yield* Deferred.isDone(held.listenerClosed)).toBe(true)
    })
  )

  it.effect("a held initial read cannot supersede a newer external history event", () =>
    Effect.gen(function* () {
      const held = yield* heldInitialHistory()
      const gateStarted = yield* Deferred.make<void>()
      const gateRelease = yield* Deferred.make<void>()
      const Root = Router.route("root", "/")
      const Event = Router.route("event", "/event", {
        prepare: () => Deferred.succeed(gateStarted, undefined).pipe(Effect.andThen(Deferred.await(gateRelease)))
      })
      const LocalApp = Router.make("InitialReadOrdering", [Root, Event])
      const layer = LocalApp.layer.pipe(Layer.provide(Layer.succeed(History.History, held.history)))
      const program = yield* Effect.forkChild(
        Effect.gen(function* () {
          const router = yield* LocalApp.service
          const state = yield* router.state
          expect(Option.getOrThrow(state.location).pathname).toBe("/event")
          expect(Option.getOrThrow(state.presentation)._tag).toBe("Pending")
          expect("entries" in Option.getOrThrow(state.presentation)).toBe(false)
          yield* router.awaitInitial
          expect((yield* router.state).status._tag).toBe("Pending")
          yield* Deferred.succeed(gateRelease, undefined)
          const committed = yield* router.changes.pipe(
            Stream.filter((snapshot) => snapshot.status._tag === "Committed"),
            Stream.runHead
          )
          expect(Option.getOrThrow(Option.getOrThrow(committed).location).pathname).toBe("/event")
        }).pipe(Effect.provide(layer))
      )
      yield* Deferred.await(held.currentStarted)
      yield* Queue.offer(held.locations, {
        ...History.destinationFromHref("/event"),
        state: undefined,
        key: "event",
        index: 1
      })
      yield* Deferred.await(gateStarted)
      yield* Deferred.succeed(held.current, {
        ...History.destinationFromHref("/"),
        state: undefined,
        key: "initial",
        index: 0
      })
      yield* Fiber.join(program)
      expect(yield* Deferred.isDone(held.listenerClosed)).toBe(true)
    })
  )

  const controlledHistory = (
    writes: Queue.Queue<Deferred.Deferred<History.Location, History.HistoryError>>
  ): History.Interface => {
    const enqueue = () =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<History.Location, History.HistoryError>()
        yield* Queue.offer(writes, deferred)
        return yield* Deferred.await(deferred)
      })
    return {
      current: Effect.succeed({ ...History.destinationFromHref("/"), state: undefined, key: "init", index: 0 }),
      push: enqueue,
      replace: enqueue,
      go: () => Effect.die("go is not used"),
      changes: Stream.empty
    }
  }

  it.effect("an older held write failure cannot overwrite a newer committed status", () => {
    const CommitRoot = Router.route("home", "/")
    const CommitA = Router.route("a", "/a", { prepare: () => Effect.void })
    const CommitB = Router.route("b", "/b", { prepare: () => Effect.void })
    const CommitApp = Router.make("HeldWriteCommit", [CommitRoot, CommitA, CommitB])
    return Effect.gen(function* () {
      const writes = yield* Queue.unbounded<Deferred.Deferred<History.Location, History.HistoryError>>()
      const layer = CommitApp.layer.pipe(Layer.provide(Layer.succeed(History.History, controlledHistory(writes))))
      yield* Effect.gen(function* () {
        const router = yield* CommitApp.service
        yield* router.awaitInitial
        const fiberA = yield* Effect.forkChild(router.submit(CommitA.to()))
        const writeA = yield* Queue.take(writes)
        const fiberB = yield* Effect.forkChild(router.submit(CommitB.to()))
        const writeB = yield* Queue.take(writes)
        // B's write resolves first, so B commits before the older A write fails.
        yield* Deferred.succeed(writeB, {
          ...History.destinationFromHref("/b"),
          state: undefined,
          key: "kb",
          index: 1
        })
        const handleB = yield* Fiber.join(fiberB)
        expect(yield* handleB.await).toBe("Committed")
        yield* Deferred.fail(
          writeA,
          new History.HistoryError({ operation: "push", message: "held write failed", cause: new Error("held") })
        )
        const exitA = yield* Effect.exit(Fiber.join(fiberA))
        expect(Exit.isFailure(exitA)).toBe(true)
        const state = yield* router.state
        // The newer committed status survives the older write failure.
        expect(state.status._tag).toBe("Committed")
      }).pipe(Effect.provide(layer))
    })
  })

  it.effect("held history and foreign command failures leave the committed snapshot untouched", () => {
    const RejectRoot = Router.route("home", "/")
    const RejectA = Router.route("a", "/a", { prepare: () => Effect.void })
    const Foreign = Router.route("foreignOnly", "/foreign-only")
    const RejectApp = Router.make("HeldWriteReject", [RejectRoot, RejectA])
    return Effect.gen(function* () {
      const writes = yield* Queue.unbounded<Deferred.Deferred<History.Location, History.HistoryError>>()
      const layer = RejectApp.layer.pipe(Layer.provide(Layer.succeed(History.History, controlledHistory(writes))))
      yield* Effect.gen(function* () {
        const router = yield* RejectApp.service
        yield* router.awaitInitial
        const before = yield* router.state
        const fiberA = yield* Effect.forkChild(router.submit(RejectA.to()))
        const writeA = yield* Queue.take(writes)
        expect((yield* router.state).status).toBe(before.status)
        // A newer foreign command is rejected.
        const rejection = yield* Effect.flip(router.submit(Foreign.to() as never))
        expect(rejection).toBeInstanceOf(Router.RouteEncodeError)
        // Neither failure was accepted, so neither may publish anything.
        yield* Deferred.fail(
          writeA,
          new History.HistoryError({ operation: "push", message: "held write failed", cause: new Error("held") })
        )
        const exitA = yield* Effect.exit(Fiber.join(fiberA))
        expect(Exit.isFailure(exitA)).toBe(true)
        const state = yield* router.state
        expect(state).toStrictEqual(before)
        expect(state.status).toBe(before.status)
      }).pipe(Effect.provide(layer))
    })
  })

  it.effect("an older history failure cannot cancel a newer accepted pending attempt", () =>
    Effect.gen(function* () {
      const writes = yield* Queue.unbounded<Deferred.Deferred<History.Location, History.HistoryError>>()
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const Root = Router.route("root", "/")
      const Old = Router.route("old", "/old")
      const Fresh = Router.route("fresh", "/fresh", {
        prepare: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      const LocalApp = Router.make("PendingWriteFailure", [Root, Old, Fresh])
      const layer = LocalApp.layer.pipe(Layer.provide(Layer.succeed(History.History, controlledHistory(writes))))
      yield* Effect.gen(function* () {
        const router = yield* LocalApp.service
        yield* router.awaitInitial
        const old = yield* Effect.forkChild(router.submit(Old.to()))
        const oldWrite = yield* Queue.take(writes)
        const fresh = yield* Effect.forkChild(router.submit(Fresh.to()))
        const freshWrite = yield* Queue.take(writes)
        yield* Deferred.succeed(freshWrite, {
          ...History.destinationFromHref("/fresh"),
          state: undefined,
          key: "fresh",
          index: 1
        })
        const handle = yield* Fiber.join(fresh)
        yield* Deferred.await(started)
        const pending = yield* router.state
        expect(pending.status).toEqual({ _tag: "Pending", attempt: handle.id })
        yield* Deferred.fail(
          oldWrite,
          new History.HistoryError({ operation: "push", message: "old failed", cause: "old" })
        )
        expect(Exit.isFailure(yield* Effect.exit(Fiber.join(old)))).toBe(true)
        expect((yield* router.state).status).toBe(pending.status)
        expect((yield* router.state).presentation).toBe(pending.presentation)
        yield* Deferred.succeed(release, undefined)
        expect(yield* handle.await).toBe("Committed")
        expect((yield* router.state).status).toEqual({ _tag: "Committed", attempt: handle.id })
      }).pipe(Effect.provide(layer))
    })
  )
})
