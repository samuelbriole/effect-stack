/**
 * Deterministic in-memory history.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as History from "./History.ts"

interface State {
  readonly entries: ReadonlyArray<History.Location>
  readonly index: number
  readonly nextKey: number
}

/**
 * In-memory history with inspection operations useful to tests and non-browser
 * hosts.
 *
 * @since 0.1.0
 * @category models
 */
export interface MemoryHistory extends History.Interface {
  readonly entries: Effect.Effect<ReadonlyArray<History.Location>>
}

const location = (
  destination: History.Destination,
  key: string,
  index: number
): History.Location => ({
  pathname: destination.pathname,
  search: destination.search,
  hash: destination.hash,
  state: destination.state,
  key,
  index
})

/**
 * Creates an in-memory history for the current Scope.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = Effect.fn("MemoryHistory.make")(function*(initialHref = "/") {
  const changes = yield* Effect.acquireRelease(
    PubSub.unbounded<History.Location>(),
    PubSub.shutdown
  )
  const initial = location(History.destinationFromHref(initialHref), "memory-0", 0)
  const state = yield* Ref.make<State>({ entries: [initial], index: 0, nextKey: 1 })

  const current: Effect.Effect<History.Location> = Ref.get(state).pipe(
    Effect.map((value) => value.entries[value.index])
  )

  const push = Effect.fn("MemoryHistory.push")(function*(destination: History.Destination) {
    return yield* Ref.modify(state, (value) => {
      const entries = value.entries.slice(0, value.index + 1)
      const next = location(destination, `memory-${value.nextKey}`, entries.length)
      return [next, {
        entries: [...entries, next],
        index: entries.length,
        nextKey: value.nextKey + 1
      }]
    })
  })

  const replace = Effect.fn("MemoryHistory.replace")(function*(destination: History.Destination) {
    return yield* Ref.modify(state, (value) => {
      const next = location(destination, value.entries[value.index].key, value.index)
      const entries = [...value.entries]
      entries[value.index] = next
      return [next, { ...value, entries }]
    })
  })

  const go = Effect.fn("MemoryHistory.go")(function*(delta: number) {
    const changed = yield* Ref.modify(state, (value) => {
      const index = Math.max(0, Math.min(value.entries.length - 1, value.index + Math.trunc(delta)))
      if (index === value.index) {
        return [undefined, value] as const
      }
      return [value.entries[index], { ...value, index }] as const
    })
    if (changed !== undefined) {
      yield* PubSub.publish(changes, changed)
    }
  })

  return {
    current,
    push,
    replace,
    go,
    changes: Stream.fromPubSub(changes),
    entries: Ref.get(state).pipe(Effect.map((value) => value.entries))
  } satisfies MemoryHistory
})

/**
 * Provides a fresh in-memory History service.
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (initialHref = "/"): Layer.Layer<History.Service> =>
  Layer.effect(History.Service, make(initialHref))
