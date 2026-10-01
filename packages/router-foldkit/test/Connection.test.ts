import { describe, expect, it } from "@effect/vitest"
import { MemoryHistory } from "@effect-stack/router"
import * as History from "@effect-stack/router/History"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { create, RouterMessage, type State } from "@effect-stack/router-foldkit"

interface Model {
  readonly router: State
  readonly untouched: number
}
interface Message {
  readonly _tag: "Router"
  readonly message: RouterMessage
}
const renderer = () =>
  create<Model, Message>({
    getState: (model) => model.router,
    setState: (model, router) => ({ ...model, router }),
    toMessage: (message) => ({ _tag: "Router", message })
  })

const fixture = Effect.gen(function* () {
  const entered = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const closed = yield* Ref.make(0)
  const acquired = yield* Ref.make(0)
  const historyClosed = yield* Ref.make(0)
  const allowed = yield* Ref.make(false)
  const routes = renderer()
  const Home = routes.route("home", "/", { render: ({ h }) => h.div([], ["Home"]) })
  const Slow = routes.route("slow", "/slow/:id", {
    params: { id: Schema.FiniteFromString },
    prepare: () =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () => Ref.update(closed, (n) => n + 1))
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(release)
      }),
    render: ({ h, input }) => h.div([], [String(input.params.id)])
  })
  const Denied = routes.route("denied", "/denied", {
    prepare: () => Ref.get(allowed).pipe(Effect.flatMap((ok) => (ok ? Effect.void : Effect.fail({ code: "denied" })))),
    errorSchema: Schema.Struct({ code: Schema.String }),
    error: ({ h, failure }) => h.div([], [failure._tag === "Domain" ? failure.error.code : "diagnostic"]),
    render: ({ h }) => h.div([], ["Allowed"])
  })
  const App = routes.make("ConnectionTest", [Home, Slow, Denied])
  const layer = App.layer.pipe(
    Layer.provide(
      MemoryHistory.layer("/").pipe(Layer.tap(() => Effect.addFinalizer(() => Ref.update(historyClosed, (n) => n + 1))))
    ),
    Layer.tap(() => Ref.update(acquired, (n) => n + 1))
  )
  const connection = App.connect(layer, { linkRoot: false })
  const context = yield* Layer.build(connection.resources)
  const messages = yield* Queue.unbounded<Message>()
  const latest = yield* Ref.make(App.initialState)
  const stream = connection.subscriptions.router.dependenciesToStream({}, () => ({}))
  const start = stream.pipe(
    Stream.runForEach((message) =>
      Effect.gen(function* () {
        if (message.message._tag === "RouterStateChanged") yield* Ref.set(latest, message.message.state)
        yield* Queue.offer(messages, message)
      })
    ),
    Effect.provideContext(context),
    Effect.forkScoped
  )
  const subscription = yield* start
  const next = (predicate: (state: State) => boolean): Effect.Effect<State> =>
    Effect.gen(function* () {
      while (true) {
        const { message } = yield* Queue.take(messages)
        if (message._tag === "RouterStateChanged" && predicate(message.state)) return message.state
      }
    })
  const model: Model = { router: App.initialState, untouched: 42 }
  const run = (message: Message) => {
    const command = App.update(model, message.message).commands?.[0]
    if (command === undefined) throw new Error("Expected router command")
    expect(command.name).toBe("EffectStack.Router")
    return command.effect.pipe(Effect.provideContext(context))
  }
  expect((yield* next(() => true)).connection).toBe("Connecting")
  const initial = yield* next((state) => state.status === "Committed")
  return {
    App,
    Home,
    Slow,
    Denied,
    entered,
    release,
    closed,
    acquired,
    historyClosed,
    allowed,
    subscription,
    start,
    next,
    model,
    run,
    initial,
    latest
  }
})

const outcome = (message: Message) => {
  expect(message._tag).toBe("Router")
  const result = message.message
  if (result._tag !== "CompletedRouterCommand") throw new Error("Expected completion")
  expect(Schema.decodeUnknownSync(RouterMessage)(result)).toEqual(result)
  return result
}

describe("Foldkit router connection", () => {
  it.effect("keeps the newer cancellation handle when an older history write completes last", () =>
    Effect.gen(function* () {
      const writeStarted = yield* Deferred.make<void>()
      const finishWrite = yield* Deferred.make<void>()
      const gateStarted = yield* Deferred.make<void>()
      const gateRelease = yield* Deferred.make<void>()
      const routes = renderer()
      const Home = routes.route("home", "/", { empty: true })
      const Older = routes.route("older", "/older", { empty: true })
      const Newer = routes.route("newer", "/newer", {
        empty: true,
        prepare: () => Deferred.succeed(gateStarted, undefined).pipe(Effect.andThen(Deferred.await(gateRelease)))
      })
      const App = routes.make("OutOfOrderHistory", [Home, Older, Newer])
      const history = Layer.effect(
        History.History,
        Effect.gen(function* () {
          const memory = yield* MemoryHistory.make("/")
          return {
            ...memory,
            push: Effect.fn("DeferredHistory.push")(function* (destination: History.Destination) {
              if (destination.pathname === "/older") {
                yield* Deferred.succeed(writeStarted, undefined)
                yield* Deferred.await(finishWrite)
              }
              return yield* memory.push(destination)
            })
          }
        })
      )
      const connection = App.connect(App.layer.pipe(Layer.provide(history)), { linkRoot: false })
      const context = yield* Layer.build(connection.resources)
      const messages = yield* Queue.unbounded<Message>()
      yield* connection.subscriptions.router
        .dependenciesToStream({}, () => ({}))
        .pipe(
          Stream.runForEach((message) => Queue.offer(messages, message)),
          Effect.provideContext(context),
          Effect.forkScoped
        )
      const next = Effect.fnUntraced(function* (predicate: (state: State) => boolean) {
        while (true) {
          const { message } = yield* Queue.take(messages)
          if (message._tag === "RouterStateChanged" && predicate(message.state)) return message.state
        }
      })
      const run = (message: Message) => {
        const command = Option.getOrThrow(
          Option.fromNullishOr(App.update({ router: App.initialState, untouched: 1 }, message.message).commands?.[0])
        )
        return command.effect.pipe(Effect.provideContext(context))
      }
      yield* next((state) => state.status === "Committed")
      const older = yield* run(App.navigate(Older.to())).pipe(Effect.forkScoped)
      yield* Deferred.await(writeStarted)
      const newer = yield* run(App.navigate(Newer.to())).pipe(Effect.forkScoped)
      yield* Deferred.await(gateStarted)
      const pending = yield* next((state) => state.status === "Pending" && state.location?.pathname === "/newer")
      yield* Deferred.succeed(finishWrite, undefined)
      expect(outcome(yield* Fiber.join(older)).outcome).toBe("Superseded")
      yield* run(App.cancel(Option.getOrThrow(Option.fromNullishOr(pending.attempt))))
      expect((yield* next((state) => state.status === "Cancelled")).attempt).toBe(pending.attempt)
      expect(outcome(yield* Fiber.join(newer)).outcome).toBe("Cancelled")
    }).pipe(Effect.scoped)
  )

  it.effect(
    "shares one executable service between snapshots and mapped commands, retaining displayed input while pending",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture
        expect(yield* Ref.get(f.acquired)).toBe(1)
        expect(Option.isSome(f.App.input(f.initial, f.Home))).toBe(true)
        const waiting = yield* f.run(f.App.navigate(f.Slow.to({ params: { id: 12 } }))).pipe(Effect.forkScoped)
        yield* Deferred.await(f.entered)
        const pending = yield* f.next((state) => state.status === "Pending")
        expect(pending.location?.pathname).toBe("/slow/12")
        expect(Option.getOrThrow(f.App.input(pending, f.Home)).location.pathname).toBe("/")
        expect(Option.isNone(f.App.input(pending, f.Slow))).toBe(true)
        yield* Deferred.succeed(f.release, undefined)
        expect(outcome(yield* Fiber.join(waiting)).outcome).toBe("Committed")
        const committed = yield* f.next((state) => state.status === "Committed")
        expect(Option.getOrThrow(f.App.input(committed, f.Slow)).params.id).toBe(12)
        expect(f.App.update(f.model, { _tag: "RouterStateChanged", state: committed }).model).toEqual({
          router: committed,
          untouched: 42
        })
        expect(yield* Ref.get(f.acquired)).toBe(1)
      }).pipe(Effect.scoped)
  )

  it.effect("supersedes pending work, closes its gate, and makes cancellation of its stale attempt a no-op", () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const waiting = yield* f.run(f.App.navigate(f.Slow.to({ params: { id: 1 } }))).pipe(Effect.forkScoped)
      yield* Deferred.await(f.entered)
      const pending = yield* f.next((state) => state.status === "Pending")
      expect(outcome(yield* f.run(f.App.navigate(f.Home.to()))).outcome).toBe("Committed")
      expect(outcome(yield* Fiber.join(waiting)).outcome).toBe("Superseded")
      const committed = yield* f.next((state) => state.status === "Committed")
      expect(committed.location?.pathname).toBe("/")
      const attempt = Option.getOrThrow(Option.fromNullishOr(pending.attempt))
      expect(outcome(yield* f.run(f.App.cancel(attempt))).outcome).toBe("Accepted")
      expect(yield* Ref.get(f.latest)).toEqual(committed)
      expect(yield* Ref.get(f.closed)).toBe(1)
    }).pipe(Effect.scoped)
  )

  it.effect(
    "keeps accepted work alive when its command waiter is interrupted, and still permits explicit cancellation",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture
        const waiting = yield* f.run(f.App.navigate(f.Slow.to({ params: { id: 2 } }))).pipe(Effect.forkScoped)
        yield* Deferred.await(f.entered)
        const pending = yield* f.next((state) => state.status === "Pending")
        yield* Fiber.interrupt(waiting)
        expect(yield* Ref.get(f.closed)).toBe(0)
        const attempt = Option.getOrThrow(Option.fromNullishOr(pending.attempt))
        expect(outcome(yield* f.run(f.App.cancel(attempt))).outcome).toBe("Accepted")
        const cancelled = yield* f.next((state) => state.status === "Cancelled")
        expect(cancelled.attempt).toBe(pending.attempt)
        expect(yield* Ref.get(f.closed)).toBe(1)
      }).pipe(Effect.scoped)
  )

  it.effect("serializes typed gate failures and retries through the same connected service", () =>
    Effect.gen(function* () {
      const f = yield* fixture
      expect(outcome(yield* f.run(f.App.navigate(f.Denied.to()))).outcome).toBe("Rejected")
      const failed = yield* f.next((state) => state.status === "Failed")
      expect(failed.connection).toBe("Ready")
      expect(failed.entries[0]?.failure).toEqual({ _tag: "Domain", error: '{"code":"denied"}' })
      yield* Ref.set(f.allowed, true)
      expect(outcome(yield* f.run(f.App.retry())).outcome).toBe("Committed")
      const committed = yield* f.next((state) => state.status === "Committed")
      expect(committed.entries[0]?.failure).toBeNull()
      expect(committed.location?.pathname).toBe("/denied")
      expect(yield* Ref.get(f.acquired)).toBe(1)
    }).pipe(Effect.scoped)
  )

  it.effect("rejects malformed preacceptance commands without changing the displayed snapshot", () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const intent = f.App.navigate(f.Home.to()).message
      if (intent._tag !== "RequestedNavigation") throw new Error("Expected navigation")
      const rejected = outcome(
        yield* f.run({ _tag: "Router", message: { ...intent, request: { ...intent.request, id: "foreign" } } })
      )
      expect(rejected.outcome).toBe("Rejected")
      expect(rejected.diagnostic?.operation).toBe("command")
      expect(f.App.update({ ...f.model, router: f.initial }, rejected).model.router).toBe(f.initial)
      expect(yield* Ref.get(f.latest)).toEqual(f.initial)
      // A subsequent refresh sees the same service and location, not a poisoned connection.
      expect(outcome(yield* f.run(f.App.refresh())).outcome).toBe("Committed")
      const committed = yield* f.next((state) => state.status === "Committed")
      expect(committed.location?.pathname).toBe("/")
    }).pipe(Effect.scoped)
  )

  it.effect("tears down pending gates with the stream and reacquires cleanly when the subscription restarts", () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const waiting = yield* f.run(f.App.navigate(f.Slow.to({ params: { id: 3 } }))).pipe(Effect.forkScoped)
      yield* Deferred.await(f.entered)
      yield* f.next((state) => state.status === "Pending")
      yield* Fiber.interrupt(f.subscription)
      expect(yield* Ref.get(f.closed)).toBe(1)
      expect(yield* Ref.get(f.historyClosed)).toBe(1)
      expect(outcome(yield* f.run(f.App.retry())).outcome).toBe("Rejected")
      yield* Deferred.succeed(f.release, undefined)
      yield* f.start
      expect((yield* f.next(() => true)).connection).toBe("Connecting")
      const restarted = yield* f.next((state) => state.status === "Committed")
      expect(restarted.connection).toBe("Ready")
      expect(restarted.location?.pathname).toBe("/")
      expect(yield* Ref.get(f.acquired)).toBe(2)
      yield* Fiber.interrupt(waiting)
    }).pipe(Effect.scoped)
  )

  it("rejects copied and foreign definitions and ignores messages for a different application", () => {
    const routes = renderer()
    const Home = routes.route("home", "/", { empty: true })
    const Foreign = routes.route("foreign", "/foreign", { empty: true })
    const App = routes.make("Ownership", [Home])
    expect(() => App.input(App.initialState, { ...Home })).toThrow()
    expect(() => App.input(App.initialState, Foreign)).toThrow()
    expect(() => App.navigate(Foreign.to() as unknown as ReturnType<typeof Home.to>)).toThrow()
    const model = { router: App.initialState, untouched: 42 }
    expect(
      App.update(model, {
        _tag: "RouterStateChanged",
        state: Object.assign({}, App.initialState, { applicationId: "other" })
      })
    ).toEqual({ model })
    expect(
      App.update(model, { _tag: "RequestedRouterCommand", applicationId: "other", command: "Retry", value: 0 })
    ).toEqual({ model })
  })

  it.effect("reports startup acquisition failures as snapshots and closes already acquired resources", () =>
    Effect.gen(function* () {
      const routes = renderer()
      const Home = routes.route("home", "/", { empty: true })
      const App = routes.make("StartupFailure", [Home])
      const closed = yield* Deferred.make<void>()
      const failing = Layer.effect(
        App.service,
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.void, () => Deferred.succeed(closed, undefined))
          return yield* Effect.fail("startup unavailable")
        })
      )
      const connection = App.connect(failing, { linkRoot: false })
      const context = yield* Layer.build(connection.resources)
      const messages = yield* Queue.unbounded<Message>()
      yield* connection.subscriptions.router
        .dependenciesToStream({}, () => ({}))
        .pipe(
          Stream.runForEach((message) => Queue.offer(messages, message)),
          Effect.provideContext(context),
          Effect.forkScoped
        )
      expect((yield* Queue.take(messages)).message).toMatchObject({
        _tag: "RouterStateChanged",
        state: { connection: "Connecting" }
      })
      const failed = (yield* Queue.take(messages)).message
      expect(failed).toMatchObject({
        _tag: "RouterStateChanged",
        state: {
          connection: "StartupFailed",
          display: "RouterFailure",
          status: "Idle",
          attempt: null,
          diagnostic: { operation: "startup", reasons: ["Failure"] }
        }
      })
      yield* Deferred.await(closed)
      const command = Option.getOrThrow(
        Option.fromNullishOr(App.update({ router: App.initialState, untouched: 1 }, App.retry().message).commands?.[0])
      )
      expect(outcome(yield* command.effect.pipe(Effect.provideContext(context))).outcome).toBe("Rejected")
    }).pipe(Effect.scoped)
  )

  it.effect("rejects an executable service from a different canonical application, even when its id matches", () =>
    Effect.gen(function* () {
      const routes = renderer()
      const Home = routes.route("home", "/", { empty: true })
      const App = routes.make("SameName", [Home])
      const Other = routes.make("SameName", [Home])
      const closed = yield* Deferred.make<void>()
      const wrong = Layer.effect(
        App.service,
        Effect.gen(function* () {
          const context = yield* Layer.build(Other.layer.pipe(Layer.provide(MemoryHistory.layer("/"))))
          yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined))
          // The service identifiers coincide by application id; the runtime token must still be checked.
          return Context.get(context, Other.service)
        })
      )
      const connection = App.connect(wrong, { linkRoot: false })
      const context = yield* Layer.build(connection.resources)
      const messages = yield* Queue.unbounded<Message>()
      yield* connection.subscriptions.router
        .dependenciesToStream({}, () => ({}))
        .pipe(
          Stream.runForEach((message) => Queue.offer(messages, message)),
          Effect.provideContext(context),
          Effect.forkScoped
        )
      yield* Queue.take(messages)
      const failed = (yield* Queue.take(messages)).message
      expect(failed).toMatchObject({
        _tag: "RouterStateChanged",
        state: {
          connection: "StartupFailed",
          diagnostic: {
            operation: "startup"
          }
        }
      })
      if (failed._tag !== "RouterStateChanged") throw new Error("Expected startup snapshot")
      expect(failed.state.diagnostic?.message).toContain("Router connection does not belong to this application")
      yield* Deferred.await(closed)
    }).pipe(Effect.scoped)
  )
})
