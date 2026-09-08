import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { type ClientInternal, makeClient } from "./internal/core.ts"
import type * as Mutation from "./Mutation.ts"
import type * as Query from "./Query.ts"

const TypeId: unique symbol = Symbol.for("@effect-stack/query/QueryClient")

interface Variance<in R> {
  readonly _R: (service: R) => void
}

/**
 * A scoped, authoritative query and mutation runtime for the services `R`.
 * Bound operations share this client's services and require no Atom registry.
 * The service capacity is retained contravariantly across structural wrappers.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryClient<in R> {
  readonly [TypeId]: Variance<R>
  readonly query: <I, A, E, R2 extends R | Scope.Scope>(
    definition: Query.Query<I, A, E, R2>
  ) => Query.Family<I, A, E>
  readonly mutation: <I, A, E, R2 extends R | Scope.Scope>(
    definition: Mutation.Mutation<I, A, E, R2>
  ) => Effect.Effect<Mutation.Handle<I, A, E>>
}

const withCapacity = <R>(client: ClientInternal<R>): QueryClient<R> =>
  Object.assign(client, {
    [TypeId]: {
      _R: (_service: R): void => {}
    }
  })

/**
 * Builds the supplied Layer once and keeps it alive for the client scope.
 * Layer failures belong to construction. Closing the owner scope interrupts
 * accepted work and waits for its finalizers before releasing dependencies.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <R, E, RIn>(options: {
  readonly layer: Layer.Layer<R, E, RIn>
}): Effect.Effect<QueryClient<R>, E, RIn | Scope.Scope> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const services = yield* Layer.buildWithScope(options.layer, scope)
    return yield* Effect.withFiber((fiber) => {
      const captured = Context.omit(Scope.Scope)(
        Context.merge(Context.omit(Scope.Scope)(fiber.context), services)
      ) as Context.Context<R>
      return makeClient(captured).pipe(Effect.map(withCapacity))
    })
  })

/**
 * Creates a client from an already assembled immutable service context.
 * Borrowed services must outlive the client. Every execution receives its own
 * child scope, even when the supplied context contains a Scope service.
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeWith = <R>(services: Context.Context<R>): Effect.Effect<QueryClient<R>, never, Scope.Scope> =>
  Effect.gen(function*() {
    return yield* Effect.withFiber((fiber) => {
      const captured = Context.omit(Scope.Scope)(
        Context.merge(Context.omit(Scope.Scope)(fiber.context), services)
      ) as Context.Context<R>
      return makeClient(captured).pipe(Effect.map(withCapacity))
    })
  })
