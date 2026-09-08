import * as Duration from "effect/Duration"
import type * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"

const QueryTypeId: unique symbol = Symbol.for("@effect-stack/query/Query")

/**
 * The identity of a query and the loader used for each structurally equal input.
 *
 * @since 0.1.0
 * @category models
 */
export interface Query<in I, out A, out E = never, out R = never> {
  readonly [QueryTypeId]: typeof QueryTypeId
  readonly _tag: "Query"
  readonly name: string
  readonly load: (input: I) => Effect.Effect<A, E, R>
  readonly staleTime: Duration.Duration
  readonly gcTime: Duration.Duration
}

/**
 * A loader and its resource-wide freshness and inactive-retention policy.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options<I, A, E, R> {
  readonly name: string
  readonly load: (input: I) => Effect.Effect<A, E, R>
  readonly staleTime?: Duration.Input
  readonly gcTime?: Duration.Input
}

/**
 * A bound resource shared by Effect readers and scoped observers.
 * Its dependencies have already been supplied by the client.
 *
 * @since 0.1.0
 * @category models
 */
export interface Resource<A, E> {
  /** Returns cached data while fresh, otherwise joins the deduplicated load. */
  readonly get: Effect.Effect<A, E>
  /** Forces this generation to load and joins it. */
  readonly refresh: Effect.Effect<A, E>
  /** Marks the resource stale without discarding retained state. */
  readonly invalidate: Effect.Effect<void>
  readonly snapshot: Effect.Effect<AsyncResult.AsyncResult<A, E>>
  /** Current state followed by updates. Subscribing holds an observer lease. */
  readonly changes: Stream.Stream<AsyncResult.AsyncResult<A, E>>
}

/**
 * Pure resource lookup by immutable input, with whole-definition invalidation.
 *
 * @since 0.1.0
 * @category models
 */
export interface Family<I, A, E> {
  (input: I): Resource<A, E>
  /** Marks every instantiated input in this family stale. */
  readonly invalidate: Effect.Effect<void>
}

/**
 * Creates an opaque query definition. Definition identity is referential.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <I, A, E = never, R = never>(options: Options<I, A, E, R>): Query<I, A, E, R> => {
  const staleTime = Duration.fromInputUnsafe(options.staleTime ?? 0)
  const gcTime = Duration.fromInputUnsafe(options.gcTime ?? "5 minutes")
  return Object.freeze({
    [QueryTypeId]: QueryTypeId as typeof QueryTypeId,
    _tag: "Query" as const,
    name: options.name,
    load: options.load,
    staleTime,
    gcTime
  })
}

/**
 * The constraint for a query definition with any inferred parameters.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Any = Query<never, unknown, unknown, unknown>
/**
 * Extracts a definition's input.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Input<Q extends Any> = Q extends Query<infer I, unknown, unknown, unknown> ? I
  : never
/**
 * Extracts a definition's success value.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Success<Q extends Any> = Q extends Query<never, infer A, unknown, unknown> ? A
  : never
/**
 * Extracts a definition's expected failures.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Error<Q extends Any> = Q extends Query<never, unknown, infer E, unknown> ? E
  : never
/**
 * Extracts a definition's required services.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Services<Q extends Any> = Q extends Query<never, unknown, unknown, infer R> ? R
  : never
