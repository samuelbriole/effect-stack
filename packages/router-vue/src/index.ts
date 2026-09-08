/** First-party client-side Vue routing. @since 0.1.0 */
import { BrowserHistory, type History, RenderPolicy, Route, Router, RouteTree } from "@effect-stack/router"
import { injectRegistry, registryKey, useAtomValue } from "@effect/atom-vue"
import { Cause, Effect, Equal, Layer, Option, Result, type Schema } from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import {
  type AnchorHTMLAttributes,
  type Component,
  computed,
  type ComputedRef,
  defineComponent,
  type FunctionalComponent,
  h,
  inject,
  type InjectionKey,
  markRaw,
  onErrorCaptured,
  onScopeDispose,
  type PropType,
  provide,
  type Ref,
  shallowRef,
  type VNode,
  watch,
  watchEffect
} from "vue"

/** @since 0.1.0 */
export interface ErrorProps {
  readonly error: unknown
  readonly reset: () => void
}
/** @since 0.1.0 */
export interface Views {
  readonly component?: Component
  readonly pendingComponent?: Component
  readonly errorComponent?: Component<ErrorProps>
  readonly notFoundComponent?: Component
}
/** @since 0.2.0 */
export interface SelectorOptions<A> {
  readonly equals?: (left: A, right: A) => boolean
}
/** @since 0.2.0 */
export interface VueRouteHook<A> {
  <B>(select: (value: A) => B, options?: SelectorOptions<B>): ComputedRef<B>
  (): ComputedRef<A>
}

type VueModuleView = NonNullable<Views["component"]>

// Exclude only omits `undefined`, so present `null` exports stay invalid while optional
// undefined exports keep the Outlet fallback. Arrays match Vue's all-optional options
// interfaces structurally, so they are rejected ahead of the component check. Distribution
// keeps union module types honest: one invalid member poisons the check even when other
// members are renderer-neutral.
type InvalidLazyModuleValue<V> = [V] extends [ReadonlyArray<unknown>] ? true
  : ([V] extends [VueModuleView] ? never : true)
type InvalidLazyModuleExport<M> = M extends unknown ?
    | ("default" extends keyof M ? InvalidLazyModuleValue<Exclude<M["default"], undefined>> : never)
    | ("component" extends keyof M ? InvalidLazyModuleValue<Exclude<M["component"], undefined>> : never)
  : never

// A lazy module may carry renderer-neutral data, but a present view export must be a Vue component.
// Modules without `default`/`component` keep the Outlet fallback.
type CheckedLazyModule<M> = [InvalidLazyModuleExport<M>] extends [never] ? unknown : { readonly load?: never }
/** @since 0.1.0 */
export type VueRoute<
  R extends Route.Any,
  C extends ReadonlyArray<RouteTree.Any> = readonly [],
  K extends RouteTree.Kind = RouteTree.Kind
> =
  & Omit<RouteTree.Node<R, C, K>, "addChildren">
  & Views
  & {
    readonly addChildren: <const Children extends ReadonlyArray<RouteTree.Any>>(
      children: Children
    ) => VueRoute<R, Children, K>
    readonly useParams: VueRouteHook<Route.Route.Params<R>>
    readonly useSearch: VueRouteHook<Route.Route.Search<R>>
    readonly useLoaderData: VueRouteHook<Route.Route.LoaderData<R>>
    readonly useMatch: VueRouteHook<Router.ResolvedRoute<R>>
  }

type RouteValues<R extends Route.Any> = {
  readonly match: Router.ResolvedRoute<R>
  readonly params: Route.Route.Params<R>
  readonly search: Route.Route.Search<R>
  readonly loaderData: Route.Route.LoaderData<R>
}

const decorate = <R extends Route.Any, C extends ReadonlyArray<RouteTree.Any>, K extends RouteTree.Kind>(
  route: RouteTree.Node<R, C, K>,
  views: Views
): VueRoute<R, C, K> => ({
  ...route,
  ...(views.component === undefined ? {} : { component: views.component }),
  ...(views.pendingComponent === undefined ? {} : { pendingComponent: views.pendingComponent }),
  ...(views.errorComponent === undefined ? {} : { errorComponent: views.errorComponent }),
  ...(views.notFoundComponent === undefined ? {} : { notFoundComponent: views.notFoundComponent }),
  addChildren: <const Children extends ReadonlyArray<RouteTree.Any>>(children: Children) =>
    decorate(route.addChildren(children), views),
  useMatch: routeHook(route, "match"),
  useParams: routeHook(route, "params"),
  useSearch: routeHook(route, "search"),
  useLoaderData: routeHook(route, "loaderData")
} as VueRoute<R, C, K>)

const routeHook = <R extends Route.Any, K extends keyof RouteValues<R>>(route: R, key: K) =>
(
  select?: (value: RouteValues<R>[K]) => unknown,
  options?: SelectorOptions<unknown>
): ComputedRef<unknown> => useRouteValue(route, key, select, options)

/** @since 0.1.0 */
export function createRootRoute<
  const S extends RouteTree.Fields = {},
  H extends RouteTree.HashCodec = Schema.String,
  M = void,
  ME = never,
  MR = never,
  D = void,
  E = never,
  R = never
>(
  options:
    & Views
    & { readonly search?: S; readonly hash?: H }
    & RouteTree.Loading<{}, S, H, M, ME, MR, D, E, R>
    & CheckedLazyModule<M> = {}
): VueRoute<Route.Route<"__root__", "/", {}, S, H, M, ME, MR, D, E, R>, readonly [], "root"> {
  return decorate(RouteTree.root(options), options)
}

/** @since 0.1.0 */
export function createRoute<
  Parent extends RouteTree.Any,
  const Id extends string,
  const S extends RouteTree.Fields = {},
  H extends RouteTree.HashCodec = Parent["hashSchema"],
  M = void,
  ME = never,
  MR = never,
  D = void,
  E = never,
  R = never
>(
  options:
    & Views
    & {
      readonly getParentRoute: () => Parent
      readonly id: Id
      readonly path?: never
      readonly search?: S
      readonly hash?: H
    }
    & RouteTree.Loading<Parent["paramsSchema"]["fields"], Parent["searchSchema"]["fields"] & S, H, M, ME, MR, D, E, R>
    & CheckedLazyModule<M>
): VueRoute<
  Route.Route<
    `${Parent["id"]}/${Id}`,
    Parent["path"],
    Parent["paramsSchema"]["fields"],
    Parent["searchSchema"]["fields"] & S,
    H,
    M,
    ME,
    MR,
    D,
    E,
    R
  >,
  readonly [],
  "layout"
>
export function createRoute<
  Parent extends RouteTree.Any,
  const Path extends string,
  const P extends RouteTree.Fields = {},
  const S extends RouteTree.Fields = {},
  H extends RouteTree.HashCodec = Parent["hashSchema"],
  M = void,
  ME = never,
  MR = never,
  D = void,
  E = never,
  R = never
>(
  options: Views & RouteTree.Options<Parent, Path, P, S, H, M, ME, MR, D, E, R> & CheckedLazyModule<M>
): VueRoute<
  RouteTree.Child<Parent, Path, P, S, H, M, ME, MR, D, E, R>,
  readonly [],
  Path extends "/" ? "index" : "route"
>
export function createRoute(
  options: Views & {
    readonly getParentRoute: () => RouteTree.Any
    readonly path?: string
    readonly id?: string
    readonly params?: RouteTree.Fields
    readonly search?: RouteTree.Fields
    readonly hash?: RouteTree.HashCodec
    readonly load?: () => Effect.Effect<unknown, unknown, unknown>
    readonly loader?: (input: never) => Effect.Effect<unknown, unknown, unknown>
  }
): unknown {
  const construct = RouteTree.make as unknown as (input: typeof options) => RouteTree.Node<Route.Any>
  return decorate(construct(options), options)
}

/** Augment with `interface Register { router: typeof router }`. @since 0.1.0 */
export interface Register {}
/** @since 0.1.0 */
export type RegisteredRouter = Register extends { readonly router: infer R } ? R : ClientRouter<RouteTree.Any, unknown>
type RegisteredTree = RegisteredRouter extends { readonly routeTree: infer T extends RouteTree.Any } ? T : RouteTree.Any
/** @since 0.1.0 */
export type Destination<T extends RouteTree.Any = RegisteredTree> = RouteTree.Destination<T>
/** @since 0.1.0 */
export interface ClientRouter<T extends RouteTree.Any, E> {
  readonly routeTree: T
  /** Compiled lookups shared with the core planner, prepared once per route tree. @since 0.2.0 */
  readonly compiled: RouteTree.Compiled<RouteTree.All<T>>
  readonly core: Router.Router<ReadonlyArray<RouteTree.All<T>>, E>
  readonly href: (destination: Destination<T>) => Result.Result<string, Route.RouteEncodeError>
}

/** Constructs a runtime from native Effect application and History Layers. @since 0.1.0 */
export function createRouter<T extends RouteTree.Any, E = never, HE = never>(
  options:
    & {
      readonly routeTree: T
      readonly history?: Layer.Layer<History.Service, HE>
    }
    & ([Route.Route.Services<RouteTree.All<T>>] extends [never] ? { readonly layer?: Layer.Layer<never, E> }
      : { readonly layer: Layer.Layer<Route.Route.Services<RouteTree.All<T>>, E> })
): ClientRouter<T, E | HE | History.HistoryError> {
  const history: Layer.Layer<History.Service, HE | History.HistoryError> = options.history ?? BrowserHistory.layer
  // Public options require a Layer whenever the route tree requests services.
  const application = (options.layer ?? Layer.empty) as Layer.Layer<Route.Route.Services<RouteTree.All<T>>, E>
  // Compiled lookups are cached by root identity, so `fromTree` reuses this object.
  const compiled = RouteTree.compile(options.routeTree)
  const core = Router.fromTree({ routeTree: options.routeTree, layer: Layer.merge(history, application) })
  return markRaw({
    routeTree: options.routeTree,
    compiled,
    core,
    href: (destination: Destination<T>) => {
      const { route, input } = compiled.target(destination)
      return Route.href(route, input)
    }
  })
}

type RuntimeRouter = ClientRouter<RouteTree.Any, unknown>
const routerKey: InjectionKey<RuntimeRouter> = Symbol("effect-stack/router")
const branchKey: InjectionKey<Readonly<Ref<Router.Branch>>> = Symbol("effect-stack/branch")
const depthKey: InjectionKey<number> = Symbol("effect-stack/depth")
const snapshotKey: InjectionKey<"resolved" | "incoming"> = Symbol("effect-stack/snapshot")
const DefaultPending = () => h("div", { role: "status" }, "Loading…")
const DefaultNotFound = () => h("div", { role: "status" }, "Page not found")
const DefaultError = (props: ErrorProps) =>
  h("div", { role: "alert" }, ["Unable to display this route. ", h("button", { onClick: props.reset }, "Retry")])

// Fallback views describe the incoming navigation's decoded inputs, while ordinary
// views keep the resolved input paired with the data it loaded.
const FallbackSnapshot = defineComponent({
  name: "RouteFallbackSnapshot",
  inheritAttrs: false,
  setup(_props, { slots }) {
    provide(snapshotKey, "incoming")
    return () => slots.default?.()
  }
})

/** @since 0.1.0 */
export function useRouter(): RegisteredRouter {
  const router = inject(routerKey)
  if (router === undefined) throw new Error("Router hooks require RouterProvider")
  return router as RegisteredRouter
}
const useRuntime = (): RuntimeRouter => useRouter() as RuntimeRouter
/** @since 0.1.0 */
export function useRouterState<A>(
  select: (value: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): ComputedRef<A>
export function useRouterState(): Readonly<Ref<Atom.Type<RegisteredRouter["core"]["state"]>>>
export function useRouterState<A>(
  select?: (value: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): Readonly<Ref<Atom.Type<RegisteredRouter["core"]["state"]>>> | ComputedRef<A> {
  const { core } = useRuntime()
  if (select === undefined) {
    return useAtomValue(() => core.state) as Readonly<Ref<Atom.Type<RegisteredRouter["core"]["state"]>>>
  }
  const selected = Atom.map(core.state, select).pipe(Atom.withEquality(options?.equals ?? Object.is))
  return useAtomValue(() => selected) as ComputedRef<A>
}
function useRouteValue<R extends Route.Any, K extends keyof RouteValues<R>, A = RouteValues<R>[K]>(
  route: R,
  key: K,
  select?: (value: RouteValues<R>[K]) => A,
  options?: SelectorOptions<A>
): ComputedRef<A> {
  const { core } = useRuntime()
  const mode = inject(snapshotKey, "resolved")
  // Decorated route nodes carry the compiled tree's identity fields; the erased
  // runtime router types routes structurally.
  const atoms = core.routeAtoms(route as unknown as RouteTree.Any)
  const equals = options?.equals
    ?? (select === undefined && (key === "params" || key === "search") ? Equal.equals : Object.is)
  const selected = Atom.make((get: Atom.AtomContext) => {
    const resolved = get(atoms.resolved)
    const incoming = mode === "incoming" && (key === "params" || key === "search") ? get(atoms.incoming) : Option.none()
    // A failed incoming decode means no decoded input exists; falling back to retained
    // data would pair fresh views with stale params. Ordinary views keep resolved snapshots.
    const snapshot = Option.isSome(incoming)
      ? Result.isSuccess(incoming.value) ? incoming.value.success : undefined
      : Option.isSome(resolved)
      ? resolved.value
      : undefined
    if (snapshot === undefined) return Option.none<A>()
    const value = (key === "match" ? snapshot : (snapshot as unknown as RouteValues<R>)[key]) as RouteValues<R>[K]
    return Option.some(select === undefined ? (value as A) : select(value))
  }).pipe(Atom.withEquality((left: Option.Option<A>, right: Option.Option<A>) =>
    Option.isSome(left)
      ? Option.isSome(right) && equals(left.value, right.value)
      : Option.isNone(right)
  ))
  const value = useAtomValue(() => selected)
  let retained: A | undefined
  let settled = false
  return computed(() => {
    const current = value.value
    if (Option.isSome(current)) {
      retained = current.value
      settled = true
    }
    // Exiting components can read their last snapshot until Vue finishes their unmount.
    if (settled) return retained as A
    throw new Error(
      `Route ${route.id} has no ${key === "params" || key === "search" ? "decoded" : "resolved"} match in this branch`
    )
  })
}

/** Failures accepted by the registered router's awaitable and Effect navigation operations. @since 0.2.0 */
export type NavigationError = Effect.Error<ReturnType<RegisteredRouter["core"]["execute"]>>
/** The provider's registry is supplied; interruption cancels this operation's transition. @since 0.2.0 */
export function useNavigateEffect(): (destination: Destination) => Effect.Effect<void, NavigationError> {
  const { compiled, core } = useRuntime()
  const registry = injectRegistry()
  return (destination) =>
    Effect.suspend(() => {
      const { route, input } = compiled.target(destination)
      return core.execute(
        destination.replace
          ? Router.replace<RouteTree.Any>(route, input, destination.state)
          : Router.push<RouteTree.Any>(route, input, destination.state)
      ).pipe(
        Effect.provideService(AtomRegistry.AtomRegistry, registry)
      ) as Effect.Effect<void, NavigationError>
    })
}
/** Awaits this transition's resolution and scoped cleanup; encode failures stay typed. @since 0.1.0 */
export function useNavigate(): (
  destination: Destination,
  options?: { readonly signal?: AbortSignal }
) => Promise<void> {
  const navigate = useNavigateEffect()
  return (destination, options) => Effect.runPromise(navigate(destination), options)
}

const routerProps = { router: { type: Object as PropType<RuntimeRouter>, required: true as const } }
const RegistryOwner = defineComponent({
  name: "RouterRegistryOwner",
  inheritAttrs: false,
  props: { ...routerProps, registry: Object as PropType<AtomRegistry.AtomRegistry> },
  setup(props) {
    const registry = props.registry ?? AtomRegistry.make()
    if (props.registry === undefined) onScopeDispose(() => registry.dispose())
    provide(registryKey, registry)
    let current = props.router
    let generation = 0
    return () => {
      if (props.router !== current) {
        current = props.router
        generation++
      }
      return h(RouterView, { router: current, key: generation })
    }
  }
})

/** Owns a registry by default; a supplied registry remains caller-owned. @since 0.1.0 */
export const RouterProvider = defineComponent({
  name: "RouterProvider",
  inheritAttrs: false,
  props: { ...routerProps, registry: Object as PropType<AtomRegistry.AtomRegistry> },
  setup(props) {
    let current = props.registry
    let generation = 0
    return () => {
      if (props.registry !== current) {
        current = props.registry
        generation++
      }
      return h(RegistryOwner, {
        router: props.router,
        ...(current === undefined ? {} : { registry: current }),
        key: generation
      })
    }
  }
}) as unknown as <T extends RouteTree.Any, E>(
  props: { readonly router: ClientRouter<T, E>; readonly registry?: AtomRegistry.AtomRegistry }
) => VNode

const RouterView = defineComponent({
  name: "RouterView",
  inheritAttrs: false,
  props: routerProps,
  setup(props) {
    const { core } = props.router
    provide(routerKey, props.router)
    provide(snapshotKey, "resolved")
    const registry = injectRegistry()
    onScopeDispose(registry.mount(core.navigate))
    const branch = useAtomValue(() => core.branch)
    provide(branchKey, branch)
    provide(depthKey, 0)
    const root = core.routes[0] as Route.Any & Views
    // The provider's core and registry are already resolved; a hook would re-inject
    // from this same component, where Vue only walks the parent chain.
    const retry = () => {
      void Effect.runPromise(core.retry.pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))).catch(
        () => {}
      )
    }
    const startup = Atom.map(core.branch, (value) =>
      value.matches.length > 0
        ? undefined
        : value.result._tag === "Failure"
        ? Cause.squash(value.result.cause)
        : null)
    const startupError = useAtomValue(() => startup)
    return () => {
      const error = startupError.value
      if (error === undefined) return h(Outlet)
      if (error !== null) {
        return h(FallbackSnapshot, null, {
          default: () => h(root.errorComponent ?? DefaultError, { error, reset: retry })
        })
      }
      return h(root.pendingComponent ?? DefaultPending)
    }
  }
})

// A Vue component is a function or options object; primitives and arrays cannot render.
const isVueView = (value: unknown): value is Component =>
  typeof value === "function" || (typeof value === "object" && value !== null && !Array.isArray(value))
// Selection stays total; the actionable failure surfaces inside the render boundary so the
// nearest errorComponent catches it with the route ID in the message.
const invalidVueView = (routeId: string, value: unknown): Component =>
  function InvalidLazyVueView(): VNode {
    throw new Error(
      `Route "${routeId}" selected a lazy module view that is not a Vue component (received ${
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value
      }). Export the page as the module 'default' or 'component' view.`
    )
  }

const declaresFallback = (route: Route.Any, kind: RenderPolicy.BoundaryKind): boolean =>
  (route as Views)[kind] !== undefined

// `??` would also skip present-but-null exports; only undefined keeps the next fallback.
const selectVueView = (route: Route.Any & Views, module: unknown): unknown => {
  const lazy = module as { readonly component?: Component; readonly default?: Component } | undefined
  if (route.component !== undefined) return route.component
  if (lazy?.component !== undefined) return lazy.component
  if (lazy?.default !== undefined) return lazy.default
  return Outlet
}

const RenderBoundary = defineComponent({
  name: "RouteRenderBoundary",
  inheritAttrs: false,
  props: {
    route: { type: Object as PropType<Route.Any & Views>, required: true },
    refresh: { type: Function as PropType<() => void>, required: true }
  },
  setup(props, { slots }) {
    const branch = inject(branchKey)
    if (branch === undefined) throw new Error("Route render boundaries require an active route branch")
    const failure = shallowRef<{ readonly error: unknown }>()
    onErrorCaptured((error) => {
      failure.value = { error }
      return false
    })
    // A latched render error releases only when a completed successful transition
    // covers this route, never the moment Retry dispatches its refresh.
    const recovery = computed(() => RenderPolicy.recoveryKey(branch.value, props.route.id))
    watch(recovery, () => {
      failure.value = undefined
    }, { flush: "sync" })
    const reset = () => props.refresh()
    return () => {
      const latched = failure.value
      if (latched === undefined) return slots.default?.()
      return h(FallbackSnapshot, null, {
        default: () => h(props.route.errorComponent ?? DefaultError, { error: latched.error, reset })
      })
    }
  }
})

/** Renders the next match while preserving same-route Vue component instances. @since 0.1.0 */
export const Outlet = defineComponent({
  name: "RouterOutlet",
  inheritAttrs: false,
  setup() {
    const { core } = useRuntime()
    const registry = injectRegistry()
    const branch = inject(branchKey)
    if (branch === undefined) throw new Error("Outlet requires an active route branch")
    const depth = inject(depthKey, 0)
    provide(depthKey, depth + 1)
    let cached: RenderPolicy.Selection | undefined
    // Selected presentation subscriptions observe their selection, not every branch publication.
    const selection = computed(() => {
      const next = RenderPolicy.select(branch.value, depth, declaresFallback)
      if (cached !== undefined && RenderPolicy.sameSelection(cached, next)) return cached
      cached = next
      return next
    })
    const refresh = () => registry.set(core.navigate, Router.refresh)
    return () => {
      const selected = selection.value
      if (selected._tag === "Empty") return null
      const route = branch.value.matches[depth]?.route as Route.Any & Views | undefined
      if (route === undefined) return null
      if (selected._tag === "Boundary") {
        const view = selected.kind === "errorComponent"
          ? route.errorComponent ?? DefaultError
          : selected.kind === "pendingComponent"
          ? route.pendingComponent ?? DefaultPending
          : route.notFoundComponent ?? DefaultNotFound
        return h(FallbackSnapshot, { key: `${route.id}:${selected.kind}` }, {
          default: () => h(view, selected.kind === "errorComponent" ? { error: selected.error, reset: refresh } : {})
        })
      }
      const entry = branch.value.matches[depth]
      const module = entry?.result._tag === "Success" ? entry.result.value.module : undefined
      const selectedView = selectVueView(route, module)
      const component = isVueView(selectedView) ? selectedView : invalidVueView(route.id, selectedView)
      const view = () => h(component, { key: route.id })
      if (route.errorComponent === undefined && depth !== 0) return view()
      return h(RenderBoundary, { key: route.id, route, refresh }, { default: view })
    }
  }
})

const destinationProps = {
  to: { type: String, required: true as const },
  params: Object as PropType<unknown>,
  search: Object as PropType<unknown>,
  hash: { default: undefined },
  replace: Boolean,
  state: { default: undefined }
}
/** @since 0.1.0 */
export type LinkProps = Destination & Omit<AnchorHTMLAttributes, "href" | "onClick"> & {
  readonly exact?: boolean
  readonly onClick?: ((event: MouseEvent) => void) | ReadonlyArray<(event: MouseEvent) => void>
}

/** A real anchor with typed destinations, native events, and reactive active state. @since 0.1.0 */
export const Link = defineComponent({
  name: "RouterLink",
  inheritAttrs: false,
  props: { ...destinationProps, exact: Boolean },
  setup(props, { attrs, slots }) {
    const router = useRuntime()
    const navigate = useNavigate()
    // Active state tracks the selected location projection rather than full router state.
    const locationAtom = Atom.map(router.core.branch, (branch) => branch.location)
    const location = useAtomValue(() => locationAtom)
    const destination = () => props as Destination
    const href = computed(() => {
      const encoded = router.href(destination())
      if (Result.isFailure(encoded)) throw encoded.failure
      return encoded.success
    })
    const onClick = (event: MouseEvent) => {
      const anchor = event.currentTarget as HTMLAnchorElement
      if (
        event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey ||
        event.altKey || (anchor.target !== "" && anchor.target !== "_self") || anchor.hasAttribute("download")
      ) return
      event.preventDefault()
      // Router state already publishes failures to route boundaries; the bridge consumes them.
      navigate(destination()).catch(() => {})
    }
    return () => {
      const current = location.value
      const pathname = href.value.split(/[?#]/)[0]
      const active = Option.isSome(current) &&
        (current.value.pathname === pathname ||
          (!props.exact && pathname !== "/" && current.value.pathname.startsWith(`${pathname}/`)))
      // Vue dispatches event arrays with its native error handling and
      // stopImmediatePropagation semantics; interception runs last.
      const handlers = attrs.onClick === undefined
        ? [onClick]
        : [...(Array.isArray(attrs.onClick) ? attrs.onClick : [attrs.onClick]), onClick]
      return h("a", {
        ...attrs,
        href: href.value,
        "aria-current": active ? "page" : undefined,
        "data-active": active ? "true" : undefined,
        onClick: handlers
      }, slots.default?.())
    }
  }
}) as unknown as FunctionalComponent<LinkProps>

/** Navigates on mount or whenever its structural intent (href, replace, state) changes. @since 0.1.0 */
export const Navigate = defineComponent({
  name: "RouterNavigate",
  inheritAttrs: false,
  props: destinationProps,
  setup(props) {
    const router = useRuntime()
    const navigate = useNavigate()
    const locationAtom = Atom.map(router.core.branch, (branch) => branch.location)
    const location = useAtomValue(() => locationAtom)
    let previous: RenderPolicy.NavigationIntent | undefined
    watchEffect(() => {
      const destination = props as Destination
      const encoded = router.href(destination)
      if (Result.isFailure(encoded)) throw encoded.failure
      // State is read reactively here, so structural changes retrigger this effect even
      // when the URL is unchanged.
      const intent: RenderPolicy.NavigationIntent = {
        href: encoded.success,
        replace: props.replace === true,
        state: props.state
      }
      if (RenderPolicy.sameIntent(previous, intent)) return
      previous = intent
      // Pending boundaries can unmount and remount a declarative redirect. An
      // already-satisfied location, including explicit state, is a no-op.
      if (RenderPolicy.isSatisfied(intent, location.value)) return
      // Router state already publishes failures to route boundaries; the bridge consumes them.
      navigate(destination).catch(() => {})
    }, { flush: "post" })
    return () => null
  }
}) as unknown as FunctionalComponent<Destination>
