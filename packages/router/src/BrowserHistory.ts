/**
 * Browser History API adapter.
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as History from "./History.ts"

const StateKey = "@effect-stack/router/history-state"

const BrowserMetadata = Schema.Struct({
  version: Schema.Literal(1),
  key: Schema.String.check(Schema.isPattern(/^browser-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)),
  index: Schema.Int,
  value: Schema.Unknown
})

const BrowserState = Schema.Struct({
  [StateKey]: BrowserMetadata
})

type BrowserMetadata = typeof BrowserMetadata.Type
type BrowserState = typeof BrowserState.Type

const browserState = (value: unknown): BrowserMetadata | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(BrowserState)(value))?.[StateKey]

const makeState = (key: string, index: number, value: unknown): BrowserState => ({
  [StateKey]: { version: 1, key, index, value }
})

const makeKey = (browser: Window): string => `browser-${browser.crypto.randomUUID()}`

const historyError =
  (operation: History.HistoryError["operation"]) =>
  (cause: unknown): History.HistoryError =>
    new History.HistoryError({
      operation,
      message: cause instanceof Error ? cause.message : String(cause),
      cause
    })

const requireWindow = (): Window => {
  if (typeof window === "undefined") {
    throw new Error("BrowserHistory requires a Window")
  }
  return window
}

/**
 * Creates a browser History service value.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = Effect.fn("BrowserHistory.make")(function* () {
  const browser = yield* Effect.try({ try: requireWindow, catch: historyError("current") })
  const context = yield* Effect.context<never>().pipe(Effect.map(Context.omit(Scope.Scope)))

  // Only the read-only snapshot is replayed: two retries after 25ms and 50ms.
  const read = Effect.try({
    try: () => {
      const state: unknown = browser.history.state
      return {
        pathname: browser.location.pathname,
        search: browser.location.search,
        hash: browser.location.hash,
        state,
        metadata: browserState(state)
      }
    },
    catch: historyError("current")
  }).pipe(
    Effect.exit,
    // Retry only typed-only exits, keeping their original complete Cause.
    Effect.flatMap((exit) =>
      Exit.isFailure(exit) && !Cause.hasDies(exit.cause) && !Cause.hasInterrupts(exit.cause)
        ? Effect.fail(exit)
        : Effect.succeed(exit)
    ),
    Effect.retry(Schedule.exponential("25 millis").pipe(Schedule.upTo({ times: 2 }))),
    Effect.catch((exit) => Effect.succeed(exit)),
    Effect.flatMap((exit) => exit)
  )

  const repair = (snapshot: Effect.Success<typeof read>): Effect.Effect<History.Location, History.HistoryError> =>
    Effect.try({
      try: () => {
        let metadata = snapshot.metadata
        if (metadata === undefined) {
          metadata = { version: 1, key: makeKey(browser), index: 0, value: snapshot.state }
          browser.history.replaceState({ [StateKey]: metadata }, "")
        }
        return {
          pathname: snapshot.pathname,
          search: snapshot.search,
          hash: snapshot.hash,
          state: metadata.value,
          key: metadata.key,
          index: metadata.index
        }
      },
      catch: historyError("current")
    })

  const current = read.pipe(Effect.flatMap(repair))

  const observePhase = <A>(effect: Effect.Effect<A, History.HistoryError>, phase: "read" | "repair") =>
    effect.pipe(
      Effect.map(Option.some),
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          if (Cause.hasDies(cause) || Cause.hasInterrupts(cause)) {
            return yield* Effect.failCause(cause)
          }
          yield* Effect.logError("BrowserHistory.popstate failed", cause).pipe(
            Effect.annotateLogs({
              operation: "BrowserHistory.popstate",
              phase,
              retries: phase === "read" ? 2 : 0,
              observation: "skipped"
            }),
            Effect.provideContext(context),
            // Failed diagnostic emission is terminal, but must not replace the
            // observation failure that prompted it.
            Effect.catchCause((loggingCause) => Effect.failCause(Cause.combine(cause, loggingCause)))
          )
          return Option.none<A>()
        })
      )
    )

  yield* current

  const push = Effect.fn("BrowserHistory.push")(function* (destination: History.Destination) {
    const previous = yield* current
    yield* Effect.try({
      try: () => {
        const key = makeKey(browser)
        browser.history.pushState(
          makeState(key, previous.index + 1, destination.state),
          "",
          History.toHref(destination)
        )
      },
      catch: historyError("push")
    })
    return yield* current
  })

  const replace = Effect.fn("BrowserHistory.replace")(function* (destination: History.Destination) {
    const previous = yield* current
    yield* Effect.try({
      try: () =>
        browser.history.replaceState(
          makeState(previous.key, previous.index, destination.state),
          "",
          History.toHref(destination)
        ),
      catch: historyError("replace")
    })
    return yield* current
  })

  const go = Effect.fn("BrowserHistory.go")(function* (delta: number) {
    yield* Effect.try({
      try: () => browser.history.go(Number.isFinite(delta) ? Math.trunc(delta) : 0),
      catch: historyError("go")
    })
  })

  return History.History.of({
    current,
    push,
    replace,
    go,
    changes: Stream.fromEventListener<PopStateEvent>(browser, "popstate").pipe(
      Stream.mapEffect(() =>
        Effect.gen(function* () {
          const snapshot = yield* observePhase(read, "read")
          if (Option.isNone(snapshot)) return Option.none<History.Location>()
          return yield* observePhase(repair(snapshot.value), "repair")
        })
      ),
      Stream.filter(Option.isSome),
      Stream.map((location) => location.value)
    )
  })
})

/**
 * Provides browser-backed History.
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<History.History, History.HistoryError> = Layer.effect(History.History, make())
