/** First-party React bindings for EffectStack Query. @since 0.1.0 */
"use client"

import { type Mutation, type Query, QueryAtom } from "@effect-stack/query"
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-react"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as React from "react"

/**
 * Props for an application-specific Query provider.
 *
 * An explicit registry is borrowed. `"inherit"` uses the surrounding native
 * React registry. Omitting `registry` creates and owns a native registry.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryProviderProps<App> {
  readonly value: App
  readonly registry?: AtomRegistry.AtomRegistry | "inherit"
  readonly children?: React.ReactNode
}

/**
 * A type-preserving Query application context.
 *
 * @since 0.1.0
 * @category models
 */
export interface QueryContext<App> {
  readonly Provider: (props: QueryProviderProps<App>) => React.ReactNode
  readonly useQueryContext: () => App
}

const registryIds = new WeakMap<AtomRegistry.AtomRegistry, number>()
let nextRegistryId = 0

const registryKey = (registry: AtomRegistry.AtomRegistry): number => {
  const existing = registryIds.get(registry)
  if (existing !== undefined) return existing
  const id = ++nextRegistryId
  registryIds.set(registry, id)
  return id
}

/**
 * Creates an application-specific provider and context hook without erasing
 * the application's concrete type.
 *
 * @since 0.1.0
 * @category constructors
 */
export function createQueryContext<App>(): QueryContext<App> {
  const missing = Symbol("@effect-stack/query-react/missing-context")
  const ApplicationContext = React.createContext<App | typeof missing>(missing)

  const useQueryContext = (): App => {
    const application = React.useContext(ApplicationContext)
    if (application === missing) {
      throw new Error("Query hooks requiring application context must be rendered inside the matching Query Provider")
    }
    return application
  }

  const Content = ({ children, value }: Pick<QueryProviderProps<App>, "children" | "value">) => (
    <ApplicationContext.Provider value={value}>{children}</ApplicationContext.Provider>
  )

  const Provider = ({ children, registry, value }: QueryProviderProps<App>): React.ReactNode => {
    if (registry === undefined) {
      return (
        <RegistryProvider>
          <Content value={value}>{children}</Content>
        </RegistryProvider>
      )
    }
    if (registry === "inherit") {
      return <Content value={value}>{children}</Content>
    }
    return (
      <RegistryContext.Provider value={registry}>
        <React.Fragment key={registryKey(registry)}>
          <Content value={value}>{children}</Content>
        </React.Fragment>
      </RegistryContext.Provider>
    )
  }

  return { Provider, useQueryContext }
}

/**
 * Observes a bound resource. The render snapshot is the resource's
 * authoritative synchronous observation, so a warm cache commits as cached
 * data without an `Initial` pass. Read interest, and any loading it triggers,
 * is acquired only after the component commits; an abandoned render acquires
 * nothing. `None` is inert and returns `Initial`. A changed resource starts
 * with its own cached state and never carries previous data across keys.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useQuery = <A, E>(
  input: Query.Resource<A, E> | Option.Option<Query.Resource<A, E>>
): AsyncResult.AsyncResult<A, E> => {
  const registry = React.useContext(RegistryContext)
  const resource = Option.isOption(input) ? Option.getOrUndefined(input) : input
  const bridge = React.useMemo(() => {
    const seed: AsyncResult.AsyncResult<A, E> = resource === undefined
      ? AsyncResult.initial()
      : resource.observation.getSnapshot()
    // The bridge is keyed by registry so a replacement registry remounts a
    // freshly seeded bridge instead of reviving a stale initializer.
    return Atom.make<AsyncResult.AsyncResult<A, E>>(seed).pipe(Atom.setIdleTTL(0))
  }, [registry, resource])
  const result = useAtomValue(bridge)
  const lease = React.useRef<
    {
      readonly bridge: typeof bridge
      readonly registry: AtomRegistry.AtomRegistry
      readonly resource: Query.Resource<A, E>
      readonly release: () => void
      pendingRelease: object | undefined
    } | null
  >(null)

  React.useEffect(() => {
    if (resource === undefined) return
    const current = lease.current
    if (
      current !== null && current.bridge === bridge && current.registry === registry && current.resource === resource
    ) {
      current.pendingRelease = undefined
    } else {
      const release = registry.subscribe(QueryAtom.query(resource), (value) => registry.set(bridge, value), {
        immediate: true
      })
      lease.current = { bridge, registry, resource, release, pendingRelease: undefined }
    }
    return () => {
      const active = lease.current
      if (active === null) return
      const token = {}
      active.pendingRelease = token
      queueMicrotask(() => {
        if (active.pendingRelease !== token) return
        active.release()
        if (lease.current === active) lease.current = null
      })
    }
  }, [bridge, registry, resource])

  return result
}

/**
 * Promise execution options accepted by Effect's native runners.
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationExecuteOptions {
  readonly signal?: AbortSignal
}

/**
 * React observation and execution helpers for a pre-acquired mutation handle.
 *
 * @since 0.1.0
 * @category models
 */
export interface MutationResult<I, A, E> {
  readonly state: Mutation.State<I, A, E>
  readonly executeEffect: (input: I) => Effect.Effect<A, E>
  readonly startEffect: (input: I) => Effect.Effect<Mutation.Invocation<A, E>>
  readonly execute: (input: I, options?: MutationExecuteOptions) => Promise<A>
  readonly executeExit: (input: I, options?: MutationExecuteOptions) => Promise<Exit.Exit<A, E>>
}

/**
 * Observes a pre-acquired mutation handle and exposes environment-free Effect
 * and Promise execution bridges. The render snapshot is the handle's
 * authoritative synchronous observation, so an accepted invocation's pending
 * and latest state is visible on the first commit. The observation lease is
 * acquired only after the component commits. Accepted invocations remain
 * client-owned.
 *
 * @since 0.1.0
 * @category hooks
 */
export const useMutation = <I, A, E>(handle: Mutation.Handle<I, A, E>): MutationResult<I, A, E> => {
  const registry = React.useContext(RegistryContext)
  const bridge = React.useMemo(
    () =>
      // Keyed by registry so a replacement registry seeds a fresh bridge
      // rather than reviving a stale initializer.
      Atom.make<Mutation.State<I, A, E>>(handle.observation.getSnapshot()).pipe(Atom.setIdleTTL(0)),
    [handle, registry]
  )
  const state = useAtomValue(bridge)
  React.useEffect(
    () => registry.subscribe(QueryAtom.mutation(handle), (value) => registry.set(bridge, value), { immediate: true }),
    [bridge, handle, registry]
  )
  const executeEffect = React.useCallback((input: I) => handle.execute(input), [handle])
  const startEffect = React.useCallback((input: I) => handle.start(input), [handle])
  const execute = React.useCallback(
    (input: I, options?: MutationExecuteOptions) => Effect.runPromise(handle.execute(input), options),
    [handle]
  )
  const executeExit = React.useCallback(
    (input: I, options?: MutationExecuteOptions) => Effect.runPromiseExit(handle.execute(input), options),
    [handle]
  )
  return React.useMemo(
    () => ({ state, executeEffect, startEffect, execute, executeExit }),
    [state, executeEffect, startEffect, execute, executeExit]
  )
}
