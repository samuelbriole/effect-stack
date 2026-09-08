import * as Query from "@effect-stack/query/Query"
import * as QueryClient from "@effect-stack/query/QueryClient"
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
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"

class LoadError extends Schema.TaggedError<LoadError>()("LoadError", {
  reason: Schema.String
}) {}

class InitError extends Schema.TaggedError<InitError>()("InitError", {
  reason: Schema.String
}) {}

interface RepoInterface {
  readonly fetchName: (id: number) => Effect.Effect<string>
}

class Repo extends Context.Service<Repo, RepoInterface>()("QueryClientTest/Repo") {}

interface Gate {
  readonly started: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
  readonly cancelled: Deferred.Deferred<void>
}

const makeGate = Effect.fn("QueryClientTest.makeGate")(function*() {
  const started = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const cancelled = yield* Deferred.make<void>()
  return { cancelled, release, started } satisfies Gate
})

const countedValue = (counter: Ref.Ref<number>) =>
  Ref.updateAndGet(counter, (n) => n + 1).pipe(Effect.map((n) => `v${n}`))

const gatedLoad = (gate: Gate, starts: Queue.Queue<number>, counter: Ref.Ref<number>) =>
  Effect.gen(function*() {
    const attempt = yield* Ref.updateAndGet(counter, (n) => n + 1)
    yield* Queue.offer(starts, attempt)
    yield* Deferred.await(gate.release).pipe(
      Effect.onInterrupt(() => Deferred.succeed(gate.cancelled, undefined))
    )
    return `v${attempt}`
  })

const makeAttemptState = Effect.fn("QueryClientTest.makeAttemptState")(function*() {
  const starts = yield* Queue.unbounded<number>()
  const counter = yield* Ref.make(0)
  return { counter, starts }
})

const noOfferYet = <A, E>(starts: Queue.Queue<A, E>) => Queue.poll(starts).pipe(Effect.map(Option.isNone))

const isSuccessWithValue = (value: string) => (result: AsyncResult.AsyncResult<unknown, unknown>) =>
  AsyncResult.isSuccess(result) && result.value === value

describe("QueryClient", () => {
  it.effect("serves an initial snapshot without creating interest or loading", () =>
    Effect.gen(function*() {
      const starts = yield* Queue.unbounded<number>()
      const counter = yield* Ref.make(0)
      const users = Query.make({
        name: "users",
        load: () => countedValue(counter).pipe(Effect.flatMap((value) => Queue.offer(starts, 1).pipe(Effect.as(value))))
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      const snapshot = yield* resource.snapshot
      expect(snapshot._tag).toBe("Initial")
      expect(yield* noOfferYet(starts)).toBe(true)
      expect(yield* Ref.get(counter)).toBe(0)
    }))

  it.effect("coalesces concurrent readers of one input into a single load", () =>
    Effect.gen(function*() {
      const gate = yield* makeGate()
      const { counter, starts } = yield* makeAttemptState()
      const users = Query.make({ name: "users", load: () => gatedLoad(gate, starts, counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const all = client.query(users)
      const first = yield* Effect.forkScoped(all({}).get, { startImmediately: true })
      yield* Queue.take(starts)
      const second = yield* Effect.forkScoped(all({}).get, { startImmediately: true })
      yield* Deferred.succeed(gate.release, undefined)
      expect(yield* Fiber.join(first)).toBe("v1")
      expect(yield* Fiber.join(second)).toBe("v1")
      expect(yield* Ref.get(counter)).toBe(1)
    }))

  it.effect("keys cache entries by structural equality of plain inputs", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const task = Query.make({
        name: "task",
        staleTime: "10 minutes",
        load: (input: { readonly id: number; readonly meta: { readonly tag: string } }) =>
          countedValue(counter).pipe(Effect.map((value) => `${value}:${input.id}:${input.meta.tag}`))
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const byId = client.query(task)
      expect(yield* byId({ id: 1, meta: { tag: "x" } }).get).toBe("v1:1:x")
      expect(yield* byId({ id: 1, meta: { tag: "x" } }).get).toBe("v1:1:x")
      expect(yield* byId({ id: 2, meta: { tag: "x" } }).get).toBe("v2:2:x")
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("keeps distinct definitions with the same name independent", () =>
    Effect.gen(function*() {
      const left = yield* Ref.make(0)
      const right = yield* Ref.make(0)
      const leftQuery = Query.make({ name: "shared", load: () => countedValue(left) })
      const rightQuery = Query.make({ name: "shared", load: () => countedValue(right) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      expect(yield* client.query(leftQuery)({}).get).toBe("v1")
      expect(yield* client.query(rightQuery)({}).get).toBe("v1")
      expect({ left: yield* Ref.get(left), right: yield* Ref.get(right) }).toEqual({ left: 1, right: 1 })
    }))

  it.effect("serves fresh cached results without reloading", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({ name: "users", staleTime: "1 minute", load: () => countedValue(counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const all = client.query(users)
      expect(yield* all({}).get).toBe("v1")
      expect(yield* all({}).get).toBe("v1")
      expect(yield* Ref.get(counter)).toBe(1)
    }))

  it.effect("waits for a new load once staleTime has elapsed", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({ name: "users", staleTime: "10 seconds", load: () => countedValue(counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const all = client.query(users)
      expect(yield* all({}).get).toBe("v1")
      yield* TestClock.adjust("11 seconds")
      expect(yield* all({}).get).toBe("v2")
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("refetches on the next read after the default staleTime of zero", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({ name: "users", load: () => countedValue(counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const all = client.query(users)
      expect(yield* all({}).get).toBe("v1")
      expect(yield* all({}).get).toBe("v2")
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("refresh reloads even when the cached result is fresh", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({ name: "users", staleTime: "10 minutes", load: () => countedValue(counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      expect(yield* resource.get).toBe("v1")
      expect(yield* resource.refresh).toBe("v2")
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("refetches on the next read after invalidation", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({ name: "users", staleTime: "10 minutes", load: () => countedValue(counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      expect(yield* resource.get).toBe("v1")
      yield* resource.invalidate
      expect(yield* resource.get).toBe("v2")
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("surfaces typed load failures to every reader of one attempt", () =>
    Effect.gen(function*() {
      const gate = yield* makeGate()
      const { counter, starts } = yield* makeAttemptState()
      const failure = new LoadError({ reason: "down" })
      const users = Query.make({
        name: "users",
        load: () =>
          Effect.gen(function*() {
            const attempt = yield* Ref.updateAndGet(counter, (n) => n + 1)
            yield* Queue.offer(starts, attempt)
            yield* Deferred.await(gate.release)
            return yield* Effect.fail(failure)
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const all = client.query(users)
      const first = yield* Effect.forkScoped(all({}).get, { startImmediately: true })
      yield* Queue.take(starts)
      const second = yield* Effect.forkScoped(all({}).get, { startImmediately: true })
      yield* Deferred.succeed(gate.release, undefined)
      expect(yield* Effect.flip(Fiber.join(first))).toBe(failure)
      expect(yield* Effect.flip(Fiber.join(second))).toBe(failure)
      expect(yield* Ref.get(counter)).toBe(1)
    }))

  it.effect("retrying loads natively with Effect.retry hides transient failures", () =>
    Effect.gen(function*() {
      const attempts = yield* Ref.make(0)
      const flaky = Query.make({
        name: "flaky",
        load: () =>
          Effect.gen(function*() {
            const attempt = yield* Ref.updateAndGet(attempts, (n) => n + 1)
            if (attempt === 1) return yield* Effect.fail(new LoadError({ reason: "transient" }))
            return "recovered"
          }).pipe(Effect.retry(Schedule.recurs(1)))
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      expect(yield* client.query(flaky)({}).get).toBe("recovered")
      expect(yield* Ref.get(attempts)).toBe(2)
    }))

  it.effect("recovers with a fresh attempt after a failed read", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({
        name: "users",
        load: () =>
          Effect.gen(function*() {
            const attempt = yield* Ref.updateAndGet(counter, (n) => n + 1)
            if (attempt === 1) return yield* Effect.fail(new LoadError({ reason: "down" }))
            return `v${attempt}`
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      expect((yield* Effect.flip(resource.get))._tag).toBe("LoadError")
      expect(yield* resource.get).toBe("v2")
    }))

  it.effect("keeps the previous success visible when a refresh fails", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({
        name: "users",
        staleTime: "10 minutes",
        load: () =>
          Effect.gen(function*() {
            const attempt = yield* Ref.updateAndGet(counter, (n) => n + 1)
            if (attempt === 1) return "v1"
            return yield* Effect.fail(new LoadError({ reason: "down" }))
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      expect(yield* resource.get).toBe("v1")
      expect(yield* Effect.flip(resource.refresh)).toBeInstanceOf(LoadError)
      const snapshot = yield* resource.snapshot
      if (!AsyncResult.isFailure(snapshot)) {
        return yield* Effect.die(new Error(`expected a failure snapshot, got ${snapshot._tag}`))
      }
      expect(snapshot.previousSuccess.pipe(Option.map((success) => success.value))).toEqual(Option.some("v1"))
    }))

  it.effect(
    "invalidation during an in-flight load lets current callers finish and gives later observers the new generation",
    () =>
      Effect.gen(function*() {
        const release1 = yield* Deferred.make<void>()
        const release2 = yield* Deferred.make<void>()
        const cancelled = yield* Deferred.make<void>()
        const starts = yield* Queue.unbounded<number>()
        const counter = yield* Ref.make(0)
        const users = Query.make({
          name: "users",
          staleTime: "10 minutes",
          load: () =>
            Effect.gen(function*() {
              const attempt = yield* Ref.updateAndGet(counter, (n) => n + 1)
              yield* Queue.offer(starts, attempt)
              yield* (attempt === 1 ? Deferred.await(release1) : Deferred.await(release2)).pipe(
                Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined))
              )
              return `v${attempt}`
            })
        })
        const client = yield* QueryClient.make({ layer: Layer.empty })
        const all = client.query(users)
        const resource = all({})
        const current = yield* Effect.forkScoped(resource.get)
        yield* Queue.take(starts)
        const observer = yield* Effect.forkScoped(
          Stream.runDrain(
            resource.changes.pipe(Stream.takeUntil(isSuccessWithValue("v2")))
          )
        )
        yield* resource.invalidate
        yield* Deferred.succeed(release1, undefined)
        expect(yield* Fiber.join(current)).toBe("v1")
        yield* Queue.take(starts)
        yield* Deferred.succeed(release2, undefined)
        expect(yield* Fiber.join(observer)).toBeUndefined()
        expect(yield* Deferred.isDone(cancelled)).toBe(false)
        expect(yield* Ref.get(counter)).toBe(2)
      })
  )

  it.effect("coalesces repeated invalidations and later readers into a single refetch", () =>
    Effect.gen(function*() {
      const gate = yield* makeGate()
      const { counter, starts } = yield* makeAttemptState()
      const users = Query.make({
        name: "users",
        staleTime: "10 minutes",
        load: () => gatedLoad(gate, starts, counter)
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const all = client.query(users)
      const resource = all({})
      const first = yield* Effect.forkScoped(resource.get)
      yield* Queue.take(starts)
      yield* resource.invalidate
      yield* all.invalidate
      yield* Deferred.succeed(gate.release, undefined)
      expect(yield* Fiber.join(first)).toBe("v1")
      const left = yield* Effect.forkScoped(resource.get)
      const right = yield* Effect.forkScoped(resource.get)
      yield* Queue.take(starts)
      expect(yield* noOfferYet(starts)).toBe(true)
      expect(yield* Fiber.join(left)).toBe("v2")
      expect(yield* Fiber.join(right)).toBe("v2")
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("invalidates every instantiated input through the family", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const task = Query.make({
        name: "task",
        staleTime: "10 minutes",
        load: (input: { readonly id: number }) =>
          countedValue(counter).pipe(Effect.map((value) => `${value}:${input.id}`))
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const byId = client.query(task)
      expect(yield* byId({ id: 1 }).get).toBe("v1:1")
      expect(yield* byId({ id: 2 }).get).toBe("v2:2")
      yield* byId.invalidate
      expect(yield* byId({ id: 1 }).get).toBe("v3:1")
      expect(yield* byId({ id: 2 }).get).toBe("v4:2")
      expect(yield* Ref.get(counter)).toBe(4)
    }))

  it.effect("cancels the in-flight read when the last interest is released", () =>
    Effect.gen(function*() {
      const gate = yield* makeGate()
      const { counter, starts } = yield* makeAttemptState()
      const users = Query.make({ name: "users", load: () => gatedLoad(gate, starts, counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      const reader = yield* Effect.forkScoped(resource.get)
      yield* Queue.take(starts)
      yield* Fiber.interrupt(reader)
      yield* Deferred.await(gate.cancelled)
      expect(yield* Deferred.isDone(gate.cancelled)).toBe(true)
    }))

  it.effect("keeps the in-flight read alive while another interest remains", () =>
    Effect.gen(function*() {
      const gate = yield* makeGate()
      const { counter, starts } = yield* makeAttemptState()
      const users = Query.make({ name: "users", load: () => gatedLoad(gate, starts, counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      const first = yield* Effect.forkScoped(resource.get, { startImmediately: true })
      yield* Queue.take(starts)
      const second = yield* Effect.forkScoped(resource.get, { startImmediately: true })
      yield* Fiber.interrupt(first)
      expect(yield* Deferred.isDone(gate.cancelled)).toBe(false)
      yield* Deferred.succeed(gate.release, undefined)
      expect(yield* Fiber.join(second)).toBe("v1")
      yield* Fiber.interrupt(second)
      expect(yield* Deferred.isDone(gate.cancelled)).toBe(false)
      expect(yield* Ref.get(counter)).toBe(1)
    }))

  it.effect("a reader that arrives while a cancellation is in progress gets a fresh load", () =>
    Effect.gen(function*() {
      const release = yield* Deferred.make<void>()
      const cancelled = yield* Deferred.make<void>()
      const proceed = yield* Deferred.make<void>()
      const starts = yield* Queue.unbounded<number>()
      const counter = yield* Ref.make(0)
      const users = Query.make({
        name: "users",
        staleTime: "10 minutes",
        load: () =>
          Effect.gen(function*() {
            const attempt = yield* Ref.updateAndGet(counter, (n) => n + 1)
            yield* Queue.offer(starts, attempt)
            yield* Deferred.await(release).pipe(
              Effect.onInterrupt(() =>
                Deferred.succeed(cancelled, undefined).pipe(Effect.flatMap(() => Deferred.await(proceed)))
              )
            )
            return `v${attempt}`
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      const leaving = yield* Effect.forkScoped(resource.get)
      yield* Queue.take(starts)
      yield* Fiber.interrupt(leaving)
      yield* Deferred.await(cancelled)
      const returning = yield* Effect.forkScoped(resource.get)
      yield* Deferred.succeed(release, undefined)
      yield* Deferred.succeed(proceed, undefined)
      yield* Queue.take(starts)
      expect(yield* Fiber.join(returning)).toBe("v2")
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("retains idle entries until gcTime and evicts them afterwards", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({
        name: "users",
        staleTime: "10 minutes",
        gcTime: "1 minute",
        load: () => countedValue(counter)
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const all = client.query(users)
      expect(yield* all({}).get).toBe("v1")
      yield* TestClock.adjust("30 seconds")
      expect(yield* all({}).get).toBe("v1")
      expect(yield* Ref.get(counter)).toBe(1)
      yield* TestClock.adjust("90 seconds")
      expect(yield* all({}).get).toBe("v2")
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("defaults gcTime to five minutes for idle entries", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({ name: "users", staleTime: "10 minutes", load: () => countedValue(counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const all = client.query(users)
      expect(yield* all({}).get).toBe("v1")
      yield* TestClock.adjust("4 minutes")
      yield* TestClock.adjust("59 seconds")
      expect(yield* all({}).get).toBe("v1")
      expect(yield* Ref.get(counter)).toBe(1)
      yield* TestClock.adjust("5 minutes")
      expect(yield* all({}).get).toBe("v2")
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("provides construction services to loaders and keeps resource effects env-free", () =>
    Effect.gen(function*() {
      const user = Query.make({
        name: "user",
        load: (input: { readonly id: number }) =>
          Effect.gen(function*() {
            const repo = yield* Repo
            return yield* repo.fetchName(input.id)
          })
      })
      const client = yield* QueryClient.make({
        layer: Layer.succeed(Repo, { fetchName: (id) => Effect.succeed(`user-${id}`) })
      })
      expect(yield* client.query(user)({ id: 7 }).get).toBe("user-7")
    }))

  it.effect("constructs from an already assembled context with makeWith", () =>
    Effect.gen(function*() {
      const user = Query.make({
        name: "user",
        load: (input: { readonly id: number }) =>
          Effect.gen(function*() {
            const repo = yield* Repo
            return yield* repo.fetchName(input.id)
          })
      })
      const client = yield* QueryClient.makeWith(Context.make(Repo, { fetchName: (id) => Effect.succeed(`ctx-${id}`) }))
      expect(yield* client.query(user)({ id: 3 }).get).toBe("ctx-3")
    }))

  it.effect("surfaces typed construction failures from make without building a client", () =>
    Effect.gen(function*() {
      const broken = Layer.effect(Repo, Effect.fail(new InitError({ reason: "unreachable" })))
      const error = yield* Effect.flip(QueryClient.make({ layer: broken }))
      expect(error).toBeInstanceOf(InitError)
    }))

  it.effect("closing the client interrupts in-flight reads", () =>
    Effect.gen(function*() {
      const gate = yield* makeGate()
      const { counter, starts } = yield* makeAttemptState()
      const users = Query.make({ name: "users", load: () => gatedLoad(gate, starts, counter) })
      yield* Effect.scoped(
        Effect.gen(function*() {
          const client = yield* QueryClient.make({ layer: Layer.empty })
          const resource = client.query(users)({})
          yield* Effect.forkScoped(resource.get)
          yield* Queue.take(starts)
        })
      )
      yield* Deferred.await(gate.cancelled)
      expect(yield* Deferred.isDone(gate.cancelled)).toBe(true)
    }))

  it.effect("finalizers started by loaders run by the time the client closes", () =>
    Effect.gen(function*() {
      const released = yield* Deferred.make<void>()
      const counter = yield* Ref.make(0)
      const users = Query.make({
        name: "users",
        staleTime: "10 minutes",
        load: () =>
          Effect.acquireRelease(
            Ref.updateAndGet(counter, (n) => n + 1),
            () => Deferred.succeed(released, undefined)
          )
      })
      yield* Effect.scoped(
        Effect.gen(function*() {
          const client = yield* QueryClient.make({ layer: Layer.empty })
          expect(yield* client.query(users)({}).get).toBe(1)
        })
      )
      yield* Deferred.await(released)
      expect(yield* Deferred.isDone(released)).toBe(true)
    }))

  it.effect("reads after the client closed are interrupted", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({ name: "users", load: () => countedValue(counter) })
      const resource = yield* Effect.scoped(
        Effect.map(QueryClient.make({ layer: Layer.empty }), (client) => client.query(users)({}))
      )
      const exit = yield* Effect.exit(resource.get)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(yield* Ref.get(counter)).toBe(0)
    }))

  it.effect("the changes stream reports the current state, waiting transitions, and the refreshed success", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({ name: "users", load: () => countedValue(counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      const emissions = yield* Stream.runCollect(
        resource.changes.pipe(
          Stream.tap((result) =>
            AsyncResult.isSuccess(result) && result.value === "v1" ? Effect.asVoid(resource.refresh) : Effect.void
          ),
          Stream.takeUntil(isSuccessWithValue("v2"))
        )
      )
      expect(emissions.some(isSuccessWithValue("v1"))).toBe(true)
      expect(emissions.some((result) => result.waiting)).toBe(true)
      const last = emissions[emissions.length - 1]
      if (!AsyncResult.isSuccess(last)) return yield* Effect.die(new Error("expected the stream to end on success v2"))
      expect(last.value).toBe("v2")
    }))

  it.effect("new subscribers observe the current state and trigger a reload when data is stale", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({ name: "users", load: () => countedValue(counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      yield* Stream.runDrain(resource.changes.pipe(Stream.takeUntil(AsyncResult.isSuccess)))
      expect(yield* Ref.get(counter)).toBe(1)
      yield* Stream.runDrain(resource.changes.pipe(Stream.takeUntil(isSuccessWithValue("v2"))))
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("an interrupted changes consumer cancels the in-flight load it last held", () =>
    Effect.gen(function*() {
      const gate = yield* makeGate()
      const { counter, starts } = yield* makeAttemptState()
      const users = Query.make({ name: "users", load: () => gatedLoad(gate, starts, counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      const observer = yield* Effect.forkScoped(Stream.runDrain(resource.changes))
      yield* Queue.take(starts)
      yield* Fiber.interrupt(observer)
      yield* Deferred.await(gate.cancelled)
      expect(yield* Deferred.isDone(gate.cancelled)).toBe(true)
    }))
})
