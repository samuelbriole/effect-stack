/**
 * Browser History API adapter.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as History from "./History.ts"

const StateKey = "__effectWebRouter"

interface BrowserState {
  readonly [StateKey]?: {
    readonly key: string
    readonly index: number
    readonly value: unknown
  }
}

let nextKey = 0

const browserState = (value: unknown): BrowserState[typeof StateKey] | undefined => {
  if (typeof value !== "object" || value === null || !(StateKey in value)) {
    return undefined
  }
  const metadata = Reflect.get(value, StateKey)
  if (typeof metadata !== "object" || metadata === null) {
    return undefined
  }
  const key = Reflect.get(metadata, "key")
  const index = Reflect.get(metadata, "index")
  if (typeof key !== "string" || typeof index !== "number") {
    return undefined
  }
  return { key, index, value: Reflect.get(metadata, "value") }
}

const makeState = (key: string, index: number, value: unknown): BrowserState => ({
  [StateKey]: { key, index, value }
})

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

  const read = (): History.Location => {
    const metadata = browserState(browser.history.state)
    return {
      pathname: browser.location.pathname,
      search: browser.location.search,
      hash: browser.location.hash,
      state: metadata?.value,
      key: metadata?.key ?? "browser-initial",
      index: metadata?.index ?? 0
    }
  }

  if (browserState(browser.history.state) === undefined) {
    yield* Effect.try({
      try: () => browser.history.replaceState(makeState("browser-initial", 0, browser.history.state), ""),
      catch: historyError("replace")
    })
  }

  const current = Effect.try({ try: read, catch: historyError("current") })

  const push = Effect.fn("BrowserHistory.push")(function*(destination: History.Destination) {
    const previous = yield* current
    const key = `browser-${++nextKey}`
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
      try: () => browser.history.go(Math.trunc(delta)),
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
