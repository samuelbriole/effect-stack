/** First-party client-side React routing. @since 0.1.0 */
import { BrowserHistory, type History, Route, Router, RouteTree } from "@effect-stack/router"
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-react"
import { Cause, type Effect, Layer, Result, type Schema } from "effect"
import type { Atom, AtomRegistry } from "effect/unstable/reactivity"
import * as React from "react"

/** @since 0.1.0 */
export interface ErrorProps {
  readonly error: unknown
  readonly reset: () => void
}
/** @since 0.1.0 */
export interface Views {
  readonly component?: React.ComponentType
  readonly pendingComponent?: React.ComponentType
  readonly errorComponent?: React.ComponentType<ErrorProps>
  readonly notFoundComponent?: React.ComponentType
}
/** @since 0.1.0 */
export type ReactRoute<
  R extends Route.Any,
  C extends ReadonlyArray<RouteTree.Any> = readonly [],
  K extends RouteTree.Kind = RouteTree.Kind
> =
  & Omit<RouteTree.Node<R, C, K>, "addChildren">
  & Views
  & {
    readonly addChildren: <const Children extends ReadonlyArray<RouteTree.Any>>(
      children: Children
    ) => ReactRoute<R, Children, K>
    readonly useParams: () => Route.Route.Params<R>
    readonly useSearch: () => Route.Route.Search<R>
    readonly useLoaderData: () => Route.Route.LoaderData<R>
    readonly useMatch: () => Router.ResolvedRoute<R>
  }

const decorate = <R extends Route.Any, C extends ReadonlyArray<RouteTree.Any>, K extends RouteTree.Kind>(
  route: RouteTree.Node<R, C, K>,
  views: Views
): ReactRoute<R, C, K> => ({
  ...route,
  ...(views.component === undefined ? {} : { component: views.component }),
  ...(views.pendingComponent === undefined ? {} : { pendingComponent: views.pendingComponent }),
  ...(views.errorComponent === undefined ? {} : { errorComponent: views.errorComponent }),
  ...(views.notFoundComponent === undefined ? {} : { notFoundComponent: views.notFoundComponent }),
  addChildren: (children) => decorate(route.addChildren(children), views),
  useMatch: () => useMatch<R>(route),
  useParams: () => useMatch<R>(route).params,
  useSearch: () => useMatch<R>(route).search,
  useLoaderData: () => useMatch<R>(route).loaderData
} as ReactRoute<R, C, K>)

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
): ReactRoute<Route.Route<"__root__", "/", {}, S, H, M, ME, MR, D, E, R>, readonly [], "root"> {
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
): ReactRoute<
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
): ReactRoute<
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
  // Public overloads enforce the exclusive path/ID shape before this erased bridge.
  const construct = RouteTree.make as unknown as (input: typeof options) => RouteTree.Node<Route.Any>
  return decorate(construct(options), options)
}

/** Augment with `interface Register { router: typeof router }`. @since 0.1.0 */
export interface Register {}
/** @since 0.1.0 */
export type RegisteredRouter = Register extends { readonly router: infer R } ? R : ClientRouter<RouteTree.Any, unknown>
type RegisteredTree = RegisteredRouter extends { readonly routeTree: infer T extends RouteTree.Any } ? T : RouteTree.Any
type OptionalInput<K extends string, A> = {} extends A ? { readonly [P in K]?: A } : { readonly [P in K]: A }
/** @since 0.1.0 */
export type Destination<T extends RouteTree.Any = RegisteredTree> = RouteTree.All<T> extends infer R
  ? R extends RouteTree.Any ? RankedLeaf<R> extends infer L ? L extends RouteTree.Any ?
          & { readonly to: L["path"]; readonly replace?: boolean; readonly state?: unknown }
          & OptionalInput<"params", Route.Route.Params<L>>
          & OptionalInput<"search", Route.Route.Search<L>>
          & ("" extends Route.Route.Hash<L> ? { readonly hash?: Route.Route.Hash<L> }
            : { readonly hash: Route.Route.Hash<L> })
      : never
    : never
  : never :
  never

type IndexNode = { readonly kind: "index" }
type LayoutNode = { readonly kind: "layout" }

/**
 * The unique index route sharing this node's exact URL, reached directly or through pathless layouts.
 * `RouteTree.flatten` rejects two indexes on one template, so at most one exists.
 */
type SameUrlIndex<N extends RouteTree.Any> =
  | Extract<N["children"][number], IndexNode>
  | (Extract<N["children"][number], LayoutNode> extends infer L ? L extends RouteTree.Any ? SameUrlIndex<L> : never
    : never)

/**
 * The route an exact match on this URL resolves to, mirroring `RouteTree.plan` ranking: pathless layouts
 * never end a branch, and a same-URL index outranks its ancestors.
 */
type RankedLeaf<N extends RouteTree.Any> = N extends LayoutNode ? never
  : SameUrlIndex<N> extends infer I ? [I] extends [never] ? N : I
  : never

/** @since 0.1.0 */
export interface ClientRouter<T extends RouteTree.Any, E> {
  readonly routeTree: T
  readonly core: Router.Router<ReadonlyArray<RouteTree.All<T>>, E>
  readonly href: (destination: Destination<T>) => Result.Result<string, Route.RouteEncodeError>
}

/** Browser history is the default; application services are supplied independently. @since 0.1.0 */
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
  // The conditional options require this layer whenever the tree has requirements.
  const application = (options.layer ?? Layer.empty) as Layer.Layer<Route.Route.Services<RouteTree.All<T>>, E>
  const core = Router.fromTree({ routeTree: options.routeTree, layer: Layer.merge(history, application) })
  return {
    routeTree: options.routeTree,
    core,
    href: (destination) => {
      const { route, input } = target(core.routes, destination)
      return Route.href(route, input)
    }
  }
}

type RuntimeRouter = ClientRouter<RouteTree.Any, unknown>
const RouterContext = React.createContext<RuntimeRouter | null>(null)
const BranchContext = React.createContext<Router.Branch>({ matches: [], notFound: false })
const DepthContext = React.createContext(0)
const DefaultPending = () => <div role="status">Loading…</div>
const DefaultNotFound = () => <div role="status">Page not found</div>
const DefaultError = ({ reset }: ErrorProps) =>
  <div role="alert">
    Unable to display this route. <button onClick={reset}>Retry</button>
  </div>

/** @since 0.1.0 */
export function useRouter(): RegisteredRouter {
  const router = React.useContext(RouterContext)
  if (router === null) throw new Error("Router hooks require RouterProvider")
  return router as RegisteredRouter
}
function useRuntime(): RuntimeRouter {
  return useRouter() as RuntimeRouter
}
/** @since 0.1.0 */
export function useRouterState(): Atom.Type<RegisteredRouter["core"]["state"]> {
  return useAtomValue(useRuntime().core.state) as Atom.Type<RegisteredRouter["core"]["state"]>
}
function useMatch<R extends Route.Any>(route: R): Router.ResolvedRoute<R> {
  const branch = React.useContext(BranchContext)
  const match = branch.matches.find((entry) => entry.route.id === route.id)
  if (match?.result._tag !== "Success") throw new Error(`Route ${route.id} has no resolved match in this branch`)
  return match.result.value as Router.ResolvedRoute<R>
}

interface RuntimeDestination {
  readonly to: string
  readonly params?: unknown
  readonly search?: unknown
  readonly hash?: unknown
  readonly replace?: boolean
  readonly state?: unknown
}
const target = (routes: ReadonlyArray<RouteTree.Any>, destination: RuntimeDestination) => {
  // Mirror `RouteTree.plan` exact-match ranking for this path template: pathless layouts never resolve
  // on their own, and a same-URL index outranks its ancestors.
  let route: RouteTree.Any | undefined
  for (const entry of routes) {
    if (entry.kind === "layout" || entry.path !== destination.to) continue
    if (route === undefined || route.kind !== "index") route = entry
  }
  if (route === undefined) throw new Error(`Unknown route destination: ${destination.to}`)
  return {
    route,
    input: {
      params: destination.params ?? {},
      search: destination.search ?? {},
      hash: destination.hash ?? ""
    } as Route.Route.Input<Route.Any>
  }
}
/** @since 0.1.0 */
export function useNavigate(): (destination: Destination) => void {
  const { core } = useRuntime()
  const registry = React.useContext(RegistryContext)
  return React.useCallback((destination: Destination) => {
    const { route, input } = target(core.routes, destination)
    const href = Route.href(route, input)
    if (Result.isFailure(href)) throw href.failure
    registry.set(
      core.navigate,
      destination.replace
        ? Router.replace<RouteTree.Any>(route, input, destination.state)
        : Router.push<RouteTree.Any>(route, input, destination.state)
    )
  }, [core, registry])
}

/** Owns an Atom registry by default; supplied registries remain caller-owned. @since 0.1.0 */
export function RouterProvider<T extends RouteTree.Any, E>(
  { router, registry }: { readonly router: ClientRouter<T, E>; readonly registry?: AtomRegistry.AtomRegistry }
) {
  const content = (
    <RouterContext.Provider value={router as RuntimeRouter}>
      <RouterView />
    </RouterContext.Provider>
  )
  return registry === undefined
    ? <RegistryProvider>{content}</RegistryProvider>
    : <RegistryContext.Provider value={registry}>{content}</RegistryContext.Provider>
}
function RouterView() {
  const { core } = useRuntime()
  const registry = React.useContext(RegistryContext)
  React.useEffect(() => registry.mount(core.navigate), [registry, core])
  const branch = useAtomValue(core.branch)
  const state = useAtomValue(core.state)
  if (branch.matches.length === 0) {
    const root = core.routes[0] as RouteTree.Any & Views
    if (state._tag === "Failure") {
      const ErrorView = root.errorComponent ?? DefaultError
      return <ErrorView error={Cause.squash(state.cause)} reset={() => registry.set(core.navigate, Router.refresh)} />
    }
    const Pending = root.pendingComponent ?? DefaultPending
    return <Pending />
  }
  return (
    <BranchContext.Provider value={branch}>
      <DepthContext.Provider value={0}>
        <Outlet />
      </DepthContext.Provider>
    </BranchContext.Provider>
  )
}

class RenderBoundary extends React.Component<
  {
    readonly children: React.ReactNode
    readonly fallback: React.ComponentType<ErrorProps>
    readonly reset: () => void
    readonly locationKey: string
  },
  { readonly failed: boolean; readonly error: unknown }
> {
  override state = { failed: false, error: undefined as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error }
  }
  override componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.failed && previous.locationKey !== this.props.locationKey) {
      this.setState({ failed: false, error: undefined })
    }
  }
  override render() {
    const Fallback = this.props.fallback
    return this.state.failed
      ? (
        <Fallback
          error={this.state.error}
          reset={() => {
            this.setState({ failed: false, error: undefined })
            this.props.reset()
          }}
        />
      )
      : this.props.children
  }
}

/** Renders the next route in the active branch. @since 0.1.0 */
export function Outlet(): React.ReactNode {
  const branch = React.useContext(BranchContext)
  const depth = React.useContext(DepthContext)
  const { core } = useRuntime()
  const registry = React.useContext(RegistryContext)
  const reset = () => registry.set(core.navigate, Router.refresh)
  const entries = branch.matches
  let problem = entries.findIndex((entry) => entry.result._tag === "Failure")
  let kind: "errorComponent" | "pendingComponent" | "notFoundComponent" = "errorComponent"
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
  if (problem >= 0 && depth === boundary) {
    const views = entries[boundary].route as Views
    if (kind === "errorComponent") {
      const View = views.errorComponent ?? DefaultError
      const failure = entries[problem].result
      return <View error={failure._tag === "Failure" ? Cause.squash(failure.cause) : undefined} reset={reset} />
    }
    const View = kind === "pendingComponent"
      ? views.pendingComponent ?? DefaultPending
      : views.notFoundComponent ?? DefaultNotFound
    return <View />
  }
  const entry = entries[depth]
  if (entry === undefined || entry.result._tag !== "Success") return null
  const views = entry.route as Views
  const module = entry.result.value.module as {
    readonly default?: React.ComponentType
    readonly component?: React.ComponentType
  } | undefined
  const View = views.component ?? module?.component ?? module?.default ?? Outlet
  const content = (
    <DepthContext.Provider value={depth + 1}>
      <View />
    </DepthContext.Provider>
  )
  return views.errorComponent !== undefined || depth === 0
    ? (
      <RenderBoundary
        key={entry.route.id}
        locationKey={entry.result.value.location.key}
        fallback={views.errorComponent ?? DefaultError}
        reset={reset}
      >
        {content}
      </RenderBoundary>
    )
    : <React.Fragment key={entry.route.id}>{content}</React.Fragment>
}

/** Real anchors with typed destinations and native modified-click behavior. @since 0.1.0 */
export function Link(
  props: Destination & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { readonly exact?: boolean }
): React.ReactNode {
  const { to, params, search, hash, replace, state, exact = false, onClick, ...anchor } = props
  const router = useRuntime()
  const navigate = useNavigate()
  const current = useRouterState()
  const destination = { to, params, search, hash, replace, state } as Destination
  const { route, input } = target(router.core.routes, destination)
  const href = Route.href(route, input)
  if (Result.isFailure(href)) throw href.failure
  const pathname = href.success.split(/[?#]/)[0]
  const active = current._tag === "Success" &&
    (current.value.location.pathname === pathname ||
      (!exact && pathname !== "/" && current.value.location.pathname.startsWith(`${pathname}/`)))
  return (
    <a
      {...anchor}
      href={href.success}
      aria-current={active ? "page" : undefined}
      data-active={active ? "true" : undefined}
      onClick={(event) => {
        onClick?.(event)
        if (
          event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey ||
          event.altKey || (anchor.target !== undefined && anchor.target !== "_self") ||
          (anchor.download !== undefined && anchor.download !== false)
        ) return
        event.preventDefault()
        navigate(destination)
      }}
    />
  )
}

/** Navigates when mounted or when its destination changes. @since 0.1.0 */
export function Navigate(props: Destination) {
  const navigate = useNavigate()
  const router = useRuntime()
  const latest = React.useRef(props)
  latest.current = props
  const href = router.href(props)
  if (Result.isFailure(href)) throw href.failure
  const key = `${props.replace === true ? "replace" : "push"}:${href.success}`
  const previous = React.useRef<{ readonly key: string; readonly navigate: typeof navigate } | undefined>(undefined)
  React.useEffect(() => {
    if (previous.current?.key === key && previous.current.navigate === navigate) return
    previous.current = { key, navigate }
    navigate(latest.current)
  }, [navigate, key])
  return null
}
