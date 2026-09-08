import * as Mutation from "@effect-stack/query/Mutation"
import * as Query from "@effect-stack/query/Query"
import * as QueryAtom from "@effect-stack/query/QueryAtom"
import * as QueryClient from "@effect-stack/query/QueryClient"
import { describe, expect, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

class SubmitError extends Schema.TaggedError<SubmitError>()("SubmitError", {
  reason: Schema.String
}) {}

const makeRegistry = Effect.fn("QueryAtomTest.makeRegistry")(function*() {
  const registry = AtomRegistry.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
  return registry
})

const countedValue = (counter: Ref.Ref<number>) =>
  Ref.updateAndGet(counter, (n) => n + 1).pipe(Effect.map((n) => `v${n}`))

const waitAtom = <A>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<A>,
  predicate: (value: A) => boolean
): Effect.Effect<A> =>
  Effect.gen(function*() {
    let value = registry.get(atom)
    while (!predicate(value)) {
      yield* Effect.yieldNow
      value = registry.get(atom)
    }
    return value
  })

describe("QueryAtom", () => {
  it.effect("query atoms are read-only and stable per structural input", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const users = Query.make({ name: "users", load: () => countedValue(counter) })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const all = client.query(users)
      const atom = QueryAtom.query(all({}))
      expect(Atom.isAtom(atom)).toBe(true)
      expect(Atom.isWritable(atom)).toBe(false)
      expect(QueryAtom.query(all({}))).toBe(atom)
    }))

  it.effect("a mounted query atom loads on mount and settles on success", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const counter = yield* Ref.make(0)
      const users = Query.make({
        name: "users",
        load: () =>
          Effect.gen(function*() {
            const attempt = yield* Ref.updateAndGet(counter, (n) => n + 1)
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
            return `v${attempt}`
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const atom = QueryAtom.query(client.query(users)({}))
      const registry = yield* makeRegistry()
      const settled = yield* Effect.forkScoped(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
      yield* Deferred.await(started)
      const waiting = yield* waitAtom(registry, atom, (result) => result.waiting)
      expect(waiting._tag).toBe("Initial")
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(settled)).toBe("v1")
      const success = yield* waitAtom(
        registry,
        atom,
        (result) => AsyncResult.isSuccess(result) && result.value === "v1"
      )
      expect(success.waiting).toBe(false)
      expect(yield* Ref.get(counter)).toBe(1)
    }))

  it.effect("a new observer joins the in-flight generation instead of refetching", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const counter = yield* Ref.make(0)
      const users = Query.make({
        name: "users",
        staleTime: "10 minutes",
        load: () =>
          Effect.gen(function*() {
            const attempt = yield* Ref.updateAndGet(counter, (n) => n + 1)
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
            return `v${attempt}`
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      const first = yield* Effect.forkScoped(resource.get)
      yield* Deferred.await(started)
      const registry = yield* makeRegistry()
      const atom = QueryAtom.query(resource)
      yield* AtomRegistry.mount(registry, atom)
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(first)).toBe("v1")
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toBe("v1")
      expect(yield* Ref.get(counter)).toBe(1)
    }))

  it.effect("two registries and a direct effect reader share a single load", () =>
    Effect.gen(function*() {
      const release = yield* Deferred.make<void>()
      const starts = yield* Queue.unbounded<number>()
      const counter = yield* Ref.make(0)
      const users = Query.make({
        name: "users",
        load: () =>
          Effect.gen(function*() {
            const attempt = yield* Ref.updateAndGet(counter, (n) => n + 1)
            yield* Queue.offer(starts, attempt)
            yield* Deferred.await(release)
            return `v${attempt}`
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      const atom = QueryAtom.query(resource)
      const left = yield* makeRegistry()
      const right = yield* makeRegistry()
      yield* AtomRegistry.mount(left, atom)
      yield* AtomRegistry.mount(right, atom)
      const reader = yield* Effect.forkScoped(resource.get, { startImmediately: true })
      yield* Queue.take(starts)
      expect(yield* Queue.poll(starts).pipe(Effect.map(Option.isNone))).toBe(true)
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(reader)).toBe("v1")
      expect(yield* AtomRegistry.getResult(left, atom)).toBe("v1")
      expect(yield* AtomRegistry.getResult(right, atom)).toBe("v1")
      expect(yield* Ref.get(counter)).toBe(1)
    }))

  it.effect("losing the last atom subscription cancels the in-flight load", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const blocked = yield* Deferred.make<void>()
      const cancelled = yield* Deferred.make<void>()
      const users = Query.make({
        name: "users",
        load: () =>
          Effect.gen(function*() {
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(blocked).pipe(
              Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined))
            )
            return "done"
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const atom = QueryAtom.query(client.query(users)({}))
      const registry = yield* makeRegistry()
      const unsubscribe = registry.mount(atom)
      yield* Deferred.await(started)
      unsubscribe()
      yield* Deferred.await(cancelled)
      expect(yield* Deferred.isDone(cancelled)).toBe(true)
    }))

  it.effect("invalidating a mounted atom re-observes the new generation", () =>
    Effect.gen(function*() {
      const release2 = yield* Deferred.make<void>()
      const starts = yield* Queue.unbounded<number>()
      const counter = yield* Ref.make(0)
      const users = Query.make({
        name: "users",
        staleTime: "10 minutes",
        load: () =>
          Effect.gen(function*() {
            const attempt = yield* Ref.updateAndGet(counter, (n) => n + 1)
            yield* Queue.offer(starts, attempt)
            if (attempt === 2) yield* Deferred.await(release2)
            return `v${attempt}`
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const resource = client.query(users)({})
      const atom = QueryAtom.query(resource)
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, atom)
      yield* Queue.take(starts)
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toBe("v1")
      yield* resource.invalidate
      yield* Queue.take(starts)
      yield* Deferred.succeed(release2, undefined)
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toBe("v2")
      expect(yield* Ref.get(counter)).toBe(2)
    }))

  it.effect("mutation atoms reflect running, success, and failure transitions", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const failNext = yield* Ref.make(false)
      const addItem = Mutation.make({
        name: "addItem",
        execute: (input: { readonly item: string }) =>
          Effect.gen(function*() {
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
            if (yield* Ref.get(failNext)) return yield* Effect.fail(new SubmitError({ reason: "down" }))
            return `${input.item}!`
          })
      })
      const client = yield* QueryClient.make({ layer: Layer.empty })
      const handle = yield* client.mutation(addItem)
      const atom = QueryAtom.mutation(handle)
      expect(Atom.isWritable(atom)).toBe(false)
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, atom)
      expect(registry.get(atom)).toEqual({ latest: Option.none(), pendingCount: 0 })

      const invocation = yield* handle.start({ item: "a" })
      yield* Deferred.await(started)
      const running = yield* waitAtom(
        registry,
        atom,
        (state) => state.pendingCount === 1 && Option.isSome(state.latest)
      )
      expect(running.latest.pipe(Option.map((latest) => latest.result.waiting))).toEqual(Option.some(true))
      yield* Deferred.succeed(release, undefined)
      expect(yield* invocation.await).toBe("a!")
      const succeeded = yield* waitAtom(
        registry,
        atom,
        (state) =>
          state.pendingCount === 0 &&
          Option.isSome(state.latest) &&
          AsyncResult.isSuccess(state.latest.value.result) &&
          state.latest.value.result.value === "a!"
      )
      expect(succeeded.pendingCount).toBe(0)

      yield* Ref.set(failNext, true)
      const second = yield* handle.start({ item: "b" })
      expect((yield* Effect.flip(second.await))._tag).toBe("SubmitError")
      const failed = yield* waitAtom(
        registry,
        atom,
        (state) => Option.isSome(state.latest) && AsyncResult.isFailure(state.latest.value.result)
      )
      expect(failed.pendingCount).toBe(0)
      if (Option.isSome(failed.latest)) expect(failed.latest.value.input).toEqual({ item: "b" })
    }))
})
