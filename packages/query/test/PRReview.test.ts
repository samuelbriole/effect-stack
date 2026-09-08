import * as Mutation from "@effect-stack/query/Mutation"
import * as Query from "@effect-stack/query/Query"
import * as QueryAtom from "@effect-stack/query/QueryAtom"
import * as QueryClient from "@effect-stack/query/QueryClient"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

describe("PR 9 review regressions", () => {
  it.effect("recovers when an Atom registry is disposed reentrantly from waiting publication", () =>
    Effect.gen(function*() {
      const cancelled = yield* Deferred.make<void>()
      let attempts = 0
      const definition = Query.make({
        name: "reentrant-disposal",
        staleTime: Infinity,
        load: () => {
          attempts += 1
          if (attempts === 1) return Effect.succeed("initial")
          if (attempts === 2) {
            return Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined)))
          }
          return Effect.succeed("recovered")
        }
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(definition)({})
      const atom = QueryAtom.query(resource)
      const registry = AtomRegistry.make()
      const unmount = registry.mount(atom)
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toBe("initial")
      const unsubscribe = registry.subscribe(atom, (state) => {
        if (state.waiting && AsyncResult.isSuccess(state)) registry.dispose()
      })

      resource.observation.invalidate()
      yield* Deferred.await(cancelled)
      expect(yield* resource.get).toBe("recovered")
      expect(attempts).toBe(3)
      unsubscribe()
      unmount()
    }))

  it.effect("commits success metadata before a reentrant observer acquires interest", () =>
    Effect.gen(function*() {
      let attempts = 0
      const definition = Query.make({
        name: "reentrant-success",
        staleTime: Infinity,
        load: () => Effect.sync(() => ++attempts)
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(definition)({})
      let releaseSecond = () => {}
      const releaseFirst = resource.observation.observe((state) => {
        if (AsyncResult.isSuccess(state)) {
          releaseSecond = resource.observation.observe(() => {})
        }
      })
      expect(yield* resource.get).toBe(1)
      expect(attempts).toBe(1)
      releaseSecond()
      releaseFirst()
    }))

  it.effect("does not regress a later observer during nested invalidation", () =>
    Effect.gen(function*() {
      const secondRelease = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()
      let attempts = 0
      const definition = Query.make({
        name: "nested-publication",
        staleTime: Infinity,
        load: () =>
          Effect.sync(() => ++attempts).pipe(
            Effect.flatMap((attempt) =>
              attempt === 2
                ? Deferred.succeed(secondStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(secondRelease)),
                  Effect.as(attempt)
                )
                : Effect.succeed(attempt)
            )
          )
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(definition)({})
      let invalidated = false
      const releaseFirst = resource.observation.observe((state) => {
        if (!invalidated && AsyncResult.isSuccess(state)) {
          invalidated = true
          resource.observation.invalidate()
        }
      })
      let secondState = resource.observation.getSnapshot()
      const releaseSecond = resource.observation.observe((state) => {
        secondState = state
      })
      yield* Deferred.await(secondStarted)
      expect(secondState).toBe(resource.observation.getSnapshot())
      expect(secondState.waiting).toBe(true)
      yield* Deferred.succeed(secondRelease, undefined)
      while (resource.observation.getSnapshot().waiting) yield* Effect.yieldNow
      releaseSecond()
      releaseFirst()
    }))

  it.effect("keeps synchronous snapshots nonterminal until shutdown finalizers expose their actual defect", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const finalizing = yield* Deferred.make<void>()
      const releaseFinalizer = yield* Deferred.make<void>()
      const defect = new Error("shutdown finalizer defect")
      const scope = yield* Scope.make()
      const client = yield* QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
      const definition = Query.make({
        name: "shutdown-actual-exit",
        load: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Effect.uninterruptible(
              Deferred.succeed(finalizing, undefined).pipe(
                Effect.andThen(Deferred.await(releaseFinalizer)),
                Effect.andThen(Effect.die(defect))
              )
            ))
          )
      })
      const resource = client.query(definition)({})
      const readerDone = yield* Deferred.make<void>()
      let observed = resource.observation.getSnapshot()
      const releaseObserver = resource.observation.observe((state) => {
        observed = state
      })
      const reader = Effect.runFork(resource.get.pipe(Effect.ensuring(Deferred.succeed(readerDone, undefined))))
      yield* Deferred.await(started)
      const closing = Effect.runFork(Scope.close(scope, Exit.void))
      yield* Deferred.await(finalizing)

      expect(resource.observation.getSnapshot().waiting).toBe(true)
      expect(observed.waiting).toBe(true)
      expect(yield* Deferred.isDone(readerDone)).toBe(false)
      yield* Deferred.succeed(releaseFinalizer, undefined)

      const readerExit = yield* Fiber.await(reader)
      const terminal = resource.observation.getSnapshot()
      expect(Exit.isFailure(readerExit) && Cause.hasDies(readerExit.cause)).toBe(true)
      expect(AsyncResult.isFailure(terminal) && Cause.hasDies(terminal.cause)).toBe(true)
      expect(observed).toBe(terminal)
      yield* Fiber.await(closing)
      releaseObserver()
    }))

  it.effect("observes spread resources, proxies, structural fixtures, and spread mutation handles", () =>
    Effect.gen(function*() {
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(Query.make({ name: "spread", load: () => Effect.succeed(1) }))({})
      const copied: Query.Resource<number, never> = { ...resource }
      const proxied: Query.Resource<number, never> = new Proxy(resource, {})
      const registry = AtomRegistry.make()
      const copiedAtom = QueryAtom.query(copied)
      expect(yield* AtomRegistry.getResult(registry, copiedAtom, { suspendOnWaiting: true })).toBe(1)
      const proxiedAtom = QueryAtom.query(proxied)
      expect(proxiedAtom).not.toBe(copiedAtom)
      expect(yield* AtomRegistry.getResult(registry, proxiedAtom, { suspendOnWaiting: true })).toBe(1)

      const initial = AsyncResult.initial<number, never>()
      const fixture: Query.Resource<number, never> = {
        get: Effect.succeed(1),
        refresh: Effect.succeed(1),
        invalidate: Effect.void,
        snapshot: Effect.succeed(initial),
        changes: Stream.make(initial),
        observation: { getSnapshot: () => initial, observe: () => () => {}, invalidate: () => {} }
      }
      expect(registry.get(QueryAtom.query(fixture))).toBe(initial)

      const handle = yield* client.mutation(Mutation.make({ name: "mutation-spread", execute: Effect.succeed }))
      const copiedHandle: Mutation.Handle<unknown, unknown, never> = { ...handle }
      expect(registry.get(QueryAtom.mutation(copiedHandle))).toBe(copiedHandle.observation.getSnapshot())
      expect(copiedHandle.observation.getSnapshot()).toBe(handle.observation.getSnapshot())
    }))

  it.effect("returns stable side-effect-free query and mutation snapshots while following GC", () =>
    Effect.gen(function*() {
      let attempts = 0
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(Query.make({
        name: "snapshot-stability",
        gcTime: 0,
        load: () => Effect.sync(() => ++attempts)
      }))({})
      const absent = resource.observation.getSnapshot()
      expect(resource.observation.getSnapshot()).toBe(absent)
      resource.observation.invalidate()
      expect(resource.observation.getSnapshot()).toBe(absent)
      expect(attempts).toBe(0)

      expect(yield* resource.get).toBe(1)
      while (resource.observation.getSnapshot()._tag !== "Initial") yield* Effect.yieldNow
      expect(resource.observation.getSnapshot()).toBe(absent)

      const handle = yield* client.mutation(Mutation.make({ name: "mutation-snapshot", execute: Effect.succeed }))
      expect(handle.observation.getSnapshot()).toBe(handle.observation.getSnapshot())
    }))

  it.effect("native Atom refresh invalidates active and retained inactive resources without executing mutations", () =>
    Effect.gen(function*() {
      let queryAttempts = 0
      let mutationAttempts = 0
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(Query.make({
        name: "native-refresh",
        staleTime: Infinity,
        gcTime: Infinity,
        load: () => Effect.sync(() => ++queryAttempts)
      }))({})
      const atom = QueryAtom.query(resource)
      const left = AtomRegistry.make()
      const right = AtomRegistry.make()
      const unmountLeft = left.mount(atom)
      const unmountRight = right.mount(atom)
      expect(yield* AtomRegistry.getResult(left, atom, { suspendOnWaiting: true })).toBe(1)
      left.refresh(atom)
      expect(yield* AtomRegistry.getResult(right, atom, { suspendOnWaiting: true })).toBe(2)
      unmountLeft()
      unmountRight()
      left.refresh(atom)
      expect(yield* resource.get).toBe(3)

      const handle = yield* client.mutation(Mutation.make({
        name: "mutation-no-refresh",
        execute: () => Effect.sync(() => ++mutationAttempts)
      }))
      const mutationAtom = QueryAtom.mutation(handle)
      left.refresh(mutationAtom)
      expect(mutationAttempts).toBe(0)
    }))

  it.effect("registers mutation shutdown before reentrant pending observers can close the client", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const finalizing = yield* Deferred.make<void>()
      const releaseFinalizer = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const client = yield* QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
      const handle = yield* client.mutation(Mutation.make({
        name: "reentrant-mutation-shutdown",
        execute: (_input: void) =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Effect.uninterruptible(
              Deferred.succeed(finalizing, undefined).pipe(Effect.andThen(Deferred.await(releaseFinalizer)))
            ))
          )
      }))
      let closing: Fiber.Fiber<void, unknown> | undefined
      let terminal: Mutation.State<void, never, never> | undefined
      const releaseObserver = handle.observation.observe((state) => {
        terminal = state
        if (state.pendingCount === 1 && closing === undefined) {
          closing = Effect.runFork(Scope.close(scope, Exit.void))
        }
      })

      const invocation = yield* handle.start(undefined)
      yield* Deferred.await(started)
      yield* Deferred.await(finalizing)
      expect(handle.observation.getSnapshot().pendingCount).toBe(1)
      const waiter = Effect.runFork(invocation.await)
      yield* Effect.yieldNow
      yield* Deferred.succeed(releaseFinalizer, undefined)

      const invocationExit = yield* Fiber.await(waiter)
      expect(Exit.isFailure(invocationExit) && Cause.hasInterrupts(invocationExit.cause)).toBe(true)
      expect(terminal?.pendingCount).toBe(0)
      expect(closing).toBeDefined()
      if (closing !== undefined) yield* Fiber.await(closing)
      releaseObserver()
    }))

  it.effect("isolates query observer defects from completion and later observers", () =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const client = yield* QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
      const resource = client.query(Query.make({ name: "throwing-query-observer", load: () => Effect.succeed("ok") }))(
        {}
      )
      let secondSawSuccess = false
      const releaseThrowing = resource.observation.observe((state) => {
        if (AsyncResult.isSuccess(state)) throw new Error("query observer defect")
      })
      const releaseSecond = resource.observation.observe((state) => {
        if (AsyncResult.isSuccess(state)) secondSawSuccess = true
      })

      expect(yield* resource.get).toBe("ok")
      expect(secondSawSuccess).toBe(true)
      yield* Scope.close(scope, Exit.void)
      releaseSecond()
      releaseThrowing()
    }))

  it.effect("isolates mutation observer defects from invocation completion and later observers", () =>
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const client = yield* QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
      const handle = yield* client.mutation(Mutation.make({
        name: "throwing-mutation-observer",
        execute: (_input: void) => Effect.succeed("ok")
      }))
      let secondSawTerminal = false
      const releaseThrowing = handle.observation.observe((state) => {
        if (state.pendingCount === 0) throw new Error("mutation observer defect")
      })
      const releaseSecond = handle.observation.observe((state) => {
        if (state.pendingCount === 0) secondSawTerminal = true
      })

      expect(yield* handle.execute(undefined)).toBe("ok")
      expect(secondSawTerminal).toBe(true)
      yield* Scope.close(scope, Exit.void)
      releaseSecond()
      releaseThrowing()
    }))
})
