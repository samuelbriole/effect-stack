import { QueryClient } from "@effect-stack/query"
import { Context, Effect, Exit, Scope } from "effect"
import * as Deferred from "effect/Deferred"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"

const cleanups: Array<() => void | Promise<void>> = []

export const registerCleanup = (cleanup: () => void | Promise<void>): void => {
  cleanups.push(cleanup)
}

/** Runs registered cleanups last-in, first-out: DOM before application scopes. */
export const runCleanups = async (): Promise<void> => {
  let cleanup = cleanups.pop()
  while (cleanup !== undefined) {
    // eslint-disable-next-line no-await-in-loop -- cleanup order is meaningful
    await cleanup()
    cleanup = cleanups.pop()
  }
}

/**
 * Drains several scheduler turns so Effect runtime continuations (deferred
 * resolution -> fiber resume -> atom publish) and Solid updates land before
 * assertions. This is a bounded scheduler flush, not a time-based sleep;
 * authoritative waiting uses Deferreds.
 */
export const drain = async (): Promise<void> => {
  for (let turn = 0; turn < 4; turn++) {
    // eslint-disable-next-line no-await-in-loop -- scheduler turns must land sequentially
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  }
}

export const mount = (tree: () => JSX.Element): { readonly container: HTMLElement; readonly dispose: () => void } => {
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(tree, container)
  registerCleanup(() => {
    dispose()
    container.remove()
  })
  return { container, dispose }
}

/** Builds an application-owned scoped client whose lifetime the adapter must never control. */
export const makeControlledClient = (): {
  readonly client: QueryClient.QueryClient<never>
  readonly close: () => Promise<void>
} => {
  const scope = Effect.runSync(Scope.make())
  const client = Effect.runSync(
    QueryClient.makeWith(Context.empty()).pipe(Effect.provideService(Scope.Scope, scope))
  )
  return { client, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) }
}

export const makeClient = (): QueryClient.QueryClient<never> => {
  const { client, close } = makeControlledClient()
  registerCleanup(close)
  return client
}

export const format = <A, E>(result: AsyncResult.AsyncResult<A, E>): string =>
  `${result._tag.toLowerCase()}${result.waiting ? "+waiting" : ""}${
    AsyncResult.isSuccess(result) ? `:${String(result.value)}` : ""
  }`

export interface Gate {
  readonly starts: Record<string, number>
  readonly interrupts: Record<string, number>
  readonly load: (key: string) => Effect.Effect<string>
  readonly release: (key: string) => void
}

/** A loader gated per key: started counts, interrupt counts, and manual completion. */
export const makeGate = (): Gate => {
  const starts: Record<string, number> = {}
  const interrupts: Record<string, number> = {}
  const deferreds = new Map<string, Deferred.Deferred<string>>()
  const gate = (key: string): Deferred.Deferred<string> => {
    const existing = deferreds.get(key)
    if (existing !== undefined) return existing
    const created = Deferred.makeUnsafe<string>()
    deferreds.set(key, created)
    return created
  }
  return {
    interrupts,
    load: (key) =>
      Effect.gen(function*() {
        starts[key] = (starts[key] ?? 0) + 1
        yield* Deferred.await(gate(key)).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupts[key] = (interrupts[key] ?? 0) + 1
            })
          )
        )
        return `${key}#${String(starts[key])}`
      }),
    release: (key) => {
      Effect.runSync(Deferred.succeed(gate(key), `${key}#${String(starts[key] ?? 0)}`))
    },
    starts
  }
}
