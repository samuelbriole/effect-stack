import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type {
  AnyNodeInfo,
  ChildInfo,
  DecodedRouteInput,
  IndexInfo,
  InheritedHash,
  LayoutDefinition,
  NodeInfo,
  RouteDefinition,
  UrlSchema,
  UrlSchemaFields,
  Fields
} from "./definition.ts"
import type { RedirectSignal } from "./redirect.ts"

/** URL schemas and an optional direct transition gate. @since 0.4.0 */
export interface Options<
  P extends UrlSchemaFields = {},
  S extends UrlSchemaFields = {},
  H extends UrlSchema | undefined = undefined,
  E = never,
  R = never,
  Input = DecodedRouteInput<P, S, H>
> {
  readonly params?: P
  readonly search?: S
  readonly hash?: H
  readonly prepare?: (input: Input) => Effect.Effect<void, E, R>
}

/** Index endpoints inherit all path params. @since 0.4.0 */
export type IndexOptions<
  P extends Fields = {},
  S extends UrlSchemaFields = {},
  H extends UrlSchema | undefined = undefined,
  E = never,
  R = never,
  InheritedSearch extends Fields = {},
  ParentHash extends AnyNodeInfo["hash"] = undefined
> = Omit<Options<{}, S, H, E, R, DecodedRouteInput<P, InheritedSearch & S, InheritedHash<ParentHash, H>>>, "params">

/** Parent-aware headless layout. @since 0.4.0 */
export type NestedLayout<N extends AnyNodeInfo, Parent = undefined, E = never, R = never> = LayoutDefinition<
  N,
  Parent,
  E,
  R
> & {
  route<
    const Name extends string,
    const Path extends `/${string}`,
    P extends UrlSchemaFields = {},
    S extends UrlSchemaFields = {},
    H extends UrlSchema | undefined = undefined,
    E2 = never,
    R2 = never
  >(
    name: Name,
    path: Path,
    options?: Options<P, S, H, E2, R2, DecodedRouteInput<N["params"] & P, N["search"] & S, InheritedHash<N["hash"], H>>>
      & (NoInfer<Path> extends "/" ? { readonly params?: never } : unknown)
  ): RouteDefinition<
    ChildInfo<NestedLayout<N, Parent, E, R>, Name, Path, P, S, H>,
    NestedLayout<N, Parent, E, R>,
    Exclude<E2, RedirectSignal>,
    Exclude<R2, Scope.Scope>
  >
  layout<
    const Name extends string,
    const Path extends `/${string}`,
    P extends UrlSchemaFields = {},
    S extends UrlSchemaFields = {},
    H extends UrlSchema | undefined = undefined,
    E2 = never,
    R2 = never
  >(
    name: Name,
    path: Path,
    options?: Options<P, S, H, E2, R2, DecodedRouteInput<N["params"] & P, N["search"] & S, InheritedHash<N["hash"], H>>>
  ): NestedLayout<
    ChildInfo<NestedLayout<N, Parent, E, R>, Name, Path, P, S, H, "layout">,
    NestedLayout<N, Parent, E, R>,
    Exclude<E2, RedirectSignal>,
    Exclude<R2, Scope.Scope>
  >
  index<S extends UrlSchemaFields = {}, H extends UrlSchema | undefined = undefined, E2 = never, R2 = never>(
    options?: IndexOptions<N["params"], S, H, E2, R2, N["search"], N["hash"]>
  ): RouteDefinition<
    IndexInfo<NestedLayout<N, Parent, E, R>, S, H>,
    NestedLayout<N, Parent, E, R>,
    Exclude<E2, RedirectSignal>,
    Exclude<R2, Scope.Scope>
  >
}

/** Headless endpoint constructor. @since 0.4.0 */
export interface RouteConstructor {
  <
    const Name extends string,
    const Path extends `/${string}`,
    P extends UrlSchemaFields = {},
    S extends UrlSchemaFields = {},
    H extends UrlSchema | undefined = undefined,
    E = never,
    R = never
  >(
    name: Name,
    path: Path,
    options?: Options<P, S, H, E, R>
  ): RouteDefinition<NodeInfo<Name, Path, P, S, H>, undefined, Exclude<E, RedirectSignal>, Exclude<R, Scope.Scope>>
}

/** Headless layout constructor. @since 0.4.0 */
export interface LayoutConstructor {
  <
    const Name extends string,
    const Path extends `/${string}`,
    P extends UrlSchemaFields = {},
    S extends UrlSchemaFields = {},
    H extends UrlSchema | undefined = undefined,
    E = never,
    R = never
  >(
    name: Name,
    path: Path,
    options?: Options<P, S, H, E, R>
  ): NestedLayout<
    NodeInfo<Name, Path, P, S, H, "layout">,
    undefined,
    Exclude<E, RedirectSignal>,
    Exclude<R, Scope.Scope>
  >
}
