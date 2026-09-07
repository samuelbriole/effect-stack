/** First-party client-side Vue routing. @since 0.1.0 */
import { BrowserHistory, type History, Route, Router, RouteTree } from "@effect-stack/router"
import { injectRegistry, registryKey, useAtomValue } from "@effect/atom-vue"
import { Cause, type Effect, Layer, Result, type Schema } from "effect"
import { type Atom, AtomRegistry } from "effect/unstable/reactivity"
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
    readonly useParams: () => ComputedRef<Route.Route.Params<R>>
    readonly useSearch: () => ComputedRef<Route.Route.Search<R>>
    readonly useLoaderData: () => ComputedRef<Route.Route.LoaderData<R>>
    readonly useMatch: () => ComputedRef<Router.ResolvedRoute<R>>
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
  addChildren: (children) => decorate(route.addChildren(children), views),
  useMatch: () => useMatch<R>(route),
  useParams: () => {
    const match = useMatch<R>(route)
    return computed(() => match.value.params)
  },
  useSearch: () => {
    const match = useMatch<R>(route)
    return computed(() => match.value.search)
  },
  useLoaderData: () => {
    const match = useMatch<R>(route)
    return computed(() => match.value.loaderData)
  }
} as VueRoute<R, C, K>)

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
  options: Views & { readonly search?: S; readonly hash?: H } & RouteTree.Loading<{}, S, H, M, ME, MR, D, E, R> = {}
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
  options: Views & {
    readonly getParentRoute: () => Parent
    readonly id: Id
    readonly path?: never
    readonly search?: S
    readonly hash?: H
  } & RouteTree.Loading<Parent["paramsSchema"]["fields"], Parent["searchSchema"]["fields"] & S, H, M, ME, MR, D, E, R>
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
  options: Views & RouteTree.Options<Parent, Path, P, S, H, M, ME, MR, D, E, R>
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
  const core = Router.fromTree({ routeTree: options.routeTree, layer: Layer.merge(history, application) })
  return markRaw({
    routeTree: options.routeTree,
    core,
    href: (destination: Destination<T>) => {
      const { route, input } = RouteTree.target(core.routes, destination)
      return Route.href(route, input)
    }
  })
}

type RuntimeRouter = ClientRouter<RouteTree.Any, unknown>
const routerKey: InjectionKey<RuntimeRouter> = Symbol("effect-stack/router")
const branchKey: InjectionKey<Readonly<Ref<Router.Branch>>> = Symbol("effect-stack/branch")
const depthKey: InjectionKey<number> = Symbol("effect-stack/depth")
const DefaultPending = () => h("div", { role: "status" }, "Loading…")
const DefaultNotFound = () => h("div", { role: "status" }, "Page not found")
const DefaultError = (props: ErrorProps) =>
  h("div", { role: "alert" }, ["Unable to display this route. ", h("button", { onClick: props.reset }, "Retry")])

/** @since 0.1.0 */
export function useRouter(): RegisteredRouter {
  const router = inject(routerKey)
  if (router === undefined) throw new Error("Router hooks require RouterProvider")
  return router as RegisteredRouter
}
const useRuntime = (): RuntimeRouter => useRouter() as RuntimeRouter
/** @since 0.1.0 */
export function useRouterState(): Readonly<Ref<Atom.Type<RegisteredRouter["core"]["state"]>>> {
  const { core } = useRuntime()
  return useAtomValue(() => core.state) as Readonly<Ref<Atom.Type<RegisteredRouter["core"]["state"]>>>
}
function useMatch<R extends Route.Any>(route: R): ComputedRef<Router.ResolvedRoute<R>> {
  useRuntime()
  const branch = inject(branchKey)
  const initial = branch?.value.matches.find((entry) => entry.route.id === route.id)
  if (initial?.result._tag !== "Success") throw new Error(`Route ${route.id} has no resolved match in this branch`)
  let previous = initial.result.value
  return computed(() => {
    const match = branch?.value.matches.find((entry) => entry.route.id === route.id)
    // Exiting components can read their input until Vue finishes their unmount.
    if (match?.result._tag === "Success") previous = match.result.value
    return previous as Router.ResolvedRoute<R>
  })
}

/** @since 0.1.0 */
export function useNavigate(): (destination: Destination) => void {
  const { core } = useRuntime()
  const registry = injectRegistry()
  return (destination) => {
    const { route, input } = RouteTree.target(core.routes, destination)
    const href = Route.href(route, input)
    if (Result.isFailure(href)) throw href.failure
    registry.set(
      core.navigate,
      destination.replace
        ? Router.replace<RouteTree.Any>(route, input, destination.state)
        : Router.push<RouteTree.Any>(route, input, destination.state)
    )
  }
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
    const registry = injectRegistry()
    onScopeDispose(registry.mount(core.navigate))
    const branch = useAtomValue(() => core.branch)
    const state = useAtomValue(() => core.state)
    provide(branchKey, branch)
    provide(depthKey, 0)
    const root = core.routes[0] as Route.Any & Views
    const reset = () => registry.set(core.navigate, Router.refresh)
    return () =>
      branch.value.matches.length > 0 ? h(Outlet) : state.value._tag === "Failure"
        ? h(root.errorComponent ?? DefaultError, { error: Cause.squash(state.value.cause), reset })
        : h(root.pendingComponent ?? DefaultPending)
  }
})

type BoundaryKind = "errorComponent" | "pendingComponent" | "notFoundComponent"
interface Selection {
  readonly route: Route.Any & Views
  readonly component: Component
  readonly kind: "view" | BoundaryKind
  readonly error: unknown
}
const select = (branch: Router.Branch, depth: number): Selection | undefined => {
  const entries = branch.matches
  let problem = entries.findIndex((entry) => entry.result._tag === "Failure")
  let kind: BoundaryKind = "errorComponent"
  if (problem < 0) {
    problem = entries.findIndex((entry) => entry.result._tag === "Initial")
    kind = "pendingComponent"
  }
  if (problem < 0 && branch.notFound) {
    problem = entries.length - 1
    kind = "notFoundComponent"
  }
  let boundary = problem
  while (boundary > 0 && (entries[boundary].route as Views)[kind] === undefined) boundary--
  if (problem >= 0 && boundary === depth) {
    const route = entries[boundary].route as Route.Any & Views
    const failure = entries[problem].result
    return {
      route,
      kind,
      component: kind === "errorComponent"
        ? route.errorComponent ?? DefaultError
        : kind === "pendingComponent"
        ? route.pendingComponent ?? DefaultPending
        : route.notFoundComponent ?? DefaultNotFound,
      error: failure._tag === "Failure" ? Cause.squash(failure.cause) : undefined
    }
  }
  const entry = entries[depth]
  if (entry?.result._tag !== "Success") return undefined
  const route = entry.route as Route.Any & Views
  const module = entry.result.value.module as
    | { readonly component?: Component; readonly default?: Component }
    | undefined
  return {
    route,
    kind: "view",
    component: route.component ?? module?.component ?? module?.default ?? Outlet,
    error: undefined
  }
}

const RenderBoundary = defineComponent({
  name: "RouteRenderBoundary",
  inheritAttrs: false,
  props: {
    route: { type: Object as PropType<Route.Any & Views>, required: true },
    locationKey: String,
    refresh: { type: Function as PropType<() => void>, required: true }
  },
  setup(props, { slots }) {
    const failure = shallowRef<{ readonly error: unknown }>()
    onErrorCaptured((error) => {
      failure.value = { error }
      return false
    })
    watch(() => props.locationKey, () => {
      failure.value = undefined
    }, { flush: "sync" })
    const reset = () => {
      failure.value = undefined
      props.refresh()
    }
    return () =>
      failure.value === undefined
        ? slots.default?.()
        : h(props.route.errorComponent ?? DefaultError, { error: failure.value.error, reset })
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
    const selection = computed(() => select(branch.value, depth))
    const refresh = () => registry.set(core.navigate, Router.refresh)
    return () => {
      const selected = selection.value
      if (selected === undefined) return null
      const view = () =>
        h(
          selected.component,
          selected.kind === "view"
            ? { key: selected.route.id }
            : { key: `${selected.route.id}:${selected.kind}`, error: selected.error, reset: refresh }
        )
      if (selected.kind !== "view" || (selected.route.errorComponent === undefined && depth !== 0)) return view()
      const match = branch.value.matches[depth]?.result
      return h(RenderBoundary, {
        key: selected.route.id,
        route: selected.route,
        ...(match?._tag === "Success" ? { locationKey: match.value.location.key } : {}),
        refresh
      }, { default: view })
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
    const current = useRouterState()
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
      navigate(destination())
    }
    return () => {
      const state = current.value
      const pathname = href.value.split(/[?#]/)[0]
      const active = state._tag === "Success" &&
        (state.value.location.pathname === pathname ||
          (!props.exact && pathname !== "/" && state.value.location.pathname.startsWith(`${pathname}/`)))
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

/** Navigates on mount or when the encoded destination changes. @since 0.1.0 */
export const Navigate = defineComponent({
  name: "RouterNavigate",
  inheritAttrs: false,
  props: destinationProps,
  setup(props) {
    const router = useRuntime()
    const navigate = useNavigate()
    const registry = injectRegistry()
    let previous: string | undefined
    watchEffect(() => {
      const destination = props as Destination
      const result = router.href(destination)
      if (Result.isFailure(result)) throw result.failure
      const key = `${props.replace ? "replace" : "push"}:${result.success}`
      if (key === previous) return
      previous = key
      // Pending boundaries can unmount and remount a declarative redirect. An
      // already satisfied URL without an explicit state update is a no-op.
      const state = registry.get(router.core.state)
      if (props.state === undefined && state._tag === "Success") {
        const location = state.value.location
        if (`${location.pathname}${location.search}${location.hash}` === result.success) return
      }
      navigate(destination)
    }, { flush: "post" })
    return () => null
  }
}) as unknown as FunctionalComponent<Destination>
