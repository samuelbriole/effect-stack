// Shared deterministic scaffolding for the query-vue DOM tests.
// Clients live on a manually closed Scope so mounts can outlive one Effect run;
// loaders and mutations gate on Deferreds, and every "settle" is a
// subscribe/Deferred join plus a Vue flush, never a sleep.
import { QueryClient } from "@effect-stack/query"
import type * as Mutation from "@effect-stack/query/Mutation"
import { Cause, Context, Deferred, Effect, Exit, Scope } from "effect"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as Atom from "effect/unstable/reactivity/Atom"
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

export interface Gate {
  readonly started: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
  readonly cancelled: Deferred.Deferred<void>
}

export const makeGate = (): Gate => ({
  started: Effect.runSync(Deferred.make<void>()),
  release: Effect.runSync(Deferred.make<void>()),
  cancelled: Effect.runSync(Deferred.make<void>())
})

/** Awaits the gate, signaling interruption instead of committing. */
export const gated = <A>(gate: Gate, value: () => A) =>
  Effect.gen(function*() {
    yield* Deferred.succeed(gate.started, undefined)
    yield* Deferred.await(gate.release).pipe(
      Effect.onInterrupt(() => Deferred.succeed(gate.cancelled, undefined))
    )
    return value()
  })

export const makeScopedClient = (): {
  readonly client: QueryClient.QueryClient<never>
  readonly dispose: () => Promise<void>
} => {
  const scope = Scope.makeUnsafe()
  const client = Effect.runSync(
    QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
  )
  return { client, dispose: () => Effect.runPromise(Scope.close(scope, Exit.void)) }
}

export const formatResult = (result: AsyncResult.AsyncResult<unknown, unknown>): string => {
  switch (result._tag) {
    case "Initial":
      return result.waiting ? "waiting" : "initial"
    case "Success":
      return `success:${String(result.value)}`
    case "Failure":
      return `failure:${String(Cause.squash(result.cause))}`
  }
}

/** One scheduler turn; Effect fiber continuations land through macrotasks. */
export const immediateDrain = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

export const rendererDrain = async (): Promise<void> => {
  for (let turn = 0; turn < 4; turn++) {
    // eslint-disable-next-line no-await-in-loop -- scheduler turns must land sequentially
    await immediateDrain()
  }
}

/** Resolves with the first published mutation state satisfying the predicate. */
export const awaitState = <I, A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<Mutation.State<I, A, E>>,
  predicate: (value: Mutation.State<I, A, E>) => boolean
): Promise<Mutation.State<I, A, E>> => {
  const deferred = Deferred.makeUnsafe<Mutation.State<I, A, E>>()
  const check = (value: Mutation.State<I, A, E>) => {
    if (predicate(value)) Deferred.doneUnsafe(deferred, Effect.succeed(value))
  }
  const release = registry.subscribe(atom, check, { immediate: true })
  return Effect.runPromise(Deferred.await(deferred).pipe(Effect.tap(() => Effect.sync(release))))
}

export const releaseGate = async (gate: Gate): Promise<void> => {
  Effect.runSync(Deferred.succeed(gate.release, undefined))
  await rendererDrain()
}

export const awaitStarted = async (gate: Gate): Promise<void> => {
  await Effect.runPromise(Deferred.await(gate.started))
  await rendererDrain()
}
