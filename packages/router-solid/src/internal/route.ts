import { type Route, type Router, RouteTree } from "@effect-stack/router"
import type { Effect, Schema } from "effect"
import type { Component } from "solid-js"
import { type RouteHook, type SelectorOptions, useRouteValue } from "./hooks.ts"

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

// A lazy module may carry renderer-neutral data, but a present view export must be a Solid component.
// Optional undefined exports stay absent; a present null is invalid. Distribution over module
// unions keeps one invalid member from hiding behind another member that merely lacks the view keys.
type CheckedLazyModule<M> = RouteTree.CheckedLazyModule<M, SolidModuleView>
/** @since 0.1.0 */
export type SolidRoute<
  R extends Route.Any,
  C extends ReadonlyArray<RouteTree.Any> = readonly [],
  K extends RouteTree.Kind = RouteTree.Kind
> = Omit<RouteTree.Node<R, C, K>, "addChildren">
  & Views & {
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
): SolidRoute<R, C, K> =>
  ({
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
    useParams: <A = Route.Route.Params<R>>(
      select?: (value: Route.Route.Params<R>) => A,
      options?: SelectorOptions<A>
    ) => useRouteValue(route, "params", select, options),
    useSearch: <A = Route.Route.Search<R>>(
      select?: (value: Route.Route.Search<R>) => A,
      options?: SelectorOptions<A>
    ) => useRouteValue(route, "search", select, options),
    useLoaderData: <A = Route.Route.LoaderData<R>>(
      select?: (value: Route.Route.LoaderData<R>) => A,
      options?: SelectorOptions<A>
    ) => useRouteValue(route, "loaderData", select, options)
  }) as SolidRoute<R, C, K>

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
  options: Views & { readonly search?: S; readonly hash?: H } & RouteTree.Loading<{}, S, H, M, ME, MR, D, E, R>
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
  options: Views & {
    readonly getParentRoute: () => Parent
    readonly id: Id
    readonly path?: never
    readonly search?: S
    readonly hash?: H
  } & RouteTree.Loading<Parent["paramsSchema"]["fields"], Parent["searchSchema"]["fields"] & S, H, M, ME, MR, D, E, R>
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
    readonly lazy?: () => Effect.Effect<unknown, unknown, unknown>
    readonly loader?: (input: never) => Effect.Effect<unknown, unknown, unknown>
  }
): unknown {
  // Public overloads enforce the exclusive path/ID shape before this erased bridge.
  const construct = RouteTree.make as unknown as (input: typeof options) => RouteTree.Node<Route.Any>
  return decorate(construct(options), options)
}
