import * as Mutation from "@effect-stack/query/Mutation"
import * as Query from "@effect-stack/query/Query"
import * as QueryAtom from "@effect-stack/query/QueryAtom"
import * as QueryClient from "@effect-stack/query/QueryClient"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

describe("review regressions", () => {
  it.effect("turns synchronous query and mutation throws into terminal state", () =>
    Effect.gen(function*() {
      const defect = new Error("synchronous defect")
      const query = Query.make({
        name: "throwing-query",
        load: (): Effect.Effect<string> => {
          throw defect
        }
      })
      const mutation = Mutation.make({
        name: "throwing-mutation",
        execute: (): Effect.Effect<string> => {
          throw defect
        }
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(query)({})
      const queryExit = yield* resource.get.pipe(Effect.exit)
      expect(Exit.isFailure(queryExit) && Cause.hasDies(queryExit.cause)).toBe(true)
      expect((yield* resource.snapshot)._tag).toBe("Failure")

      const handle = yield* client.mutation(mutation)
      const mutationExit = yield* handle.execute({}).pipe(Effect.exit)
      expect(Exit.isFailure(mutationExit) && Cause.hasDies(mutationExit.cause)).toBe(true)
      expect((yield* handle.snapshot).pendingCount).toBe(0)
    }))

  it.effect("publishes a query result only after forked child finalizers", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const finalized = yield* Deferred.make<void>()
      const query = Query.make({
        name: "query-child-finalizer",
        load: () =>
          Effect.gen(function*() {
            yield* Effect.acquireRelease(
              Deferred.succeed(started, undefined),
              () => Deferred.succeed(finalized, undefined)
            ).pipe(Effect.andThen(Effect.never), Effect.forkChild({ startImmediately: true }))
            yield* Deferred.await(started)
            return "done"
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      expect(yield* client.query(query)({}).get).toBe("done")
      expect(yield* Deferred.isDone(finalized)).toBe(true)
    }))

  it.effect("settles mutation await only after forked child finalizers", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const finalized = yield* Deferred.make<void>()
      const mutation = Mutation.make({
        name: "mutation-child-finalizer",
        execute: () =>
          Effect.gen(function*() {
            yield* Effect.acquireRelease(
              Deferred.succeed(started, undefined),
              () => Deferred.succeed(finalized, undefined)
            ).pipe(Effect.andThen(Effect.never), Effect.forkChild({ startImmediately: true }))
            yield* Deferred.await(started)
            return "done"
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const handle = yield* client.mutation(mutation)
      const invocation = yield* handle.start({})
      expect(yield* invocation.await).toBe("done")
      expect(yield* Deferred.isDone(finalized)).toBe(true)
    }))

  it.effect("uses one structural cache entry for equal records and arrays", () =>
    Effect.gen(function*() {
      let calls = 0
      const query = Query.make({
        name: "structural",
        staleTime: "1 minute",
        load: (input: { readonly ids: ReadonlyArray<number> }) => Effect.sync(() => `${input.ids.join(",")}:${++calls}`)
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const family = client.query(query)
      expect(yield* family({ ids: [1, 2] }).get).toBe("1,2:1")
      expect(yield* family({ ids: [1, 2] }).get).toBe("1,2:1")
      expect(calls).toBe(1)
    }))

  it.effect("interrupts active and queued query waiters when the client closes", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const client = yield* QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
      const query = Query.make({
        name: "shutdown-queued",
        load: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
      })
      const resource = client.query(query)({})
      const active = yield* Effect.forkChild(resource.get)
      yield* Deferred.await(started)
      yield* resource.invalidate
      const queued = yield* Effect.forkChild(resource.get)
      yield* Effect.yieldNow
      yield* Scope.close(scope, Exit.void)
      const activeExit = yield* Fiber.await(active)
      const queuedExit = yield* Fiber.await(queued)
      expect(Exit.isFailure(activeExit) && Cause.hasInterrupts(activeExit.cause)).toBe(true)
      expect(Exit.isFailure(queuedExit) && Cause.hasInterrupts(queuedExit.cause)).toBe(true)
    }))

  it.effect("post-invalidation get and refresh join only the replacement generation", () =>
    Effect.gen(function*() {
      const starts = yield* Queue.unbounded<number>()
      const releases = [yield* Deferred.make<void>(), yield* Deferred.make<void>()]
      let attempt = 0
      const query = Query.make({
        name: "generation-acquire",
        staleTime: "1 minute",
        load: () =>
          Effect.gen(function*() {
            const current = attempt++
            yield* Queue.offer(starts, current)
            yield* Deferred.await(releases[current])
            return current
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(query)({})
      const old = yield* Effect.forkChild(resource.get)
      expect(yield* Queue.take(starts)).toBe(0)
      yield* resource.invalidate
      const nextGet = yield* Effect.forkChild(resource.get)
      const nextRefresh = yield* Effect.forkChild(resource.refresh)
      yield* Effect.yieldNow
      yield* Deferred.succeed(releases[0], undefined)
      expect(yield* Fiber.join(old)).toBe(0)
      expect(yield* Queue.take(starts)).toBe(1)
      yield* Deferred.succeed(releases[1], undefined)
      expect(yield* Fiber.join(nextGet)).toBe(1)
      expect(yield* Fiber.join(nextRefresh)).toBe(1)
      expect(attempt).toBe(2)
    }))

  it.effect("clears waiting after a cancelled query finishes cleanup", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const cleanupRelease = yield* Deferred.make<void>()
      const query = Query.make({
        name: "cancel-settles",
        load: () =>
          Effect.acquireRelease(
            Deferred.succeed(started, undefined),
            () => Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupRelease)))
          ).pipe(Effect.andThen(Effect.never))
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(query)({})
      const reader = yield* Effect.forkChild(resource.get)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(reader)
      yield* Deferred.await(cleanupStarted)
      expect((yield* resource.snapshot).waiting).toBe(true)
      yield* Deferred.succeed(cleanupRelease, undefined)
      yield* Effect.yieldNow
      expect((yield* resource.snapshot).waiting).toBe(false)
    }))

  it.effect("clears waiting while retaining success after refresh cancellation", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const cleanupRelease = yield* Deferred.make<void>()
      let attempt = 0
      const query = Query.make({
        name: "cancel-refresh-settles",
        staleTime: "1 minute",
        load: () => {
          attempt += 1
          return attempt === 1
            ? Effect.succeed("retained")
            : Effect.acquireRelease(
              Deferred.succeed(started, undefined),
              () => Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupRelease)))
            ).pipe(Effect.andThen(Effect.never))
        }
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(query)({})
      expect(yield* resource.get).toBe("retained")
      const refresh = yield* Effect.forkChild(resource.refresh)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(refresh)
      yield* Deferred.await(cleanupStarted)
      yield* Deferred.succeed(cleanupRelease, undefined)
      yield* Effect.yieldNow
      const snapshot = yield* resource.snapshot
      expect(snapshot.waiting).toBe(false)
      expect(AsyncResult.isSuccess(snapshot) && snapshot.value).toBe("retained")
    }))

  it.effect("publishes terminal mutation state after shutdown cleanup", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const cleanupStarted = yield* Deferred.make<void>()
      const cleanupRelease = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const client = yield* QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
      const mutation = Mutation.make({
        name: "shutdown-mutation",
        execute: () =>
          Effect.acquireRelease(
            Deferred.succeed(started, undefined),
            () => Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupRelease)))
          ).pipe(Effect.andThen(Effect.never))
      })
      const handle = yield* client.mutation(mutation)
      const states = yield* Queue.unbounded<Mutation.State<unknown, never, never>>()
      const observer = yield* Effect.forkChild(Stream.runForEach(handle.changes, (state) => Queue.offer(states, state)))
      yield* handle.start({})
      yield* Deferred.await(started)
      let running = yield* Queue.take(states)
      while (running.pendingCount !== 1) running = yield* Queue.take(states)
      const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void))
      yield* Deferred.await(cleanupStarted)
      expect(Option.isNone(yield* Queue.poll(states))).toBe(true)
      yield* Deferred.succeed(cleanupRelease, undefined)
      yield* Fiber.join(closing)
      let terminal = yield* Queue.take(states)
      while (terminal.pendingCount !== 0 || Option.isNone(terminal.latest)) terminal = yield* Queue.take(states)
      expect(terminal.pendingCount).toBe(0)
      expect(Option.isSome(terminal.latest) && AsyncResult.isFailure(terminal.latest.value.result)).toBe(true)
      const observerExit = yield* Fiber.await(observer)
      expect(Exit.isFailure(observerExit) && Cause.hasInterrupts(observerExit.cause)).toBe(true)
    }))

  it.effect("uses a Clock supplied by makeWith for freshness and GC", () =>
    Effect.gen(function*() {
      const clientClock = yield* TestClock.make()
      let calls = 0
      const query = Query.make({
        name: "custom-clock",
        staleTime: "10 seconds",
        gcTime: "20 seconds",
        load: () => Effect.sync(() => ++calls)
      })
      const client = yield* QueryClient.makeWith(Context.make(Clock.Clock, clientClock))
      const resource = client.query(query)({})
      expect(yield* resource.get).toBe(1)
      yield* clientClock.adjust("11 seconds")
      expect(yield* resource.get).toBe(2)
      yield* clientClock.adjust("21 seconds")
      expect((yield* resource.snapshot)._tag).toBe("Initial")

      const layerClock = yield* TestClock.make()
      const layerClient = yield* QueryClient.make({ layer: Layer.succeed(Clock.Clock, layerClock) })
      const layerResource = layerClient.query(query)({ layer: true })
      expect(yield* layerResource.get).toBe(3)
      yield* layerClock.adjust("11 seconds")
      expect(yield* layerResource.get).toBe(4)
    }))

  it.effect("query atoms bypass registry default idle retention", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const cancelled = yield* Deferred.make<void>()
      const query = Query.make({
        name: "atom-idle",
        load: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined))
          )
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const atom = QueryAtom.query(client.query(query)({}))
      const tasks: Array<() => void> = []
      const registry = AtomRegistry.make({
        defaultIdleTTL: 60_000,
        scheduleTask: (task) => {
          tasks.push(task)
          return () => {}
        }
      })
      const unmount = registry.mount(atom)
      while (tasks.length > 0) tasks.shift()?.()
      yield* Deferred.await(started)
      unmount()
      while (tasks.length > 0) tasks.shift()?.()
      yield* Deferred.await(cancelled)
    }))

  it.effect("a continuously mounted observer never retains a completed active request", () =>
    Effect.gen(function*() {
      let calls = 0
      const query = Query.make({
        name: "mounted-active-invariant",
        staleTime: "10 seconds",
        load: () => Effect.sync(() => ++calls)
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(query)({})
      const states = yield* Queue.unbounded<AsyncResult.AsyncResult<number, never>>()
      const observer = yield* Effect.forkChild(
        Stream.runForEach(resource.changes, (state) => Queue.offer(states, state))
      )
      const takeSuccess = (value: number): Effect.Effect<void> =>
        Effect.gen(function*() {
          while (true) {
            const state = yield* Queue.take(states)
            if (AsyncResult.isSuccess(state) && state.value === value && !state.waiting) return
          }
        })

      yield* takeSuccess(1)
      expect((yield* resource.snapshot)._tag).toBe("Success")
      expect(yield* resource.refresh).toBe(2)
      yield* takeSuccess(2)
      yield* TestClock.adjust("11 seconds")
      expect(yield* resource.get).toBe(3)
      yield* takeSuccess(3)
      yield* resource.invalidate
      yield* takeSuccess(4)
      const finalSnapshot = yield* resource.snapshot
      expect(AsyncResult.isSuccess(finalSnapshot) && finalSnapshot.value).toBe(4)
      expect(calls).toBe(4)
      yield* Fiber.interrupt(observer)
    }))

  it.effect("interrupts new stream subscriptions and mutation creation after close", () =>
    Effect.gen(function*() {
      let loads = 0
      const scope = yield* Scope.make()
      const client = yield* QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
      const query = Query.make({
        name: "closed-query-stream",
        load: () => Effect.sync(() => ++loads)
      })
      const mutation = Mutation.make({
        name: "closed-mutation-stream",
        execute: () => Effect.void
      })
      const resource = client.query(query)({})
      const handle = yield* client.mutation(mutation)
      yield* Scope.close(scope, Exit.void)

      const queryStreamExit = yield* resource.changes.pipe(Stream.take(1), Stream.runCollect, Effect.exit)
      const mutationStreamExit = yield* handle.changes.pipe(Stream.take(1), Stream.runCollect, Effect.exit)
      const controllerExit = yield* client.mutation(mutation).pipe(Effect.exit)
      expect(Exit.isFailure(queryStreamExit) && Cause.hasInterrupts(queryStreamExit.cause)).toBe(true)
      expect(Exit.isFailure(mutationStreamExit) && Cause.hasInterrupts(mutationStreamExit.cause)).toBe(true)
      expect(Exit.isFailure(controllerExit) && Cause.hasInterrupts(controllerExit.cause)).toBe(true)
      expect(loads).toBe(0)
    }))

  it.effect("interrupts an active query changes subscription on client close", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const client = yield* QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
      const query = Query.make({
        name: "close-active-query-stream",
        load: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
      })
      const observer = yield* Effect.forkChild(Stream.runDrain(client.query(query)({}).changes))
      yield* Deferred.await(started)
      yield* Scope.close(scope, Exit.void)
      const observerExit = yield* Fiber.await(observer)
      expect(Exit.isFailure(observerExit) && Cause.hasInterrupts(observerExit.cause)).toBe(true)
    }))
})
