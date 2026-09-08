/** First-party Vue bindings for the EffectStack Query runtime. @since 0.1.0 */
import type { Mutation, Query } from "@effect-stack/query"
import { QueryAtom } from "@effect-stack/query"
import { injectRegistry, registryKey, useAtomValue } from "@effect/atom-vue"
import { Effect, Option } from "effect"
import type * as Exit from "effect/Exit"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import {
  computed,
  defineComponent,
  h,
  inject,
  type InjectionKey,
  type MaybeRefOrGetter,
  onScopeDispose,
  type PropType,
  provide,
  type Ref,
  toRaw,
  toValue,
  type VNode
} from "vue"

/** Props accepted by the `Provider` returned from `createQueryContext`. @since 0.1.0 */
export interface QueryProviderProps<App> {
  /** The application object every descendant reads through `useQueryContext`. */
  readonly value: App
  /**
   * A borrowed `AtomRegistry`, `"inherit"` to join the ambient native registry, or omitted to
   * own a fresh registry disposed with the provider's component scope.
   */
  readonly registry?: AtomRegistry.AtomRegistry | "inherit"
}

/** A typed application context: its Provider component plus the reader hook. @since 0.1.0 */
export interface QueryContext<App> {
  readonly Provider: (props: QueryProviderProps<App>) => VNode
  /**
   * Reads the current `App` as a readonly ref. Replacing the Provider's `value` prop updates
   * this ref reactively; consumers keep their mounted state. Reads outside setup, such as in
   * event handlers, must unwrap through `.value` at use time.
   */
  readonly useQueryContext: () => Readonly<Ref<App>>
}

const missingContext = Symbol("@effect-stack/query-vue/missingContext")

// Vue deep-wraps objects stored in `ref`/`reactive`, while the core binds stable
// atoms by the original resource or handle identity. Unwrapping with `toRaw` keeps
// a mounted view on one lease even when the value arrives through a proxy, and it
// returns non-proxies untouched.
const unwrapResource = <A, E>(
  value: Query.Resource<A, E> | Option.Option<Query.Resource<A, E>>
): Query.Resource<A, E> | undefined => {
  const raw = toRaw(value)
  if (Option.isOption(raw)) return Option.isSome(raw) ? toRaw(raw.value) : undefined
  return raw
}

/**
 * Creates an isolated typed application context. The Provider owns registry selection only:
 * the application builds its scoped `QueryClient` outside this adapter, and the supplied `App`
 * carries whatever bound resources, handles, and client the components share.
 *
 * A registry object is borrowed and never disposed here; `"inherit"` joins the ambient
 * `@effect/atom-vue` registry; omitting `registry` owns a registry disposed on unmount.
 * Replacing the registry remounts the keyed provider subtree so every atom resubscribes.
 * Replacing the `App` value never remounts: `useQueryContext()` returns a readonly ref that
 * publishes the new value through Vue's own reactivity.
 *
 * @since 0.1.0
 * @category context
 */
export function createQueryContext<App>(): QueryContext<App> {
  const contextKey: InjectionKey<Readonly<Ref<App>>> = Symbol("@effect-stack/query-vue/context")
  const registryProp = { type: [Object, String] as PropType<AtomRegistry.AtomRegistry | "inherit"> }
  // `App` is an unconstrained generic: any runtime value is valid, so the prop
  // declares no constructor. The PropType bridge keeps the static prop shape.
  const valueProp = { type: null as unknown as PropType<App>, required: true as const }
  const RegistryOwner = defineComponent({
    name: "QueryRegistryOwner",
    inheritAttrs: false,
    props: { value: valueProp, registry: registryProp },
    setup(props, { slots }) {
      const supplied = props.registry
      const registry = supplied === "inherit" ? injectRegistry() : supplied ?? AtomRegistry.make()
      if (supplied === undefined) onScopeDispose(() => registry.dispose())
      provide(registryKey, registry)
      // Vue's generic props inference cannot resolve `App` through the unresolved
      // type parameter; the prop declaration guarantees the runtime shape.
      provide(contextKey, computed(() => props.value) as unknown as Readonly<Ref<App>>)
      return () => slots.default?.()
    }
  })
  const Provider = defineComponent({
    name: "QueryProvider",
    inheritAttrs: false,
    props: { value: valueProp, registry: registryProp },
    setup(props, { slots }) {
      let current = props.registry
      let generation = 0
      return () => {
        if (props.registry !== current) {
          current = props.registry
          generation++
        }
        return h(RegistryOwner, {
          value: props.value,
          ...(props.registry === undefined ? {} : { registry: props.registry }),
          key: generation
        }, slots)
      }
    }
  })
  const useQueryContext = (): Readonly<Ref<App>> => {
    const app = inject(contextKey, missingContext as unknown as Readonly<Ref<App>>)
    if ((app as unknown) === missingContext) {
      throw new Error("useQueryContext requires the Provider returned by createQueryContext()")
    }
    return app
  }
  return {
    Provider: Provider as unknown as (props: QueryProviderProps<App>) => VNode,
    useQueryContext
  }
}

/**
 * Observes a query resource as its authoritative native `AsyncResult`, owning exactly one
 * read lease for as long as the component stays mounted.
 *
 * A `None` resource publishes `AsyncResult.initial()` without acquiring a lease. The resource
 * may be a ref, a getter, or a plain value; proxies from deep `ref`/`reactive` sources are
 * unwrapped so one resource keeps one atom. When the selected resource changes, the previous
 * interest is released on the next reactive flush and the new resource starts from its own
 * state, never the unrelated previous data.
 *
 * @since 0.1.0
 * @category composables
 */
export function useQuery<A, E = never>(
  resource: MaybeRefOrGetter<Query.Resource<A, E> | Option.Option<Query.Resource<A, E>>>
): Readonly<Ref<AsyncResult.AsyncResult<A, E>>> {
  const idleAtom: Atom.Atom<AsyncResult.AsyncResult<A, E>> = Atom.make(() => AsyncResult.initial<A, E>())
  return useAtomValue(() => {
    const selected = unwrapResource(toValue(resource))
    return selected === undefined ? idleAtom : QueryAtom.query(selected)
  })
}

/** Options accepted by the Promise bridges returned from `useMutation`. @since 0.1.0 */
export interface MutationExecuteOptions {
  readonly signal?: AbortSignal
}

/** The component-facing surface returned by `useMutation`. @since 0.1.0 */
export interface MutationResult<I, A, E> {
  /** Aggregate controller state: the latest-started invocation and all pending work. */
  readonly state: Readonly<Ref<Mutation.State<I, A, E>>>
  /** Runs one invocation of the current handle; the effect owns this call's outcome. */
  readonly executeEffect: (input: I) => Effect.Effect<A, E>
  /** Accepts one invocation of the current handle and returns its independent completion handle. */
  readonly startEffect: (input: I) => Effect.Effect<Mutation.Invocation<A, E>>
  /**
   * Promise bridge over `execute`. The optional signal aborts this waiter only; the accepted
   * client-owned invocation continues, including after this component unmounts.
   */
  readonly execute: (input: I, options?: MutationExecuteOptions) => Promise<A>
  /** Promise bridge over `execute` reporting the invocation's final `Exit`. */
  readonly executeExit: (input: I, options?: MutationExecuteOptions) => Promise<Exit.Exit<A, E>>
}

/**
 * Observes a pre-acquired mutation handle and bridges its explicit methods to Promises.
 * The handle is a plain caller-owned object acquired in the application Effect
 * (`client.mutation(definition)`); proxies from deep `ref`/`reactive` sources are unwrapped so
 * state and actions always bind to that original controller. This hook never constructs
 * controllers or runs Effects inside reactive code, and each action selects the current
 * handle at invocation time.
 *
 * @since 0.1.0
 * @category composables
 */
export function useMutation<I, A, E = never>(
  handle: MaybeRefOrGetter<Mutation.Handle<I, A, E>>
): MutationResult<I, A, E> {
  const rawHandle = () => toRaw(toValue(handle))
  const state = useAtomValue(() => QueryAtom.mutation(rawHandle()))
  return {
    state,
    executeEffect: (input) => rawHandle().execute(input),
    startEffect: (input) => rawHandle().start(input),
    execute: (input, options) => Effect.runPromise(rawHandle().execute(input), options),
    executeExit: (input, options) => Effect.runPromiseExit(rawHandle().execute(input), options)
  }
}
