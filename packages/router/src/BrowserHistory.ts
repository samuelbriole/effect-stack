/**
 * Browser History API adapter.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as History from "./History.ts"

const StateKey = "@effect-web/router/history-state"

const BrowserMetadata = Schema.Struct({
  version: Schema.Literal(1),
  key: Schema.String.check(
    Schema.isPattern(/^browser-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  ),
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

const historyError = (operation: History.HistoryError["operation"]) => (cause: unknown): History.HistoryError =>
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
export const make = Effect.fn("BrowserHistory.make")(function*() {
  const browser = yield* Effect.try({ try: requireWindow, catch: historyError("current") })

  const current: Effect.Effect<History.Location, History.HistoryError> = Effect.try({
    try: () => {
      let metadata = browserState(browser.history.state)
      if (metadata === undefined) {
        metadata = { version: 1, key: makeKey(browser), index: 0, value: browser.history.state }
        browser.history.replaceState({ [StateKey]: metadata }, "")
      }
      return {
        pathname: browser.location.pathname,
        search: browser.location.search,
        hash: browser.location.hash,
        state: metadata.value,
        key: metadata.key,
        index: metadata.index
      }
    },
    catch: historyError("current")
  })

  yield* current

  const push = Effect.fn("BrowserHistory.push")(function*(destination: History.Destination) {
    const previous = yield* current
    const key = makeKey(browser)
    yield* Effect.try({
      try: () =>
        browser.history.pushState(
          makeState(key, previous.index + 1, destination.state),
          "",
          History.toHref(destination)
        ),
      catch: historyError("push")
    })
    return yield* current
  })

  const replace = Effect.fn("BrowserHistory.replace")(function*(destination: History.Destination) {
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

  const go = Effect.fn("BrowserHistory.go")(function*(delta: number) {
    yield* Effect.try({
      try: () => browser.history.go(Number.isFinite(delta) ? Math.trunc(delta) : 0),
      catch: historyError("go")
    })
  })

  return History.Service.of({
    current,
    push,
    replace,
    go,
    changes: Stream.fromEventListener<PopStateEvent>(browser, "popstate").pipe(
      Stream.mapEffect(() => current)
    )
  })
})

/**
 * Provides browser-backed History.
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<History.Service, History.HistoryError> = Layer.effect(History.Service, make())
