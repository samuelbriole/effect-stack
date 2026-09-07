/** First-party client-side Solid routing. @since 0.1.0 */
import { BrowserHistory, type History, Route, Router, RouteTree } from "@effect-stack/router"
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-solid"
import { Cause, type Effect, Layer, Result, type Schema } from "effect"
import type { Atom, AtomRegistry } from "effect/unstable/reactivity"
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
    readonly useParams: () => Accessor<Route.Route.Params<R>>
    readonly useSearch: () => Accessor<Route.Route.Search<R>>
    readonly useLoaderData: () => Accessor<Route.Route.LoaderData<R>>
    readonly useMatch: () => Accessor<Router.ResolvedRoute<R>>
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
  addChildren: (children) => decorate(route.addChildren(children), views),
  useMatch: () => useMatch<R>(route),
  useParams: () => {
    const match = useMatch<R>(route)
    return () => match().params
  },
  useSearch: () => {
    const match = useMatch<R>(route)
    return () => match().search
  },
  useLoaderData: () => {
    const match = useMatch<R>(route)
    return () => match().loaderData
  }
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
  options: Views & { readonly search?: S; readonly hash?: H } & RouteTree.Loading<{}, S, H, M, ME, MR, D, E, R> = {}
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
  options: Views & {
    readonly getParentRoute: () => Parent
    readonly id: Id
    readonly path?: never
    readonly search?: S
    readonly hash?: H
  } & RouteTree.Loading<Parent["paramsSchema"]["fields"], Parent["searchSchema"]["fields"] & S, H, M, ME, MR, D, E, R>
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
  options: Views & RouteTree.Options<Parent, Path, P, S, H, M, ME, MR, D, E, R>
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
  const core = Router.fromTree({ routeTree: options.routeTree, layer: Layer.merge(history, application) })
  return {
    routeTree: options.routeTree,
    core,
    href: (destination) => {
      const { route, input } = RouteTree.target(core.routes, destination)
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
const BranchContext = createContext<Accessor<Router.Branch>>(() => ({ matches: [], notFound: false }))
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
/** @since 0.1.0 */
export function useRouterState(): Accessor<Atom.Type<RegisteredRouter["core"]["state"]>> {
  const { core } = useRuntime()
  return useAtomValue(() => core.state) as Accessor<Atom.Type<RegisteredRouter["core"]["state"]>>
}
function useMatch<R extends Route.Any>(route: R): Accessor<Router.ResolvedRoute<R>> {
  useRuntime()
  const branch = useContext(BranchContext)
  const initial = untrack(branch).matches.find((entry) => entry.route.id === route.id)
  if (initial?.result._tag !== "Success") throw new Error(`Route ${route.id} has no resolved match in this branch`)
  let previous = initial.result.value
  // Retain the last resolved input while an exiting owner is being disposed, or
  // while this route refreshes. A newly mounted inactive route still fails above.
  return () => {
    const match = branch().matches.find((entry) => entry.route.id === route.id)
    if (match?.result._tag === "Success") previous = match.result.value
    return previous as Router.ResolvedRoute<R>
  }
}

/** @since 0.1.0 */
export function useNavigate(): (destination: Destination) => void {
  const { core } = useRuntime()
  const registry = useContext(RegistryContext)
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

function RouterView(): JSX.Element {
  const { core } = useRuntime()
  const registry = useContext(RegistryContext)
  onCleanup(registry.mount(core.navigate))
  const branch = useAtomValue(() => core.branch)
  const state = useAtomValue(() => core.state)
  const root = core.routes[0] as RouteTree.Any & Views
  const startup = () =>
    createComponent(Dynamic, {
      get component() {
        return state()._tag === "Failure"
          ? root.errorComponent ?? DefaultError
          : root.pendingComponent ?? DefaultPending
      },
      get error() {
        const result = state()
        return result._tag === "Failure" ? Cause.squash(result.cause) : undefined
      },
      reset: () => registry.set(core.navigate, Router.refresh)
    })
  return createComponent(BranchContext.Provider, {
    value: branch,
    get children() {
      return createComponent(Keyed<boolean>, {
        get when() {
          return branch().matches.length > 0
        },
        get fallback() {
          return startup()
        },
        children: (_present: boolean) =>
          createComponent(DepthContext.Provider, {
            value: 0,
            get children() {
              return createComponent(Outlet, {})
            }
          })
      })
    }
  })
}

type BoundaryKind = "errorComponent" | "pendingComponent" | "notFoundComponent"
interface Selection {
  readonly boundary: boolean
  readonly route: Route.Any & Views
  readonly component: Component<ErrorProps>
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
      boundary: true,
      route,
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
    boundary: false,
    route,
    component: route.component ?? module?.component ?? module?.default ?? Outlet,
    error: undefined
  }
}

/** Renders the next match with stable route owners and native Solid boundaries. @since 0.1.0 */
export function Outlet(): JSX.Element {
  const branch = useContext(BranchContext)
  const depth = useContext(DepthContext)
  const { core } = useRuntime()
  const registry = useContext(RegistryContext)
  const selection = createMemo(() => select(branch(), depth))
  const refresh = () => registry.set(core.navigate, Router.refresh)
  return createComponent(Keyed<string>, {
    get when() {
      const selected = selection()
      return selected === undefined ? undefined : `${selected.route.id}:${selected.boundary}`
    },
    children: (_key: string) => {
      const initial = untrack(selection)
      if (initial === undefined) return undefined
      const view = () =>
        createComponent(Dynamic, {
          get component() {
            return selection()?.component ?? initial.component
          },
          get error() {
            return selection()?.error
          },
          reset: refresh
        })
      const provideDepth = (children: () => JSX.Element) =>
        createComponent(DepthContext.Provider, {
          value: depth + 1,
          get children() {
            return children()
          }
        })
      // Branch boundaries replace a latched render error and bubble their own
      // rendering failures to an ancestor, just like ordinary route components.
      if (initial.boundary || (initial.route.errorComponent === undefined && depth !== 0)) return provideDepth(view)
      let resetBoundary: (() => void) | undefined
      let locationKey: string | undefined
      createEffect(() => {
        const match = branch().matches.find((entry) => entry.route.id === initial.route.id)?.result
        if (match?._tag !== "Success") return
        const next = match.value.location.key
        const changed = locationKey !== undefined && next !== locationKey
        locationKey = next
        if (changed) untrack(() => resetBoundary?.())
      })
      return provideDepth(() =>
        createComponent(ErrorBoundary, {
          fallback: (error: unknown, reset: () => void) => {
            resetBoundary = reset
            return createComponent(initial.route.errorComponent ?? DefaultError, {
              error,
              reset: () => {
                reset()
                refresh()
              }
            })
          },
          get children() {
            return view()
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
  const current = useRouterState()
  const [local, anchor] = splitProps(props, ["to", "params", "search", "hash", "replace", "state", "exact", "onClick"])
  const href = createMemo(() => {
    const { route, input } = RouteTree.target(router.core.routes, local)
    const encoded = Route.href(route, input)
    if (Result.isFailure(encoded)) throw encoded.failure
    return encoded.success
  })
  const active = createMemo(() => {
    const state = current()
    const pathname = href().split(/[?#]/)[0]
    return state._tag === "Success" &&
      (state.value.location.pathname === pathname ||
        (!local.exact && pathname !== "/" && state.value.location.pathname.startsWith(`${pathname}/`)))
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
    navigate(local as Destination)
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

/** Navigates on mount or when the encoded destination changes. @since 0.1.0 */
export function Navigate(props: Destination): JSX.Element {
  const router = useRuntime()
  const navigate = useNavigate()
  const branch = useContext(BranchContext)
  let previous: string | undefined
  createEffect(() => {
    const result = router.href(props)
    if (Result.isFailure(result)) throw result.failure
    const key = `${props.replace === true ? "replace" : "push"}:${result.success}`
    if (key === previous) return
    previous = key
    untrack(() => {
      // Pending views can remount this component after its URL is satisfied.
      // Keep explicit same-URL history-state updates observable.
      // Solid renders synchronously from the branch publication, before the
      // derived leaf-state Atom necessarily publishes its new value.
      const match = branch().matches.find((entry) => entry.result._tag === "Success")?.result
      if (props.state === undefined && match?._tag === "Success") {
        const location = match.value.location
        if (`${location.pathname}${location.search}${location.hash}` === result.success) return
      }
      navigate(props)
    })
  })
  return undefined
}
