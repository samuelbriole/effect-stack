/** First-party client-side React routing. @since 0.1.0 */
import { BrowserHistory, type History, RenderPolicy, Route, Router, RouteTree } from "@effect-stack/router"
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-react"
import { Cause, Effect, Equal, Layer, Option, Result, type Schema } from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
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

type ReactModuleView = NonNullable<Views["component"]>

// A lazy module may carry renderer-neutral data, but a present view export must be a React component.
// Modules without `default`/`component` keep the Outlet fallback.
type CheckedLazyModule<M> = RouteTree.CheckedLazyModule<M, ReactModuleView>
/** @since 0.2.0 */
export interface SelectorOptions<A> {
  readonly equals?: (left: A, right: A) => boolean
}
/** @since 0.2.0 */
export interface RouteHook<A> {
  <B>(select: (value: A) => B, options?: SelectorOptions<B>): B
  (): A
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
    readonly useParams: RouteHook<Route.Route.Params<R>>
    readonly useSearch: RouteHook<Route.Route.Search<R>>
    readonly useLoaderData: RouteHook<Route.Route.LoaderData<R>>
    readonly useMatch: RouteHook<Router.ResolvedRoute<R>>
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
  addChildren: <const Children extends ReadonlyArray<RouteTree.Any>>(children: Children) =>
    decorate(route.addChildren(children), views),
  useMatch: <A = Router.ResolvedRoute<R>>(
    select?: (value: Router.ResolvedRoute<R>) => A,
    options?: SelectorOptions<A>
  ) => useRouteValue(route, "match", select, options),
  useParams: <A = Route.Route.Params<R>>(select?: (value: Route.Route.Params<R>) => A, options?: SelectorOptions<A>) =>
    useRouteValue(route, "params", select, options),
  useSearch: <A = Route.Route.Search<R>>(select?: (value: Route.Route.Search<R>) => A, options?: SelectorOptions<A>) =>
    useRouteValue(route, "search", select, options),
  useLoaderData: <A = Route.Route.LoaderData<R>>(
    select?: (value: Route.Route.LoaderData<R>) => A,
    options?: SelectorOptions<A>
  ) => useRouteValue(route, "loaderData", select, options)
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
  options:
    & Views
    & { readonly search?: S; readonly hash?: H }
    & RouteTree.Loading<{}, S, H, M, ME, MR, D, E, R>
    & CheckedLazyModule<M> = {}
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
  options: Views & RouteTree.Options<Parent, Path, P, S, H, M, ME, MR, D, E, R> & CheckedLazyModule<M>
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
    readonly lazy?: () => Effect.Effect<unknown, unknown, unknown>
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
/** @since 0.1.0 */
export type Destination<T extends RouteTree.Any = RegisteredTree> = RouteTree.Destination<T>

/** @since 0.1.0 */
export interface ClientRouter<T extends RouteTree.Any, E> {
  readonly routeTree: T
  readonly compiled: RouteTree.Compiled<RouteTree.All<T>>
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
  const compiled = RouteTree.compile(options.routeTree)
  return {
    routeTree: options.routeTree,
    compiled,
    core,
    href: (destination) => {
      const { route, input } = compiled.target(destination)
      return Route.href(route, input)
    }
  }
}

type RuntimeRouter = ClientRouter<RouteTree.Any, unknown>
const RouterContext = React.createContext<RuntimeRouter | null>(null)
const SnapshotContext = React.createContext<"resolved" | "incoming">("resolved")
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
export function useRouterState<A>(
  select: (state: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): A
export function useRouterState(): Atom.Type<RegisteredRouter["core"]["state"]>
export function useRouterState<A = Atom.Type<RegisteredRouter["core"]["state"]>>(
  select?: (state: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): A {
  const { core } = useRuntime()
  const equals = options?.equals ?? Object.is
  const atom = React.useMemo(() =>
    Atom.map(core.state, (value) =>
      select === undefined
        ? value as A :
        select(value as Atom.Type<RegisteredRouter["core"]["state"]>)).pipe(Atom.withEquality<A>(equals)), [
    core,
    select,
    equals
  ])
  return useAtomValue(atom)
}
type RouteValues<R extends Route.Any> = {
  readonly match: Router.ResolvedRoute<R>
  readonly params: Route.Route.Params<R>
  readonly search: Route.Route.Search<R>
  readonly loaderData: Route.Route.LoaderData<R>
}
function useRouteValue<R extends Route.Any, K extends keyof RouteValues<R>, A = RouteValues<R>[K]>(
  route: R & RouteTree.Any,
  key: K,
  select?: (value: RouteValues<R>[K]) => A,
  options?: SelectorOptions<A>
): A {
  const { core } = useRuntime()
  const mode = React.useContext(SnapshotContext)
  const atoms = core.routeAtoms(route)
  const equals = options?.equals ??
    (select === undefined && (key === "params" || key === "search") ? Equal.equals : Object.is)
  const selected = React.useMemo(() =>
    Atom.make((get) => {
      const resolved = get(atoms.resolved)
      const useIncoming = mode === "incoming" && (key === "params" || key === "search")
      const incoming = useIncoming
        ? get(atoms.incoming)
        : Option.none()
      const snapshot = useIncoming
        ? Option.isSome(incoming) && Result.isSuccess(incoming.value) ? incoming.value.success : undefined
        : Option.isSome(resolved)
        ? resolved.value
        : undefined
      if (snapshot === undefined) return Option.none<A>()
      const value = (key === "match" ? snapshot : snapshot[key as keyof typeof snapshot]) as RouteValues<R>[K]
      return Option.some(select === undefined ? value as A : select(value))
    }).pipe(Atom.withEquality<Option.Option<A>>((left, right) =>
      Option.isSome(left)
        ? Option.isSome(right) && equals(left.value, right.value)
        : Option.isNone(right)
    )), [atoms, mode, key, select, equals])
  const value = useAtomValue(selected)
  if (Option.isNone(value)) {
    throw new Error(
      `Route ${route.id} has no ${key === "params" || key === "search" ? "decoded" : "resolved"} match in this branch`
    )
  }
  return value.value
}

/** @since 0.2.0 */
export type NavigationError = Effect.Error<ReturnType<RegisteredRouter["core"]["execute"]>>
/** The provider's registry is supplied; interruption cancels this operation's transition. @since 0.2.0 */
export function useNavigateEffect(): (destination: Destination) => Effect.Effect<void, NavigationError> {
  const { core, compiled } = useRuntime()
  const registry = React.useContext(RegistryContext)
  return React.useCallback((destination: Destination) =>
    Effect.suspend(() => {
      const { route, input } = compiled.target(destination)
      return core.execute(
        destination.replace
          ? Router.replace<RouteTree.Any>(route, input, destination.state)
          : Router.push<RouteTree.Any>(route, input, destination.state)
      ).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
    }) as Effect.Effect<void, NavigationError>, [core, compiled, registry])
}
/** Awaits this transition's resolution and scoped cleanup. @since 0.1.0 */
export function useNavigate(): (
  destination: Destination,
  options?: { readonly signal?: AbortSignal }
) => Promise<void> {
  const navigate = useNavigateEffect()
  return React.useCallback((destination, options) => Effect.runPromise(navigate(destination), options), [navigate])
}
function useRetry(): () => void {
  const { core } = useRuntime()
  const registry = React.useContext(RegistryContext)
  return React.useCallback(() => {
    void Effect.runPromise(core.retry.pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))).catch(() => {})
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
type Startup = { readonly _tag: "Active" | "Pending" } | { readonly _tag: "Failure"; readonly error: unknown }
function RouterView() {
  const { core } = useRuntime()
  const registry = React.useContext(RegistryContext)
  React.useEffect(() => registry.mount(core.navigation), [registry, core])
  const retry = useRetry()
  const startup = React.useMemo(() =>
    Atom.map(core.branch, (branch): Startup =>
      branch.matches.length > 0
        ? { _tag: "Active" } :
        branch.result._tag === "Failure"
        ? { _tag: "Failure", error: Cause.squash(branch.result.cause) }
        : { _tag: "Pending" }).pipe(
        Atom.withEquality<Startup>((left, right) =>
          left._tag === right._tag &&
          (left._tag !== "Failure" || (right._tag === "Failure" && Object.is(left.error, right.error)))
        )
      ), [core])
  const state = useAtomValue(startup)
  if (state._tag !== "Active") {
    const root = core.routes[0] as RouteTree.Any & Views
    if (state._tag === "Failure") {
      const ErrorView = root.errorComponent ?? DefaultError
      return (
        <SnapshotContext.Provider value="incoming">
          <ErrorView error={state.error} reset={retry} />
        </SnapshotContext.Provider>
      )
    }
    const Pending = root.pendingComponent ?? DefaultPending
    return <Pending />
  }
  return (
    <DepthContext.Provider value={0}>
      <Outlet />
    </DepthContext.Provider>
  )
}

class RenderBoundary extends React.Component<
  {
    readonly children: React.ReactNode
    readonly fallback: React.ComponentType<ErrorProps>
    readonly reset: () => void
    readonly recoveryKey: object | undefined
  },
  { readonly failed: boolean; readonly error: unknown }
> {
  override state = { failed: false, error: undefined as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error }
  }
  override componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.failed && previous.recoveryKey !== this.props.recoveryKey) {
      this.setState({ failed: false, error: undefined })
    }
  }
  override render() {
    const Fallback = this.props.fallback
    return this.state.failed
      ? (
        <SnapshotContext.Provider value="incoming">
          <Fallback error={this.state.error} reset={this.props.reset} />
        </SnapshotContext.Provider>
      )
      : this.props.children
  }
}

const ReactMemoType = Symbol.for("react.memo")
const ReactLazyType = Symbol.for("react.lazy")
const ReactForwardRefType = Symbol.for("react.forward_ref")
const ReactBuiltinViews = new Set([
  Symbol.for("react.fragment"),
  Symbol.for("react.strict_mode"),
  Symbol.for("react.profiler"),
  Symbol.for("react.suspense"),
  Symbol.for("react.activity")
])
const isReactView = (value: unknown): value is React.ComponentType => {
  if (typeof value === "function") return true
  if (typeof value === "symbol") return ReactBuiltinViews.has(value)
  const exotic = typeof value === "object" && value !== null
    ? (value as { readonly $$typeof?: symbol }).$$typeof
    : undefined
  return exotic === ReactMemoType || exotic === ReactLazyType || exotic === ReactForwardRefType
}
// Selection stays total; the actionable failure surfaces inside the render boundary so the
// nearest errorComponent catches it with the route ID in the message.
const invalidReactView = (routeId: string, value: unknown): React.ComponentType =>
  function InvalidLazyReactView(): React.ReactNode {
    throw new Error(
      `Route "${routeId}" selected a lazy module view that is not a React component (received ${
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value
      }). Export the page as the module 'default' or 'component' view.`
    )
  }

interface Presentation {
  readonly selection: RenderPolicy.Selection
  readonly route: Route.Any | undefined
  readonly module: unknown
  readonly recoveryKey: object | undefined
}

/** Renders the next route in the active branch. @since 0.1.0 */
export function Outlet(): React.ReactNode {
  const depth = React.useContext(DepthContext)
  const { core } = useRuntime()
  const reset = useRetry()
  const presentation = React.useMemo(() =>
    Atom.map(core.branch, (branch) => {
      const selection = RenderPolicy.select(branch, depth, (route, kind) => (route as Views)[kind] !== undefined)
      const entry = branch.matches[depth]
      return {
        selection,
        route: entry?.route,
        module: entry?.result._tag === "Success" ? entry.result.value.module : undefined,
        recoveryKey: entry === undefined ? undefined : RenderPolicy.recoveryKey(branch, entry.route.id)
      }
    }).pipe(Atom.withEquality<Presentation>((a, b) =>
      RenderPolicy.sameSelection(a.selection, b.selection) && a.route === b.route && a.module === b.module &&
      a.recoveryKey === b.recoveryKey
    )), [core, depth])
  const { selection, route, module, recoveryKey } = useAtomValue(presentation)
  const views = (route ?? {}) as Views
  const View = React.useMemo(() => {
    const lazy = module as { readonly default?: unknown; readonly component?: unknown } | undefined
    const selected: unknown = views.component !== undefined ?
      views.component
      : lazy?.component !== undefined
      ? lazy.component
      : lazy?.default !== undefined
      ? lazy.default
      : Outlet
    return isReactView(selected) ? selected : invalidReactView(route?.id ?? "unknown", selected)
  }, [views.component, module, route?.id])
  const content = React.useMemo(() => (
    <SnapshotContext.Provider value="resolved">
      <DepthContext.Provider value={depth + 1}>
        <View />
      </DepthContext.Provider>
    </SnapshotContext.Provider>
  ), [depth, View, route?.id])
  if (selection._tag === "Empty") return null
  if (selection._tag === "Boundary") {
    if (selection.kind === "errorComponent") {
      const ErrorView = views.errorComponent ?? DefaultError
      return (
        <SnapshotContext.Provider value="incoming">
          <ErrorView error={selection.error} reset={reset} />
        </SnapshotContext.Provider>
      )
    }
    const Fallback = selection.kind === "pendingComponent"
      ? views.pendingComponent ?? DefaultPending
      : views.notFoundComponent ?? DefaultNotFound
    return (
      <SnapshotContext.Provider value="incoming">
        <Fallback />
      </SnapshotContext.Provider>
    )
  }
  return views.errorComponent !== undefined || depth === 0
    ? (
      <RenderBoundary
        key={selection.routeId}
        recoveryKey={recoveryKey}
        fallback={views.errorComponent ?? DefaultError}
        reset={reset}
      >
        {content}
      </RenderBoundary>
    )
    : <React.Fragment key={selection.routeId}>{content}</React.Fragment>
}

/** Real anchors with typed destinations and native modified-click behavior. @since 0.1.0 */
export function Link(
  props: Destination & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { readonly exact?: boolean }
): React.ReactNode {
  const { to, params, search, hash, replace, state, exact = false, onClick, ...anchor } = props
  const router = useRuntime()
  const navigate = useNavigate()
  const destination = { to, params, search, hash, replace, state } as Destination
  const { route, input } = router.compiled.target(destination)
  const href = Route.href(route, input)
  if (Result.isFailure(href)) throw href.failure
  const pathname = href.success.split(/[?#]/)[0]
  const activeAtom = React.useMemo(() =>
    Atom.map(router.core.branch, (branch) =>
      Option.isSome(branch.location) &&
      (branch.location.value.pathname === pathname ||
        (!exact && pathname !== "/" && branch.location.value.pathname.startsWith(`${pathname}/`)))), [
    router,
    pathname,
    exact
  ])
  const active = useAtomValue(activeAtom)
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
        void navigate(destination).catch(() => {})
      }}
    />
  )
}

/** Navigates when mounted or when its destination changes. @since 0.1.0 */
export function Navigate(props: Destination) {
  const navigate = useNavigate()
  const router = useRuntime()
  const registry = React.useContext(RegistryContext)
  const latest = React.useRef(props)
  latest.current = props
  const href = router.href(props)
  if (Result.isFailure(href)) throw href.failure
  const url = href.success
  const previous = React.useRef<
    { readonly intent: RenderPolicy.NavigationIntent; readonly navigate: typeof navigate } | undefined
  >(undefined)
  React.useEffect(() => {
    const intent = { href: url, replace: latest.current.replace === true, state: latest.current.state }
    if (previous.current?.navigate === navigate && RenderPolicy.sameIntent(previous.current.intent, intent)) return
    previous.current = { intent, navigate }
    if (RenderPolicy.isSatisfied(intent, registry.get(router.core.branch).location)) return
    void navigate(latest.current).catch(() => {})
  }, [navigate, props.replace, props.state, registry, router, url])
  return null
}
