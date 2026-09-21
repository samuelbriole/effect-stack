import { type Route, type Router, RouteTree } from "@effect-stack/router"
import type { Effect, Schema } from "effect"
import type { Component } from "vue"
import { routeHook, type VueRouteHook } from "./hooks.ts"

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
// Modules without `default`/`component` keep the Outlet fallback. This check is stricter than
// `RouteTree.CheckedLazyModule` because Vue option objects match `Component` structurally.
type CheckedLazyModule<M> = [InvalidLazyModuleExport<M>] extends [never] ? unknown
  : { readonly lazy?: never }
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
    readonly lazy?: () => Effect.Effect<unknown, unknown, unknown>
    readonly loader?: (input: never) => Effect.Effect<unknown, unknown, unknown>
  }
): unknown {
  const construct = RouteTree.make as unknown as (input: typeof options) => RouteTree.Node<Route.Any>
  return decorate(construct(options), options)
}
