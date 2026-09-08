import * as Mutation from "@effect-stack/query/Mutation"
import * as QueryClient from "@effect-stack/query/QueryClient"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"

class SubmitError extends Schema.TaggedError<SubmitError>()("SubmitError", {
  reason: Schema.String
}) {}

interface Gate {
  readonly started: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
  readonly cancelled: Deferred.Deferred<void>
}

const makeGate = Effect.fn("MutationTest.makeGate")(function*() {
  const started = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const cancelled = yield* Deferred.make<void>()
  return { cancelled, release, started } satisfies Gate
})

const makeClient = QueryClient.make({ layer: Layer.empty })

const makeGatedAddItem = Effect.fn("MutationTest.makeGatedAddItem")(function*(gate: Gate) {
  return Mutation.make({
    name: "addItem",
    execute: (input: { readonly item: string }) =>
      Effect.gen(function*() {
        yield* Deferred.succeed(gate.started, undefined)
        yield* Deferred.await(gate.release).pipe(
          Effect.onInterrupt(() => Deferred.succeed(gate.cancelled, undefined))
        )
        return `${input.item}!`
      })
  })
})

function takeState<S, E>(
  queue: Queue.Dequeue<S, E>,
  predicate: (state: S) => boolean
): Effect.Effect<S, E> {
  return Effect.gen(function*() {
    const state = yield* Queue.take(queue)
    return predicate(state) ? state : yield* takeState(queue, predicate)
  })
}

const isSettled = (state: Mutation.State<unknown, unknown, unknown>) =>
  state.pendingCount === 0 && Option.isSome(state.latest)

const expectLatestSuccess = <I, A, E>(latest: Option.Option<Mutation.Latest<I, A, E>>, value: A) => {
  if (Option.isSome(latest) && AsyncResult.isSuccess(latest.value.result) && latest.value.result.value === value) return
  throw new Error(`expected a latest success of ${JSON.stringify(value)}`)
}

describe("Mutation", () => {
  it.effect("a fresh handle starts from an empty state", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const addItem = Mutation.make({
        name: "addItem",
        execute: (input: { readonly item: string }) => Effect.succeed(input.item)
      })
      const handle = yield* client.mutation(addItem)
      expect(yield* handle.snapshot).toEqual({ latest: Option.none(), pendingCount: 0 })
    }))

  it.effect("execute returns the result and records the latest success with its input", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const addItem = Mutation.make({
        name: "addItem",
        execute: (input: { readonly item: string }) => Effect.succeed(`${input.item}!`)
      })
      const handle = yield* client.mutation(addItem)
      expect(yield* handle.execute({ item: "a" })).toBe("a!")
      const state = yield* handle.snapshot
      expect(state.pendingCount).toBe(0)
      expectLatestSuccess(state.latest, "a!")
      if (Option.isSome(state.latest)) expect(state.latest.value.input).toEqual({ item: "a" })
    }))

  it.effect("execute propagates typed failures and records the latest failure", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const failure = new SubmitError({ reason: "rejected" })
      const addItem = Mutation.make({
        name: "addItem",
        execute: (input: { readonly item: string }) => Effect.fail(failure).pipe(Effect.as(input.item))
      })
      const handle = yield* client.mutation(addItem)
      expect(yield* Effect.flip(handle.execute({ item: "a" }))).toBe(failure)
      const state = yield* handle.snapshot
      expect(state.pendingCount).toBe(0)
      expect(Option.isSome(state.latest) && state.latest.value.result._tag).toBe("Failure")
    }))

  it.effect("a later success replaces a recorded latest failure", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const attempts = yield* Ref.make(0)
      const addItem = Mutation.make({
        name: "addItem",
        execute: (input: { readonly item: string }) =>
          Effect.gen(function*() {
            const attempt = yield* Ref.updateAndGet(attempts, (n) => n + 1)
            if (attempt === 1) return yield* Effect.fail(new SubmitError({ reason: "flaky" }))
            return `ok-${input.item}`
          })
      })
      const handle = yield* client.mutation(addItem)
      expect((yield* Effect.exit(handle.execute({ item: "a" })))._tag).toBe("Failure")
      expect(yield* handle.execute({ item: "b" })).toBe("ok-b")
      const state = yield* handle.snapshot
      expectLatestSuccess(state.latest, "ok-b")
      if (Option.isSome(state.latest)) expect(state.latest.value.input).toEqual({ item: "b" })
    }))

  it.effect("start returns immediately, holds the invocation pending, and await yields the result", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const gate = yield* makeGate()
      const addItem = yield* makeGatedAddItem(gate)
      const handle = yield* client.mutation(addItem)
      const invocation = yield* handle.start({ item: "a" })
      yield* Deferred.await(gate.started)
      const pending = yield* handle.snapshot
      expect(pending.pendingCount).toBe(1)
      expect(Option.isSome(pending.latest) && pending.latest.value.id === invocation.id).toBe(true)
      yield* Deferred.succeed(gate.release, undefined)
      expect(yield* invocation.await).toBe("a!")
      const settled = yield* handle.snapshot
      expect(settled.pendingCount).toBe(0)
      expectLatestSuccess(settled.latest, "a!")
    }))

  it.effect("concurrent invocations are tracked independently", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const gateA = yield* makeGate()
      const gateB = yield* makeGate()
      const addItem = Mutation.make({
        name: "addItem",
        execute: (input: { readonly target: "a" | "b" }) =>
          Effect.gen(function*() {
            const gate = input.target === "a" ? gateA : gateB
            yield* Deferred.succeed(gate.started, undefined)
            yield* Deferred.await(gate.release)
            return input.target
          })
      })
      const handle = yield* client.mutation(addItem)
      const first = yield* handle.start({ target: "a" })
      yield* Deferred.await(gateA.started)
      const second = yield* handle.start({ target: "b" })
      yield* Deferred.await(gateB.started)
      expect((yield* handle.snapshot).pendingCount).toBe(2)
      yield* Deferred.succeed(gateA.release, undefined)
      expect(yield* first.await).toBe("a")
      yield* Deferred.succeed(gateB.release, undefined)
      expect(yield* second.await).toBe("b")
      expect((yield* handle.snapshot).pendingCount).toBe(0)
    }))

  it.effect("the latest-started invocation wins as the recorded latest", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const gateA = yield* makeGate()
      const gateB = yield* makeGate()
      const addItem = Mutation.make({
        name: "addItem",
        execute: (input: { readonly target: "a" | "b" }) =>
          Effect.gen(function*() {
            const gate = input.target === "a" ? gateA : gateB
            yield* Deferred.succeed(gate.started, undefined)
            yield* Deferred.await(gate.release)
            return input.target
          })
      })
      const handle = yield* client.mutation(addItem)
      const older = yield* handle.start({ target: "a" })
      yield* Deferred.await(gateA.started)
      const newer = yield* handle.start({ target: "b" })
      yield* Deferred.await(gateB.started)
      yield* Deferred.succeed(gateB.release, undefined)
      expect(yield* newer.await).toBe("b")
      yield* Deferred.succeed(gateA.release, undefined)
      expect(yield* older.await).toBe("a")
      const state = yield* handle.snapshot
      expect(state.pendingCount).toBe(0)
      expect(Option.isSome(state.latest) && state.latest.value.id === newer.id).toBe(true)
      expectLatestSuccess(state.latest, "b")
    }))

  it.effect("interrupting an invocation runs its finalizers before returning and releases the pending slot", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const gate = yield* makeGate()
      const addItem = yield* makeGatedAddItem(gate)
      const handle = yield* client.mutation(addItem)
      const invocation = yield* handle.start({ item: "a" })
      yield* Deferred.await(gate.started)
      yield* invocation.interrupt
      expect(yield* Deferred.isDone(gate.cancelled)).toBe(true)
      expect((yield* handle.snapshot).pendingCount).toBe(0)
      const exit = yield* Effect.exit(invocation.await)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    }))

  it.effect("interrupting the caller of execute leaves the client-owned execution running", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const gate = yield* makeGate()
      const addItem = yield* makeGatedAddItem(gate)
      const handle = yield* client.mutation(addItem)
      const states = yield* Stream.toQueue(handle.changes, { capacity: "unbounded" })
      expect((yield* Queue.take(states)).pendingCount).toBe(0)
      const caller = yield* Effect.forkScoped(handle.execute({ item: "a" }))
      yield* Deferred.await(gate.started)
      yield* Fiber.interrupt(caller)
      expect((yield* handle.snapshot).pendingCount).toBe(1)
      expect(yield* Deferred.isDone(gate.cancelled)).toBe(false)
      yield* takeState(states, (state) => state.pendingCount === 1)
      yield* Deferred.succeed(gate.release, undefined)
      const settled = yield* takeState(states, isSettled)
      expect(yield* Deferred.isDone(gate.cancelled)).toBe(false)
      expectLatestSuccess(settled.latest, "a!")
    }))

  it.effect("the changes stream replays the current state and reports every transition", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const gate = yield* makeGate()
      const addItem = yield* makeGatedAddItem(gate)
      const handle = yield* client.mutation(addItem)
      const states = yield* Stream.toQueue(handle.changes, { capacity: "unbounded" })
      expect(yield* Queue.take(states)).toEqual({ latest: Option.none(), pendingCount: 0 })
      const invocation = yield* handle.start({ item: "a" })
      yield* Deferred.await(gate.started)
      const running = yield* takeState(states, (state) => state.pendingCount === 1)
      expect(Option.isSome(running.latest) && running.latest.value.result.waiting).toBe(true)
      yield* Deferred.succeed(gate.release, undefined)
      expect(yield* invocation.await).toBe("a!")
      const settled = yield* takeState(states, (state) => state.pendingCount === 0 && Option.isSome(state.latest))
      expectLatestSuccess(settled.latest, "a!")
    }))

  it.effect("closing the client finalizes pending invocations", () =>
    Effect.gen(function*() {
      const gate = yield* makeGate()
      const addItem = yield* makeGatedAddItem(gate)
      yield* Effect.scoped(
        Effect.gen(function*() {
          const client = yield* QueryClient.make({ layer: Layer.empty })
          const handle = yield* client.mutation(addItem)
          yield* handle.start({ item: "a" })
          yield* Deferred.await(gate.started)
        })
      )
      yield* Deferred.await(gate.cancelled)
      expect(yield* Deferred.isDone(gate.cancelled)).toBe(true)
    }))
})
