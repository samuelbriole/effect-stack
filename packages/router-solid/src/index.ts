/** First-party client-side Solid routing. @since 0.1.0 */
import { BrowserHistory, type History, RenderPolicy, Route, Router, RouteTree } from "@effect-stack/router"
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-solid"
import { Cause, Effect, Equal, Layer, Option, Result, type Schema } from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import {
  type Accessor,
  type Component,
  createComponent,
  createContext,
  createEffect,
  createMemo,
  ErrorBoundary,
  type JSX,
  mergeProps,
  onCleanup,
  Show,
  splitProps,
  untrack,
  useContext
} from "solid-js"
import { Dynamic } from "solid-js/web"

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

type SolidModuleView = NonNullable<Views["component"]>

// Distribute over module unions so one invalid view export member cannot hide
// behind another member that merely lacks the view keys.
type InvalidLazyModuleExport<M> = M extends unknown ?
    | ("default" extends keyof M ? ([Exclude<M["default"], undefined>] extends [SolidModuleView] ? never : true)
      : never)
    | ("component" extends keyof M ? ([Exclude<M["component"], undefined>] extends [SolidModuleView] ? never : true)
      : never)
  : never

// A lazy module may carry renderer-neutral data, but a present view export must be a Solid component.
// Optional undefined exports stay absent; a present null is invalid.
type CheckedLazyModule<M> = [InvalidLazyModuleExport<M>] extends [never] ? unknown : { readonly load?: never }
/** @since 0.2.0 */
export interface SelectorOptions<A> {
  readonly equals?: (left: A, right: A) => boolean
}
/** A reactive subscription with an optional projection. @since 0.2.0 */
export interface RouteHook<A> {
  <B>(select: (value: A) => B, options?: SelectorOptions<B>): Accessor<B>
  (): Accessor<A>
}
/** @since 0.1.0 */
export type SolidRoute<
  R extends Route.Any,
  C extends ReadonlyArray<RouteTree.Any> = readonly [],
  K extends RouteTree.Kind = RouteTree.Kind
> =
  & Omit<RouteTree.Node<R, C, K>, "addChildren">
  & Views
  & {
    readonly addChildren: <const Children extends ReadonlyArray<RouteTree.Any>>(
      children: Children
    ) => SolidRoute<R, Children, K>
    readonly useParams: RouteHook<Route.Route.Params<R>>
    readonly useSearch: RouteHook<Route.Route.Search<R>>
    readonly useLoaderData: RouteHook<Route.Route.LoaderData<R>>
    readonly useMatch: RouteHook<Router.ResolvedRoute<R>>
  }

const decorate = <R extends Route.Any, C extends ReadonlyArray<RouteTree.Any>, K extends RouteTree.Kind>(
  route: RouteTree.Node<R, C, K>,
  views: Views
): SolidRoute<R, C, K> => ({
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
} as SolidRoute<R, C, K>)

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
): SolidRoute<Route.Route<"__root__", "/", {}, S, H, M, ME, MR, D, E, R>, readonly [], "root"> {
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
): SolidRoute<
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
): SolidRoute<
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
/** @since 0.1.0 */
export type Destination<T extends RouteTree.Any = RegisteredTree> = RouteTree.Destination<T>
/** @since 0.1.0 */
export interface ClientRouter<T extends RouteTree.Any, E> {
  readonly routeTree: T
  /** The tree's shared compiled lookups, prepared once by root identity. @since 0.2.0 */
  readonly compiled: RouteTree.Compiled<RouteTree.All<T>>
  readonly core: Router.Router<ReadonlyArray<RouteTree.All<T>>, E>
  readonly href: (destination: Destination<T>) => Result.Result<string, Route.RouteEncodeError>
}

/** Builds the scoped runtime from native Effect application and History Layers. @since 0.1.0 */
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
  // The options require an application Layer whenever the tree requires services.
  const application = (options.layer ?? Layer.empty) as Layer.Layer<Route.Route.Services<RouteTree.All<T>>, E>
  // `Router.fromTree` compiles the same root; the WeakMap cache returns this object.
  const compiled = RouteTree.compile(options.routeTree)
  const core = Router.fromTree({ routeTree: options.routeTree, layer: Layer.merge(history, application) })
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
const RouterContext = createContext<RuntimeRouter>()
const SnapshotContext = createContext<"resolved" | "incoming">("resolved")
const DepthContext = createContext(0)
const DefaultPending: Component = () =>
  createComponent(Dynamic, { component: "div", role: "status", children: "Loading…" })
const DefaultNotFound: Component = () =>
  createComponent(Dynamic, { component: "div", role: "status", children: "Page not found" })
const DefaultError: Component<ErrorProps> = (props) =>
  createComponent(Dynamic, {
    component: "div",
    role: "alert",
    get children() {
      return [
        "Unable to display this route. ",
        createComponent(Dynamic, { component: "button", onClick: () => props.reset(), children: "Retry" })
      ]
    }
  })

/** @since 0.1.0 */
export function useRouter(): RegisteredRouter {
  const router = useContext(RouterContext)
  if (router === undefined) throw new Error("Router hooks require RouterProvider")
  return router as RegisteredRouter
}
const useRuntime = (): RuntimeRouter => useRouter() as RuntimeRouter
/** The selected navigation status, or a projection of it. @since 0.1.0 */
export function useRouterState<A>(
  select: (state: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): Accessor<A>
export function useRouterState(): Accessor<Atom.Type<RegisteredRouter["core"]["state"]>>
export function useRouterState<A = Atom.Type<RegisteredRouter["core"]["state"]>>(
  select?: (state: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): Accessor<A> {
  const { core } = useRuntime()
  const equals = options?.equals ?? Object.is
  const atom = Atom.map(
    core.state,
    (value) => select === undefined ? value as A : select(value as Atom.Type<RegisteredRouter["core"]["state"]>)
  ).pipe(Atom.withEquality<A>(equals))
  return useAtomValue(() => atom) as Accessor<A>
}
type RouteValues<R extends RouteTree.Any> = {
  readonly match: Router.ResolvedRoute<R>
  readonly params: Route.Route.Params<R>
  readonly search: Route.Route.Search<R>
  readonly loaderData: Route.Route.LoaderData<R>
}
function useRouteValue<R extends RouteTree.Any, K extends keyof RouteValues<R>, A = RouteValues<R>[K]>(
  route: R,
  key: K,
  select?: (value: RouteValues<R>[K]) => A,
  options?: SelectorOptions<A>
): Accessor<A> {
  const { core } = useRuntime()
  const mode = useContext(SnapshotContext)
  const atoms = core.routeAtoms(route)
  const equals = options?.equals ??
    (select === undefined && (key === "params" || key === "search") ? Equal.equals : Object.is)
  const selected = Atom.make((get) => {
    const resolved = get(atoms.resolved)
    const incoming = mode === "incoming" && (key === "params" || key === "search")
      ? get(atoms.incoming)
      : Option.none()
    // A failed incoming decode has no decoded input; it must not silently
    // present retained data. Only ordinary resolved-mode owners keep the
    // last snapshot (through the hold-last accessor below).
    const snapshot = Option.isSome(incoming)
      ? Result.isSuccess(incoming.value)
        ? incoming.value.success
        : undefined
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
  ))
  const value = useAtomValue(() => selected)
  let latest: A | undefined
  let settled = false
  return () => {
    const current = value()
    if (Option.isSome(current)) {
      latest = current.value
      settled = true
      return current.value
    }
    // Retain the last selected input while an exiting owner is being disposed, or
    // while this route refreshes. A newly mounted inactive route still fails on read.
    if (settled) return latest as A
    throw new Error(
      `Route ${route.id} has no ${key === "params" || key === "search" ? "decoded" : "resolved"} match in this branch`
    )
  }
}

/** @since 0.2.0 */
export type NavigationError = Effect.Error<ReturnType<RegisteredRouter["core"]["execute"]>>
/** The provider's registry is supplied; interruption cancels this operation's transition. @since 0.2.0 */
export function useNavigateEffect(): (destination: Destination) => Effect.Effect<void, NavigationError> {
  const router = useRuntime()
  const registry = useContext(RegistryContext)
  return (destination: Destination) =>
    Effect.suspend(() => {
      const { route, input } = router.compiled.target(destination)
      return router.core.execute(
        destination.replace
          ? Router.replace<RouteTree.Any>(route, input, destination.state)
          : Router.push<RouteTree.Any>(route, input, destination.state)
      ).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
    }) as Effect.Effect<void, NavigationError>
}
/** Awaits this transition's resolution and scoped cleanup. @since 0.1.0 */
export function useNavigate(): (
  destination: Destination,
  options?: { readonly signal?: AbortSignal }
) => Promise<void> {
  const navigate = useNavigateEffect()
  return (destination, options) => Effect.runPromise(navigate(destination), options)
}
/** Rebuilds failed initialization, or refreshes a healthy runtime. @since 0.2.0 */
function useRetry(): () => void {
  const { core } = useRuntime()
  const registry = useContext(RegistryContext)
  return () => {
    void Effect.runPromise(core.retry.pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))).catch(() => {})
  }
}

/** Owns a registry by default; caller-supplied registries remain caller-owned. @since 0.1.0 */
export function RouterProvider<T extends RouteTree.Any, E>(
  props: { readonly router: ClientRouter<T, E>; readonly registry?: AtomRegistry.AtomRegistry }
): JSX.Element {
  const content = () =>
    createComponent(Keyed<ClientRouter<T, E>>, {
      get when() {
        return props.router
      },
      children: (router: ClientRouter<T, E>) =>
        createComponent(RouterContext.Provider, {
          value: router as RuntimeRouter,
          get children() {
            return createComponent(RouterView, {})
          }
        })
    })
  return createComponent(Keyed<AtomRegistry.AtomRegistry>, {
    get when() {
      return props.registry
    },
    get fallback() {
      return createComponent(RegistryProvider, {
        get children() {
          return content()
        }
      })
    },
    children: (registry: AtomRegistry.AtomRegistry) =>
      createComponent(RegistryContext.Provider, {
        value: registry,
        get children() {
          return content()
        }
      })
  })
}

type Startup = { readonly _tag: "Active" | "Pending" } | { readonly _tag: "Failure"; readonly error: unknown }
function RouterView(): JSX.Element {
  const { core } = useRuntime()
  const registry = useContext(RegistryContext)
  onCleanup(registry.mount(core.navigate))
  const retry = useRetry()
  const startup = Atom.map(core.branch, (branch): Startup =>
    branch.matches.length > 0
      ? { _tag: "Active" }
      : branch.result._tag === "Failure"
      ? { _tag: "Failure", error: Cause.squash(branch.result.cause) }
      : { _tag: "Pending" }).pipe(
      Atom.withEquality<Startup>((left, right) =>
        left._tag === right._tag &&
        (left._tag !== "Failure" || (right._tag === "Failure" && Object.is(left.error, right.error)))
      )
    )
  const status = useAtomValue(() => startup)
  return createComponent(Keyed<string>, {
    get when() {
      return status()._tag
    },
    children: (tag: string) => {
      if (tag === "Active") {
        return createComponent(DepthContext.Provider, {
          value: 0,
          get children() {
            return createComponent(Outlet, {})
          }
        })
      }
      const root = core.routes[0] as RouteTree.Any & Views
      if (tag === "Failure") {
        const ErrorView = root.errorComponent ?? DefaultError
        return createComponent(SnapshotContext.Provider, {
          value: "incoming" as const,
          get children() {
            return createComponent(Dynamic, {
              component: ErrorView,
              get error() {
                const current = status()
                return current._tag === "Failure" ? current.error : undefined
              },
              reset: retry
            })
          }
        })
      }
      const Pending = root.pendingComponent ?? DefaultPending
      return createComponent(Pending, {})
    }
  })
}

const isSolidView = (value: unknown): value is Component => typeof value === "function"
// Selection stays total; the actionable failure surfaces inside the render boundary so the
// nearest errorComponent catches it with the route ID in the message.
const invalidSolidView = (routeId: string, value: unknown): Component =>
  function InvalidLazySolidView(): JSX.Element {
    throw new Error(
      `Route "${routeId}" selected a lazy module view that is not a Solid component (received ${
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value
      }). Export the page as the module 'default' or 'component' view.`
    )
  }

const declaresView = (route: Route.Any, kind: RenderPolicy.BoundaryKind): boolean =>
  (route as Views)[kind] !== undefined

interface Presentation {
  readonly selection: RenderPolicy.Selection
  readonly route: (Route.Any & Views) | undefined
  readonly module: unknown
  readonly recoveryKey: object | undefined
}

/** Renders the next match with stable route owners and native Solid boundaries. @since 0.1.0 */
export function Outlet(): JSX.Element {
  const depth = useContext(DepthContext)
  const { core } = useRuntime()
  const reset = useRetry()
  const presentation = Atom.map(core.branch, (branch): Presentation => {
    const selection = RenderPolicy.select(branch, depth, declaresView)
    const entry = branch.matches[depth]
    return {
      selection,
      route: entry?.route as (Route.Any & Views) | undefined,
      module: entry?.result._tag === "Success" ? entry.result.value.module : undefined,
      recoveryKey: entry === undefined ? undefined : RenderPolicy.recoveryKey(branch, entry.route.id)
    }
  }).pipe(
    Atom.withEquality<Presentation>((left, right) =>
      RenderPolicy.sameSelection(left.selection, right.selection) &&
      left.route === right.route && left.module === right.module && left.recoveryKey === right.recoveryKey
    )
  )
  const current = useAtomValue(() => presentation)
  const ownerKey = createMemo((): string | undefined => {
    const selection = current().selection
    if (selection._tag === "Empty") return undefined
    return selection._tag === "View" ? `${selection.routeId}:view` : `${selection.routeId}:boundary:${selection.kind}`
  })
  return createComponent(Keyed<string>, {
    get when() {
      return ownerKey()
    },
    children: (_key: string) => {
      const initial = untrack(current)
      const route = initial.route as Route.Any & Views
      const provideDepth = (children: () => JSX.Element) =>
        createComponent(DepthContext.Provider, {
          value: depth + 1,
          get children() {
            return children()
          }
        })
      // Loader, pending, and not-found boundaries render their fallback directly,
      // bypassing latched render errors through the shared presentation policy.
      if (initial.selection._tag === "Boundary") {
        const kind = initial.selection.kind
        if (kind === "errorComponent") {
          const ErrorView = route.errorComponent ?? DefaultError
          return provideDepth(() =>
            createComponent(SnapshotContext.Provider, {
              value: "incoming" as const,
              get children() {
                return createComponent(Dynamic, {
                  component: ErrorView,
                  get error() {
                    const selection = current().selection
                    return selection._tag === "Boundary" ? selection.error : undefined
                  },
                  reset
                })
              }
            })
          )
        }
        const Fallback = kind === "pendingComponent"
          ? route.pendingComponent ?? DefaultPending
          : route.notFoundComponent ?? DefaultNotFound
        return provideDepth(() =>
          createComponent(SnapshotContext.Provider, {
            value: "incoming" as const,
            get children() {
              return createComponent(Fallback, {})
            }
          })
        )
      }
      const view = createMemo((): Component => {
        const snapshot = current()
        const lazy = snapshot.module as { readonly default?: unknown; readonly component?: unknown } | undefined
        const selected: unknown = snapshot.route?.component !== undefined ?
          snapshot.route.component
          : lazy?.component !== undefined ?
          lazy.component
          : lazy?.default !== undefined ?
          lazy.default
          : Outlet
        return isSolidView(selected) ? selected : invalidSolidView(snapshot.route?.id ?? "unknown", selected)
      })
      const contentView = () =>
        createComponent(Dynamic, {
          get component() {
            return view()
          }
        })
      const viewContent = () =>
        createComponent(SnapshotContext.Provider, {
          value: "resolved" as const,
          get children() {
            return contentView()
          }
        })
      // Branch boundaries replace a latched render error and bubble their own
      // rendering failures to an ancestor, just like ordinary route components.
      if (route.errorComponent === undefined && depth !== 0) return provideDepth(viewContent)
      let clearLatch: (() => void) | undefined
      let recovery = untrack(() => current().recoveryKey)
      createEffect(() => {
        const next = current().recoveryKey
        if (next === recovery) return
        recovery = next
        // A latched render error clears only after a successful completed transition
        // includes this boundary's route, never from the reset callback directly.
        untrack(() => clearLatch?.())
      })
      return provideDepth(() =>
        createComponent(ErrorBoundary, {
          fallback: (error: unknown, clear: () => void) => {
            clearLatch = clear
            return createComponent(SnapshotContext.Provider, {
              value: "incoming" as const,
              get children() {
                return createComponent(route.errorComponent ?? DefaultError, { error, reset })
              }
            })
          },
          get children() {
            return viewContent()
          }
        })
      )
    }
  })
}

/** @since 0.1.0 */
export type LinkProps = Destination & Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  readonly exact?: boolean
}

/** A reactive real anchor with the shared typed destination model. @since 0.1.0 */
export function Link(props: LinkProps): JSX.Element {
  const router = useRuntime()
  const navigate = useNavigate()
  const locationAtom = Atom.map(router.core.branch, (branch) => branch.location)
  const location = useAtomValue(() => locationAtom)
  const [local, anchor] = splitProps(props, ["to", "params", "search", "hash", "replace", "state", "exact", "onClick"])
  const href = createMemo(() => {
    const { route, input } = router.compiled.target(local)
    const encoded = Route.href(route, input)
    if (Result.isFailure(encoded)) throw encoded.failure
    return encoded.success
  })
  const active = createMemo(() => {
    const current = location()
    if (Option.isNone(current)) return false
    const pathname = href().split(/[?#]/)[0]
    return current.value.pathname === pathname ||
      (!local.exact && pathname !== "/" && current.value.pathname.startsWith(`${pathname}/`))
  })
  const onClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    const handler = local.onClick
    if (typeof handler === "function") handler(event)
    else if (handler !== undefined) handler[0](handler[1], event)
    if (
      event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey ||
      event.altKey || (event.currentTarget.target !== "" && event.currentTarget.target !== "_self") ||
      event.currentTarget.hasAttribute("download")
    ) return
    event.preventDefault()
    // Router state already renders operation failures; the anchor consumes the rejection.
    navigate(local as Destination).catch(() => {})
  }
  return createComponent(
    Dynamic,
    mergeProps(anchor, {
      component: "a" as const,
      get href() {
        return href()
      },
      get "aria-current"() {
        return active() ? "page" as const : undefined
      },
      get "data-active"() {
        return active() ? "true" : undefined
      },
      onClick
    })
  )
}

/** Navigates on mount or when the tracked destination or state changes. @since 0.1.0 */
export function Navigate(props: Destination): JSX.Element {
  const router = useRuntime()
  const navigate = useNavigate()
  const registry = useContext(RegistryContext)
  let previous: RenderPolicy.NavigationIntent | undefined
  createEffect(() => {
    const result = router.href(props)
    if (Result.isFailure(result)) throw result.failure
    const intent: RenderPolicy.NavigationIntent = {
      href: result.success,
      replace: props.replace === true,
      state: props.state
    }
    if (RenderPolicy.sameIntent(previous, intent)) return
    previous = intent
    // Keep explicit history-state updates observable while pending fallbacks remount
    // this component after its URL is already satisfied.
    if (RenderPolicy.isSatisfied(intent, registry.get(router.core.branch).location)) return
    navigate(props).catch(() => {})
  })
  return undefined
}
