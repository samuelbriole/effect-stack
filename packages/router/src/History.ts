/**
 * Renderer-neutral navigation history.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"

/**
 * A normalized history location.
 *
 * @since 0.1.0
 * @category models
 */
export interface Location {
  readonly pathname: string
  readonly search: string
  readonly hash: string
  readonly state: unknown
  readonly key: string
  readonly index: number
}

/**
 * Input accepted by history push and replace operations.
 *
 * @since 0.1.0
 * @category models
 */
export interface Destination {
  readonly pathname: string
  readonly search: string
  readonly hash: string
  readonly state?: unknown
}

/**
 * A browser or history adapter operation failed.
 *
 * @since 0.1.0
 * @category errors
 */
export class HistoryError extends Schema.TaggedError<HistoryError>()("@effect-web/router/HistoryError", {
  operation: Schema.Literals(["current", "push", "replace", "go"]),
  message: Schema.String,
  cause: Schema.Defect()
}) {}

/**
 * The history interface consumed by Router.
 *
 * Direct push and replace operations do not emit on `changes`; that stream is
 * reserved for externally driven traversal such as browser `popstate`.
 *
 * @since 0.1.0
 * @category models
 */
export interface Interface {
  readonly current: Effect.Effect<Location, HistoryError>
  readonly push: (destination: Destination) => Effect.Effect<Location, HistoryError>
  readonly replace: (destination: Destination) => Effect.Effect<Location, HistoryError>
  readonly go: (delta: number) => Effect.Effect<void, HistoryError>
  readonly changes: Stream.Stream<Location, HistoryError>
}

/**
 * Active navigation history.
 *
 * @since 0.1.0
 * @category services
 */
export class Service extends Context.Service<Service, Interface>()("@effect-web/router/History") {}

/**
 * Converts a destination to a relative href.
 *
 * @since 0.1.0
 * @category utilities
 */
export const toHref = (location: Pick<Location | Destination, "pathname" | "search" | "hash">): string =>
  `${location.pathname}${location.search}${location.hash}`

/**
 * Parses a relative or absolute href into URL parts.
 *
 * @since 0.1.0
 * @category utilities
 */
export const destinationFromHref = (href: string, state?: unknown): Destination => {
  const url = new URL(href, "https://effect-web.invalid")
  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    ...(state === undefined ? {} : { state })
  }
}
