/** First-party Solid bindings for EffectStack Query. @since 0.1.0 */
import { type Mutation, type Query, QueryAtom } from "@effect-stack/query"
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-solid"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { type Accessor, createComponent, createContext, createMemo, type JSX, Show, useContext } from "solid-js"
import { unwrap } from "solid-js/store"

/**
 * Props for an application-specific Query provider.
 *
 * A supplied registry is borrowed; the Provider never disposes it.
 * `"inherit"` uses the surrounding native Solid registry. Omitting `registry`
 * creates a Provider-owned registry that Solid disposes when the Provider is
 * cleaned up. The query client lives in `value`, owned by the application's
 * Effect scope; the Provider acquires no client lifecycle.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryProviderProps<App> {
  readonly value: App
  readonly registry?: AtomRegistry.AtomRegistry | "inherit" | undefined
  readonly children?: JSX.Element | undefined
}

/**
 * A type-preserving Query application context.
 *
 * Solid context values are captured at setup, so `useQueryContext` honestly
 * returns a live `Accessor<App>` instead of a stale snapshot. Replacing the
 * Provider `value` updates existing selectors and later actions without
 * remounting the subtree; replacing the `registry` remounts it, rebinding
 * every subscription to the new Atom registry.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryContext<App> {
  readonly Provider: (props: QueryProviderProps<App>) => JSX.Element
  readonly useQueryContext: () => Accessor<App>
}

function Keyed<T>(
  props: {
    readonly when: T | undefined
    readonly children: (value: NonNullable<T>) => JSX.Element
    readonly fallback?: JSX.Element
  }
): JSX.Element {
  // Show uses callback arity to distinguish render functions from JSX accessors.
  // Always supply a one-argument callback, even when a caller ignores the value.
  return Show({
    get when() {
      return props.when
    },
    keyed: true,
    get fallback() {
      return props.fallback
    },
    children: (value: NonNullable<T>) => props.children(value)
  })
}

/**
 * Creates an application-specific provider and context hook without erasing
 * the application's concrete type.
 *
 * @since 0.1.0
 * @category constructors
 */
export function createQueryContext<App>(): QueryContext<App> {
  const ApplicationContext = createContext<Accessor<App>>()

  const useQueryContext = (): Accessor<App> => {
    const app = useContext(ApplicationContext)
    if (app === undefined) {
      throw new Error("Query context requires the Provider from the matching createQueryContext call")
    }
    return app
  }

  const Provider = (props: QueryProviderProps<App>): JSX.Element => {
    const app = createMemo(() => props.value)
    const content = (): JSX.Element =>
      createComponent(ApplicationContext.Provider, {
        value: app,
        get children() {
          return props.children
        }
      })
    return createComponent(Keyed<AtomRegistry.AtomRegistry | "inherit" | "own">, {
      get when() {
        return props.registry ?? "own"
      },
      children: (binding) => {
        if (binding === "own") {
          return createComponent(RegistryProvider, {
            get children() {
              return content()
            }
          })
        }
        if (binding === "inherit") {
          return content()
        }
        return createComponent(RegistryContext.Provider, {
          value: binding,
          get children() {
            return content()
          }
        })
      }
    })
  }

  return { Provider, useQueryContext }
}

const disabledAtom: Atom.Atom<AsyncResult.AsyncResult<never, never>> = Atom.make(() => AsyncResult.initial())

/**
 * Observes a bound resource through the current Atom registry.
 *
 * `None` is inert: it reports `AsyncResult.initial()` and acquires no read
 * interest. When the selected resource changes, the previous lease is released
 * and the accessor reports the new resource's own state; data never carries
 * across resources. Native `AsyncResult` retains success, failure `Cause`, and
 * waiting transitions without an adapter-owned cache.
 *
 * Selections may come from a Solid store: store proxies are unwrapped to the
 * exact client-created resource (including inside freshly built `Some`
 * values) before the identity-keyed core binding, while source tracking stays
 * reactive.
 *
 * @since 0.1.0
 * @category hooks
 */
export function useQuery<A, E = never>(
  resource: Accessor<Query.Resource<A, E> | Option.Option<Query.Resource<A, E>>>
): Accessor<AsyncResult.AsyncResult<A, E>> {
  return useAtomValue((): Atom.Atom<AsyncResult.AsyncResult<A, E>> => {
    const input = unwrap(resource())
    const selected = "_tag" in input ? Option.map(input, (bound) => unwrap(bound)) : Option.some(input)
    return Option.isSome(selected) ? QueryAtom.query(selected.value) : disabledAtom
  })
}

/**
 * Promise execution options accepted by Effect's native runners.
 *
 * Aborting an `execute` or `executeExit` waiter rejects that waiter only.
 * Accepted invocations remain client-owned and continue to completion.
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationExecuteOptions {
  readonly signal?: AbortSignal
}

/**
 * Solid observation and execution helpers for a pre-acquired mutation handle.
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationResult<I, A, E> {
  readonly state: Accessor<Mutation.State<I, A, E>>
  readonly executeEffect: (input: I) => Effect.Effect<A, E>
  readonly startEffect: (input: I) => Effect.Effect<Mutation.Invocation<A, E>>
  readonly execute: (input: I, options?: MutationExecuteOptions) => Promise<A>
  readonly executeExit: (input: I, options?: MutationExecuteOptions) => Promise<Exit.Exit<A, E>>
}

/**
 * Observes a pre-acquired mutation handle and exposes environment-free Effect
 * and Promise execution bridges. Reading the accessor is pure observation;
 * accepted invocations remain client-owned and survive waiter departure.
 *
 * Each action selects the current handle when it is called and captures that
 * handle for the whole invocation, so a later handle switch cannot reroute
 * work already started. A handle stored in a Solid store is unwrapped to the
 * exact client-acquired controller before binding, while source tracking
 * stays reactive.
 *
 * @since 0.1.0
 * @category hooks
 */
export function useMutation<I, A, E = never>(
  handle: Accessor<Mutation.Handle<I, A, E>>
): MutationResult<I, A, E> {
  const state = useAtomValue(() => QueryAtom.mutation(unwrap(handle())))
  const executeEffect = (input: I): Effect.Effect<A, E> => {
    const current = unwrap(handle())
    return Effect.suspend(() => current.execute(input))
  }
  const startEffect = (input: I): Effect.Effect<Mutation.Invocation<A, E>> => {
    const current = unwrap(handle())
    return Effect.suspend(() => current.start(input))
  }
  return {
    state,
    executeEffect,
    startEffect,
    execute: (input, options) => Effect.runPromise(executeEffect(input), options),
    executeExit: (input, options) => Effect.runPromiseExit(executeEffect(input), options)
  }
}
