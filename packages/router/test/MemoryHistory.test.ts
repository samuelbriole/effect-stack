import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"

describe("MemoryHistory", () => {
  it.effect("supports push, replace, and traversal", () =>
    Effect.gen(function*() {
      const history = yield* MemoryHistory.make("/first")
      yield* history.push({ pathname: "/second", search: "?page=2", hash: "", state: { source: "push" } })
      yield* history.replace({ pathname: "/replacement", search: "", hash: "#details" })

      const change = yield* Stream.runHead(history.changes).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* history.go(-1)
      const previous = yield* Fiber.join(change)

      expect(previous._tag).toBe("Some")
      if (previous._tag === "Some") {
        expect(previous.value.pathname).toBe("/first")
      }

      const entries = yield* history.entries
      expect(entries).toHaveLength(2)
      expect(entries[1].pathname).toBe("/replacement")
      expect(entries[1].hash).toBe("#details")
    }))

  it.effect("truncates forward entries after a new push", () =>
    Effect.gen(function*() {
      const history = yield* MemoryHistory.make("/one")
      yield* history.push({ pathname: "/two", search: "", hash: "" })
      yield* history.push({ pathname: "/three", search: "", hash: "" })
      yield* history.go(-1)
      yield* history.push({ pathname: "/replacement", search: "", hash: "" })

      const entries = yield* history.entries
      expect(entries.map((entry) => entry.pathname)).toEqual(["/one", "/two", "/replacement"])
    }))

  it.effect("emits bounded traversal changes in exact order without push duplicates", () =>
    Effect.gen(function*() {
      const history = yield* MemoryHistory.make("/one")
      const changes = yield* Ref.make<ReadonlyArray<string>>([])
      const listener = yield* history.changes.pipe(
        Stream.take(3),
        Stream.runForEach((location) => Ref.update(changes, (current) => [...current, location.pathname])),
        Effect.forkChild
      )
      yield* Effect.yieldNow

      yield* history.push({ pathname: "/two", search: "", hash: "", state: { step: 2 } })
      yield* history.push({ pathname: "/three", search: "", hash: "", state: { step: 3 } })
      expect(yield* Ref.get(changes)).toEqual([])

      yield* history.go(-20)
      yield* history.go(1)
      yield* history.go(20)
      yield* Fiber.join(listener)

      expect(yield* Ref.get(changes)).toEqual(["/one", "/two", "/three"])
      expect((yield* history.current).state).toEqual({ step: 3 })
    }))

  it.effect("closes its change stream with its Scope", () =>
    Effect.gen(function*() {
      const history = yield* Effect.scoped(MemoryHistory.make("/closed"))
      const change = yield* Stream.runHead(history.changes)
      expect(Option.isNone(change)).toBe(true)
    }))

  it.effect("ignores non-finite traversal deltas", () =>
    Effect.gen(function*() {
      const history = yield* MemoryHistory.make("/one")
      yield* history.push({ pathname: "/two", search: "", hash: "" })

      yield* history.go(Number.NaN)
      expect((yield* history.current).pathname).toBe("/two")
      yield* history.go(Number.POSITIVE_INFINITY)
      expect((yield* history.current).pathname).toBe("/two")
    }))
})
