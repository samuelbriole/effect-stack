import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type * as Stream from "effect/Stream"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"

const MutationTypeId: unique symbol = Symbol.for("@effect-stack/query/Mutation")

/**
 * A reusable write definition. Each accepted invocation executes independently.
 *
 * @since 0.1.0
 * @category models
 */
export interface Mutation<in I, out A, out E = never, out R = never> {
  readonly [MutationTypeId]: typeof MutationTypeId
  readonly _tag: "Mutation"
  readonly name: string
  readonly execute: (input: I) => Effect.Effect<A, E, R>
}

/**
 * An effectful write, including any composed retry or post-success invalidation.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options<I, A, E, R> {
  readonly name: string
  readonly execute: (input: I) => Effect.Effect<A, E, R>
}

/**
 * The most recently started invocation, regardless of completion order.
 *
 * @since 0.1.0
 * @category models
 */
export interface Latest<I, A, E> {
  readonly id: InvocationId
  readonly input: I
  readonly result: AsyncResult.AsyncResult<A, E>
}

/**
 * Controller state. The latest result describes one invocation; pendingCount
 * includes every unfinished invocation belonging to this controller.
 *
 * @since 0.1.0
 * @category models
 */
export interface State<I, A, E> {
  readonly latest: Option.Option<Latest<I, A, E>>
  readonly pendingCount: number
}

declare const InvocationIdTypeId: unique symbol

/**
 * Opaque identity of one accepted mutation invocation.
 *
 * @since 0.1.0
 * @category models
 */
export type InvocationId = number & { readonly [InvocationIdTypeId]: typeof InvocationIdTypeId }

/**
 * The independent completion and interruption handle of an accepted write.
 * Interrupting a waiter does not interrupt this client-owned invocation.
 *
 * @since 0.1.0
 * @category models
 */
export interface Invocation<A, E> {
  readonly id: InvocationId
  readonly await: Effect.Effect<A, E>
  /** Interrupts this invocation and completes after all of its finalizers. */
  readonly interrupt: Effect.Effect<void>
}

/**
 * A bound mutation controller with concurrent invocation tracking.
 *
 * @since 0.1.0
 * @category models
 */
export interface Handle<I, A, E> {
  readonly start: (input: I) => Effect.Effect<Invocation<A, E>>
  readonly execute: (input: I) => Effect.Effect<A, E>
  readonly snapshot: Effect.Effect<State<I, A, E>>
  readonly changes: Stream.Stream<State<I, A, E>>
}

/**
 * Defines a mutation without starting work or allocating a controller.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <I, A, E = never, R = never>(options: Options<I, A, E, R>): Mutation<I, A, E, R> =>
  Object.freeze({
    [MutationTypeId]: MutationTypeId as typeof MutationTypeId,
    _tag: "Mutation" as const,
    name: options.name,
    execute: options.execute
  })

/**
 * The constraint for a mutation definition with any inferred parameters.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Any = Mutation<never, unknown, unknown, unknown>
/**
 * Extracts a definition's input.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Input<M extends Any> = M extends Mutation<infer I, unknown, unknown, unknown> ? I
  : never
/**
 * Extracts a definition's success value.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Success<M extends Any> = M extends Mutation<never, infer A, unknown, unknown> ? A
  : never
/**
 * Extracts a definition's expected failures.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Error<M extends Any> = M extends Mutation<never, unknown, infer E, unknown> ? E
  : never
/**
 * Extracts a definition's required services.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Services<M extends Any> = M extends Mutation<never, unknown, unknown, infer R> ? R
  : never
