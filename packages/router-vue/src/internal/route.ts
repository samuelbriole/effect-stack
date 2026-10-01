import { makeDefinitionEngine } from "@effect-stack/router/Adapter"
import type * as Router from "@effect-stack/router/Router"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import { defineComponent } from "vue"
import type { Component, VNodeChild } from "vue"

/** @since 0.4.0 */
export interface ViewFailureProps<E = unknown> {
  readonly failure: Router.ViewFailure<E>
  readonly retry: () => void
}
/** @since 0.4.0 */
export type RenderFn = () => VNodeChild
/** @since 0.4.0 */
export type ErrorRender<E> = Component | ((props: ViewFailureProps<E>) => VNodeChild)
/** @since 0.4.0 */
export interface ResolvedViewOptions {
  readonly render?: RenderFn
  readonly component?: Component
  readonly error?: Component
}
/** Native presentation and optional direct transition gate. @since 0.4.0 */
export interface DirectOptions<
  P extends Router.UrlSchemaFields = {},
  S extends Router.UrlSchemaFields = {},
  H extends Router.UrlSchema | undefined = undefined,
  E = never,
  R = never,
  I = Router.DecodedRouteInput<P, S, H>
> {
  readonly params?: P
  readonly search?: S
  readonly hash?: H
  readonly prepare?: (input: I) => Effect.Effect<void, E, R>
  readonly render?: RenderFn
  readonly component?: Component
  readonly error?: ErrorRender<Exclude<E, Router.Redirect<unknown>>>
  readonly empty?: boolean
}
/** @since 0.4.0 */
export type PresentationOptions<
  P extends Router.UrlSchemaFields = {},
  S extends Router.UrlSchemaFields = {},
  H extends Router.UrlSchema | undefined = undefined,
  I = Router.DecodedRouteInput<P, S, H>
> = DirectOptions<P, S, H, never, never, I>
/** @since 0.4.0 */
export type EmptyOptions<
  P extends Router.UrlSchemaFields = {},
  S extends Router.UrlSchemaFields = {},
  H extends Router.UrlSchema | undefined = undefined
> = DirectOptions<P, S, H> & { readonly empty: true }
/** Parent-aware native layout. @since 0.4.0 */
export type NestedLayout<
  N extends Router.AnyNodeInfo,
  Parent = undefined,
  E = never,
  R = never
> = Router.LayoutDefinition<N, Parent, E, R> & {
  route<
    const Name extends string,
    const Path extends `/${string}`,
    P extends Router.UrlSchemaFields = {},
    S extends Router.UrlSchemaFields = {},
    H extends Router.UrlSchema | undefined = undefined,
    E2 = never,
    R2 = never
  >(
    name: Name,
    path: Path,
    options: DirectOptions<
      P,
      S,
      H,
      E2,
      R2,
      Router.DecodedRouteInput<N["params"] & P, N["search"] & S, Router.InheritedHash<N["hash"], H>>
    >
  ): Router.RouteDefinition<
    Router.ChildInfo<NestedLayout<N, Parent, E, R>, Name, Path, P, S, H>,
    NestedLayout<N, Parent, E, R>,
    Exclude<E2, Router.Redirect<unknown>>,
    Exclude<R2, Scope.Scope>
  >
  layout<
    const Name extends string,
    const Path extends `/${string}`,
    P extends Router.UrlSchemaFields = {},
    S extends Router.UrlSchemaFields = {},
    H extends Router.UrlSchema | undefined = undefined,
    E2 = never,
    R2 = never
  >(
    name: Name,
    path: Path,
    options?: DirectOptions<
      P,
      S,
      H,
      E2,
      R2,
      Router.DecodedRouteInput<N["params"] & P, N["search"] & S, Router.InheritedHash<N["hash"], H>>
    >
  ): NestedLayout<
    Router.ChildInfo<NestedLayout<N, Parent, E, R>, Name, Path, P, S, H, "layout">,
    NestedLayout<N, Parent, E, R>,
    Exclude<E2, Router.Redirect<unknown>>,
    Exclude<R2, Scope.Scope>
  >
  index<
    S extends Router.UrlSchemaFields = {},
    H extends Router.UrlSchema | undefined = undefined,
    E2 = never,
    R2 = never
  >(
    options: Omit<
      DirectOptions<
        {},
        S,
        H,
        E2,
        R2,
        Router.DecodedRouteInput<N["params"], N["search"] & S, Router.InheritedHash<N["hash"], H>>
      >,
      "params"
    >
  ): Router.RouteDefinition<
    Router.IndexInfo<NestedLayout<N, Parent, E, R>, S, H>,
    NestedLayout<N, Parent, E, R>,
    Exclude<E2, Router.Redirect<unknown>>,
    Exclude<R2, Scope.Scope>
  >
}
/** @since 0.4.0 */
export type Layout<N extends Router.AnyNodeInfo, E = never, R = never> = NestedLayout<N, undefined, E, R>
/** @since 0.4.0 */
export interface RouteConstructor {
  <
    const Name extends string,
    const Path extends `/${string}`,
    P extends Router.UrlSchemaFields = {},
    S extends Router.UrlSchemaFields = {},
    H extends Router.UrlSchema | undefined = undefined,
    E = never,
    R = never
  >(
    name: Name,
    path: Path,
    options?: DirectOptions<P, S, H, E, R>
  ): Router.RouteDefinition<
    Router.NodeInfo<Name, Path, P, S, H>,
    undefined,
    Exclude<E, Router.Redirect<unknown>>,
    Exclude<R, Scope.Scope>
  >
}
/** @since 0.4.0 */
export interface LayoutConstructor {
  <
    const Name extends string,
    const Path extends `/${string}`,
    P extends Router.UrlSchemaFields = {},
    S extends Router.UrlSchemaFields = {},
    H extends Router.UrlSchema | undefined = undefined,
    E = never,
    R = never
  >(
    name: Name,
    path: Path,
    options?: DirectOptions<P, S, H, E, R>
  ): Layout<
    Router.NodeInfo<Name, Path, P, S, H, "layout">,
    Exclude<E, Router.Redirect<unknown>>,
    Exclude<R, Scope.Scope>
  >
}
const isComponent = (value: unknown): value is Component =>
  typeof value === "function" || (typeof value === "object" && value !== null)
const normalize = (options: unknown): ResolvedViewOptions => {
  const value = (options ?? {}) as Record<string, unknown>
  const boundary = (component: Component): Component =>
    typeof component === "function"
      ? defineComponent({
          props: ["failure", "retry"],
          setup: (props) => () => (component as (props: Record<string, unknown>) => VNodeChild)(props)
        })
      : component
  return {
    ...(typeof value.render === "function" ? { render: value.render as RenderFn } : {}),
    ...(isComponent(value.component) ? { component: value.component } : {}),
    ...(isComponent(value.error) ? { error: boundary(value.error) } : {})
  }
}
/** @since 0.4.0 */
export const engine = makeDefinitionEngine({
  renderer: "@effect-stack/router-vue",
  normalize,
  isEmpty: (value) => value.component === undefined && value.render === undefined
})
/** @since 0.4.0 */
export const route = ((name: string, path: string, options?: unknown) =>
  engine.route(undefined, name, path, options)) as RouteConstructor
/** @since 0.4.0 */
export const layout = ((name: string, path: string, options?: unknown) =>
  engine.layout(undefined, name, path, options)) as LayoutConstructor
/** @since 0.4.0 */
export type PathTarget<Routes, P extends Router.PathsOf<Routes>> = Router.PathTarget<Routes, P>
/** @since 0.4.0 */
export type PathTargets<Routes> = Router.PathTargets<Routes>
/** @since 0.4.0 */
export type NavigateTarget<Routes> = Router.NavigateTarget<Routes>
/** @since 0.4.0 */
export type LinkProps<Routes> = ({ readonly to: Router.DestinationOf<Routes> } | PathTargets<Routes>)
  & Record<string, unknown>
/** @since 0.4.0 */
export type NavigateProps<Routes> = ({ readonly to: Router.DestinationOf<Routes> } | PathTargets<Routes>) & {
  readonly replace?: boolean
  readonly state?: unknown
}
