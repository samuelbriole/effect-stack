import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { MemoryHistory, Router } from "@effect-stack/router"

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

const Routes = Router.schema("Conc", {
  home: "/",
  slow: {
    path: "/slow/:key",
    params: { key: Schema.String },
    success: Schema.Struct({ key: Schema.String })
  },
  guarded: {
    path: "/guarded/:key",
    params: { key: Schema.String },
    success: Schema.Struct({ key: Schema.String })
  },
  stubborn: {
    path: "/stubborn/:key",
    params: { key: Schema.String },
    success: Schema.Struct({ key: Schema.String })
  },
  redirectStubborn: { path: "/redirect-stubborn", success: Schema.Void },
  badRelease: { path: "/bad-release", success: Schema.Void },
  finalize: { path: "/finalize", success: Schema.Void }
})

const events: Array<string> = []

const SlowLive = Router.route(Routes.slow, ({ params }) =>
  Gate.use((gate) => gate.wait(params.key).pipe(Effect.as({ key: params.key })))
)

const FinalizeLive = Router.route(Routes.finalize, () =>
  Effect.acquireRelease(
    Effect.sync(() => {
      events.push("acquire")
    }),
    () =>
      Effect.sync(() => {
        events.push("release")
      })
  )
)

// Acquires, waits for a hold gate, and blocks its release on a separate gate so
// a supersession interrupt parks inside handler cleanup. Only the "old" key
// blocks its release, keeping the superseding attempt free to finish.
const GuardedLive = Router.route(Routes.guarded, ({ params }) =>
  Effect.acquireRelease(Effect.void, () =>
    params.key === "old" ? Gate.use((gate) => gate.wait("release-old")) : Effect.void
  ).pipe(Effect.andThen(Gate.use((gate) => gate.wait(`hold-${params.key}`))), Effect.as({ key: params.key }))
)

// A handler whose scoped release dies: successful work followed by failed
// cleanup must not publish data.
const BadReleaseLive = Router.route(Routes.badRelease, () =>
  Effect.acquireRelease(Effect.void, () => Effect.die(new Error("release-boom")))
)

// A handler that ignores interruption and completes even after it was
// superseded, exercising the ownership gate on the success publication path.
const StubbornLive = Router.route(Routes.stubborn, ({ params }) =>
  Effect.uninterruptible(Gate.use((gate) => gate.wait("hold-stubborn"))).pipe(Effect.as({ key: params.key }))
)

// Ignores interruption end-to-end and only reaches its redirect write after
// supersession.
const RedirectStubbornLive = Router.route(Routes.redirectStubborn, () =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      yield* Gate.use((gate) => gate.wait("hold-redir"))
      return yield* Effect.fail(Router.redirect(Routes.slow({ params: { key: "target" } })))
    })
  )
)

const features = Layer.mergeAll(SlowLive, FinalizeLive, GuardedLive, BadReleaseLive, StubbornLive, RedirectStubbornLive)

const slow = (key: string) => Routes.slow({ params: { key } })
const guarded = (key: string) => Routes.guarded({ params: { key } })
const stubborn = (key: string) => Routes.stubborn({ params: { key } })

const runWithRouter = <A, E, R>(
  program: (router: Router.RouterService<unknown>, gate: Context.Service.Shape<typeof Gate>) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const gate = yield* makeGate
    const layer = Router.layer(Routes).pipe(
      Layer.provide(features),
      Layer.provide(MemoryHistory.layer("/")),
      Layer.provide(Layer.succeed(Gate, gate))
    )
    const programWithRouter = Effect.gen(function* () {
      const router = yield* Routes.service
      return yield* program(router as Router.RouterService<unknown>, gate)
    })
    return yield* programWithRouter.pipe(Effect.provide(layer), Effect.provideService(Gate, gate)) as Effect.Effect<
      A,
      E,
      R
    >
  }) as Effect.Effect<A, E, R>

const resolvedKey = (state: Router.RouterState<unknown>): string | undefined => {
  const presentation = Option.getOrUndefined(state.presentation)
  if (presentation === undefined || presentation._tag !== "Resolved") return undefined
  const entry = presentation.entries.find((candidate) => candidate.id === "slow")
  if (entry === undefined) return undefined
  const data = AsyncResult.value(entry.data)
  return Option.isSome(data) ? (data.value as { readonly key: string }).key : undefined
}

const awaitResolvedKey = (router: Router.RouterService<unknown>, key: string): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    for (let index = 0; index < 500; index++) {
      const state = yield* router.state
      const value = resolvedKey(state)
      if (value === key) return value
      yield* Effect.yieldNow
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${key}`))
  })

const awaitEntrySuccess = (router: Router.RouterService<unknown>, id: string): Effect.Effect<unknown, Error> =>
  Effect.gen(function* () {
    for (let index = 0; index < 500; index++) {
      const state = yield* router.state
      const presentation = Option.getOrUndefined(state.presentation)
      if (presentation !== undefined && presentation._tag === "Resolved") {
        const entry = presentation.entries.find((candidate) => candidate.id === id)
        if (entry !== undefined && AsyncResult.isSuccess(entry.data)) return entry.data.value
      }
      yield* Effect.yieldNow
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${id}`))
  })

describe("Router concurrency", () => {
  it.effect("closes handler scopes before publishing resolved data", () =>
    Effect.gen(function* () {
      events.length = 0
      const gate = yield* makeGate
      const layer = Router.layer(Routes).pipe(
        Layer.provide(features),
        Layer.provide(MemoryHistory.layer("/")),
        Layer.provide(Layer.succeed(Gate, gate))
      )
      yield* Effect.gen(function* () {
        const router = yield* Routes.service
        yield* router.navigate(Routes.finalize())
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
        // Cancellation must not leave the snapshot Pending forever, and a
        // newer attempt must be able to supersede it cleanly.
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
        const first = yield* Effect.forkChild(router.navigate(slow("e")))
        yield* Effect.yieldNow
        const destination = slow("e")
        const invalid = {
          ...destination,
          input: { params: { key: 1 }, search: {}, hash: undefined }
        } as unknown as typeof destination
        const error = yield* Effect.flip(router.navigate(invalid))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
        yield* gate.open("e")
        expect(yield* Fiber.join(first)).toBe("Committed")
        const state = yield* router.state
        expect(resolvedKey(state)).toBe("e")
      })
    )
  )

  it.effect("supersession completes the handoff even when the caller is interrupted in a blocked finalizer", () =>
    runWithRouter((router, gate) =>
      Effect.gen(function* () {
        const old = yield* router.submit(guarded("old"))
        yield* Effect.yieldNow
        // Supersede from a caller that is interrupted immediately: the new
        // attempt must still own the active slot and run to completion, while
        // the older attempt's finalizer stays blocked until we release it.
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

  it.effect("treats a failed handler finalizer as a failed preparation and stays usable", () =>
    runWithRouter((router) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(router.navigate(Routes.badRelease()))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(true)
        }
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
        expect(presentation.owner).toBe("badRelease")
        yield* router.navigate(Routes.finalize())
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
                const data = AsyncResult.value(entry.data)
                if (Option.isSome(data)) published.push((data.value as { readonly key: string }).key)
              })
            )
          )
        )
        const old = yield* router.submit(stubborn("old"))
        yield* Effect.yieldNow
        const next = yield* router.submit(stubborn("new"))
        yield* Effect.yieldNow
        // Release both handlers; the older one ignores interruption and reaches
        // its success publication path after the newer attempt was accepted.
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
        const old = yield* router.submit(Routes.redirectStubborn())
        yield* Effect.yieldNow
        const next = yield* router.submit(slow("new"))
        yield* Effect.yieldNow
        yield* gate.open("new")
        expect(yield* next.await).toBe("Committed")
        // The older worker ignores interruption and only now produces its
        // redirect. It is stale, so it must neither publish pending state nor
        // replace history with its target.
        yield* gate.open("hold-redir")
        expect(yield* old.await).toBe("Superseded")
        const state = yield* router.state
        const location = Option.getOrThrow(state.location)
        expect(location.pathname).toBe("/slow/new")
        const presentation = Option.getOrThrow(state.presentation)
        expect(presentation._tag).toBe("Resolved")
        const entry = presentation.entries.find((candidate) => candidate.id === "slow")
        expect(entry !== undefined && AsyncResult.isSuccess(entry.data)).toBe(true)
        if (entry !== undefined && AsyncResult.isSuccess(entry.data)) {
          expect(entry.data.value).toEqual({ key: "new" })
        }
      })
    )
  )

  it.effect("cancel completes publication even when the cancelling caller is interrupted in a blocked finalizer", () =>
    runWithRouter((router, gate) =>
      Effect.gen(function* () {
        const handle = yield* router.submit(guarded("cancel"))
        yield* Effect.yieldNow
        const canceller = yield* Effect.forkChild(handle.cancel)
        yield* Effect.yieldNow
        // Model a caller interruption while the worker's finalizer is blocked.
        // The uninterruptible cancel sequence must still publish a terminal
        // status rather than leaving the snapshot Pending.
        yield* Effect.forkChild(Fiber.interrupt(canceller))
        for (let index = 0; index < 10; index++) yield* Effect.yieldNow
        yield* gate.open("release-cancel")
        expect(yield* handle.await).toBe("Cancelled")
        const state = yield* router.state
        expect(state.status._tag).toBe("Cancelled")
      })
    )
  )

  it.effect("disposes in-flight preparation and runs handler finalizers", () =>
    Effect.gen(function* () {
      const released = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const hold = yield* Deferred.make<void>()
      const DisposalLive = Router.route(Routes.slow, () =>
        Effect.acquireRelease(Deferred.succeed(started, undefined).pipe(Effect.asVoid), () =>
          Deferred.succeed(released, undefined).pipe(Effect.asVoid)
        ).pipe(Effect.andThen(Deferred.await(hold)), Effect.as({ key: "x" }))
      )
      const gate = yield* makeGate
      const layer = Router.layer(Routes).pipe(
        Layer.provide(Layer.merge(features, DisposalLive)),
        Layer.provide(MemoryHistory.layer("/slow/x")),
        Layer.provide(Layer.succeed(Gate, gate))
      )
      const program = Effect.gen(function* () {
        const router = yield* Routes.service
        yield* router.navigate(slow("x"))
      }).pipe(Effect.provide(layer))
      const fiber = yield* Effect.forkChild(program)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      yield* Deferred.await(released)
    })
  )
})
