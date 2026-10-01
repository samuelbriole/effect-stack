import * as Adapter from "@effect-stack/router/Adapter"
import type * as Router from "@effect-stack/router/Router"
import type * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Diagnostic } from "./state.ts"

/** Restored domain failures or serializable diagnostic information. @since 0.1.0 */
export type ViewFailure<E> =
  | { readonly _tag: "Domain"; readonly error: E }
  | { readonly _tag: "Diagnostic"; readonly diagnostic: Diagnostic }

/** Pure native rendering context. @since 0.1.0 */
export interface ViewContext<Model, Message, Input> {
  readonly model: Model
  readonly h: HtmlBuilder<Message>
  readonly input: Input
  readonly outlet: () => Html
}
/** @since 0.1.0 */
export interface ErrorViewContext<Model, Message, E> {
  readonly model: Model
  readonly h: HtmlBuilder<Message>
  readonly failure: ViewFailure<E>
  readonly retry: Message
}
/** @since 0.1.0 */
export type View<Model, Message, Input> = (context: ViewContext<Model, Message, Input>) => Html
/** @since 0.1.0 */
export type ErrorView<Model, Message, E> = (context: ErrorViewContext<Model, Message, E>) => Html
/** Context-free codec for persisting and restoring a domain failure. @since 0.1.0 */
export type ErrorCodec<E> = Schema.Top & Schema.ConstraintCodec<E, unknown, never, never>
/** Normalized presentation owned by one constructor engine. @since 0.1.0 */
export interface ResolvedViewOptions<Model, Message> {
  readonly render?: View<Model, Message, unknown>
  readonly error?: ErrorView<Model, Message, unknown>
  readonly errorSchema?: ErrorCodec<unknown>
  readonly empty?: boolean
}
/** Native presentation, URL schemas, and optional direct gate. @since 0.1.0 */
export interface DirectOptions<
  Model,
  Message,
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
  readonly render?: View<Model, Message, I>
  readonly error?: ErrorView<Model, Message, NoInfer<Exclude<E, Router.Redirect<unknown>>>>
  readonly errorSchema?: ErrorCodec<NoInfer<Exclude<E, Router.Redirect<unknown>>>>
  readonly empty?: boolean
}
/** @since 0.1.0 */
export type PresentationOptions<
  Model,
  Message,
  P extends Router.UrlSchemaFields = {},
  S extends Router.UrlSchemaFields = {},
  H extends Router.UrlSchema | undefined = undefined,
  I = Router.DecodedRouteInput<P, S, H>
> = DirectOptions<Model, Message, P, S, H, never, never, I>
/** @since 0.1.0 */
export type EmptyOptions<
  Model,
  Message,
  P extends Router.UrlSchemaFields = {},
  S extends Router.UrlSchemaFields = {},
  H extends Router.UrlSchema | undefined = undefined
> = DirectOptions<Model, Message, P, S, H> & { readonly empty: true }

declare const Universe: unique symbol
/** Keeps definitions from incompatible native Model/Message universes separate. @since 0.1.0 */
export interface NativeDefinition<Model, Message> {
  readonly [Universe]: (model: Model, message: Message) => readonly [Model, Message]
}
/** @since 0.1.0 */
export type Route<
  Model,
  Message,
  N extends Router.AnyNodeInfo,
  Parent = undefined,
  E = never,
  R = never
> = Router.RouteDefinition<N, Parent, E, R> & NativeDefinition<Model, Message>
/** Parent-aware native layout. @since 0.1.0 */
export type NestedLayout<
  Model,
  Message,
  N extends Router.AnyNodeInfo,
  Parent = undefined,
  E = never,
  R = never
> = Router.LayoutDefinition<N, Parent, E, R>
  & NativeDefinition<Model, Message> & {
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
        Model,
        Message,
        P,
        S,
        H,
        E2,
        R2,
        Router.DecodedRouteInput<N["params"] & P, N["search"] & S, Router.InheritedHash<N["hash"], H>>
      >
    ): Route<
      Model,
      Message,
      Router.ChildInfo<NestedLayout<Model, Message, N, Parent, E, R>, Name, Path, P, S, H>,
      NestedLayout<Model, Message, N, Parent, E, R>,
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
        Model,
        Message,
        P,
        S,
        H,
        E2,
        R2,
        Router.DecodedRouteInput<N["params"] & P, N["search"] & S, Router.InheritedHash<N["hash"], H>>
      >
    ): NestedLayout<
      Model,
      Message,
      Router.ChildInfo<NestedLayout<Model, Message, N, Parent, E, R>, Name, Path, P, S, H, "layout">,
      NestedLayout<Model, Message, N, Parent, E, R>,
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
          Model,
          Message,
          {},
          S,
          H,
          E2,
          R2,
          Router.DecodedRouteInput<N["params"], N["search"] & S, Router.InheritedHash<N["hash"], H>>
        >,
        "params"
      >
    ): Route<
      Model,
      Message,
      Router.IndexInfo<NestedLayout<Model, Message, N, Parent, E, R>, S, H>,
      NestedLayout<Model, Message, N, Parent, E, R>,
      Exclude<E2, Router.Redirect<unknown>>,
      Exclude<R2, Scope.Scope>
    >
  }
/** @since 0.1.0 */
export type Layout<Model, Message, N extends Router.AnyNodeInfo, E = never, R = never> = NestedLayout<
  Model,
  Message,
  N,
  undefined,
  E,
  R
>
/** @since 0.1.0 */
export interface RouteConstructor<Model, Message> {
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
    options?: DirectOptions<Model, Message, P, S, H, E, R>
  ): Route<
    Model,
    Message,
    Router.NodeInfo<Name, Path, P, S, H>,
    undefined,
    Exclude<E, Router.Redirect<unknown>>,
    Exclude<R, Scope.Scope>
  >
}
/** @since 0.1.0 */
export interface LayoutConstructor<Model, Message> {
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
    options?: DirectOptions<Model, Message, P, S, H, E, R>
  ): Layout<
    Model,
    Message,
    Router.NodeInfo<Name, Path, P, S, H, "layout">,
    Exclude<E, Router.Redirect<unknown>>,
    Exclude<R, Scope.Scope>
  >
}

/** Fresh ownership capability for each native adapter instance. @since 0.1.0 */
export const makeRouteConstructors = <Model, Message>(): {
  readonly engine: Adapter.DefinitionEngine<ResolvedViewOptions<Model, Message>>
  readonly route: RouteConstructor<Model, Message>
  readonly layout: LayoutConstructor<Model, Message>
} => {
  const engine = Adapter.makeDefinitionEngine<ResolvedViewOptions<Model, Message>>({
    renderer: "@effect-stack/router-foldkit",
    normalize: (options) => {
      const value = (options ?? {}) as Record<string, unknown>
      return {
        ...(typeof value.render === "function" ? { render: value.render as View<Model, Message, unknown> } : {}),
        ...(typeof value.error === "function" ? { error: value.error as ErrorView<Model, Message, unknown> } : {}),
        ...(value.errorSchema === undefined ? {} : { errorSchema: value.errorSchema as ErrorCodec<unknown> }),
        ...(value.empty === true ? { empty: true } : {})
      }
    },
    isEmpty: (value) => value.render === undefined
  })
  return {
    engine,
    route: ((name: string, path: string, options?: unknown) =>
      engine.route(undefined, name, path, options)) as RouteConstructor<Model, Message>,
    layout: ((name: string, path: string, options?: unknown) =>
      engine.layout(undefined, name, path, options)) as LayoutConstructor<Model, Message>
  }
}
