/** Effect-native routing with direct transition gates. @since 0.4.0 */
import type * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as Option from "effect/Option"
import type * as Result from "effect/Result"
import type * as Stream from "effect/Stream"
import type {
  NavigateOptions,
  NavigationOutcome,
  NavigationStatus,
  Presentation,
  ResolvedBranch
} from "./internal/coordinator.ts"
import type { AnyDefinitionShape, Destination, DestinationOf } from "./internal/definition.ts"
import { defineLayout, defineRoute } from "./internal/definition.ts"
import type {
  ApplicationServiceId,
  CoreApplicationTypeId,
  ApplicationTypes,
  SelectionError,
  SelectionRequirements
} from "./internal/gates.ts"
import type { RouteConstructor, LayoutConstructor } from "./internal/constructors.ts"
import type { RouteDecodeError, RouteDefinitionError, RouteEncodeError, RouteNotFound } from "./internal/errors.ts"
import type { Redirect } from "./internal/redirect.ts"
import { redirect as makeRedirect } from "./internal/redirect.ts"
import { makeApplication } from "./internal/application.ts"
import * as History from "./History.ts"
import { encodeDestination } from "./internal/href.ts"

export { History }
export type {
  AnyDefinition,
  AnyDefinitionShape,
  AnyLayoutDefinition,
  AnyNode,
  AnyNodeInfo,
  AnyRouteDefinition,
  ChildInfo,
  DefinitionKind,
  Destination,
  DestinationBrand,
  DestinationOptions,
  DestinationOf,
  EndpointAt,
  EndpointInfo,
  Fields,
  DecodedRouteInput,
  DecodedRouteInputOf,
  DecodedRouteInputOfDef,
  HashOfDef,
  HashType,
  InheritedHash,
  IdOf,
  IndexInfo,
  InfoOf,
  InputOf,
  InputOfDef,
  JoinPath,
  LayoutDefinition,
  NodeInfo,
  ParamsOf,
  ParamsOfDef,
  PathInput,
  PathTarget,
  PathTargets,
  NavigateTarget,
  PathsOf,
  RouteDefinition,
  RuntimeLayoutNode,
  RuntimeNode,
  RuntimeRouteNode,
  SearchOf,
  SearchOfDef,
  SelectedEndpoints,
  StructType,
  UrlSchema,
  UrlSchemaFields
} from "./internal/definition.ts"
export type {
  AppIdOf,
  ApplicationServiceId,
  ApplicationErrorOf,
  ApplicationRequirementsOf,
  ErrorOf,
  RequirementsOf,
  RoutesOf
} from "./internal/gates.ts"
export type * from "./internal/constructors.ts"
export type { ViewFailure, ViewShape } from "./internal/presentation.ts"
export { NotFoundFailureOwner } from "./internal/presentation.ts"
export type {
  EntryState,
  NavigationOutcome,
  NavigateOptions,
  NavigationStatus,
  Presentation,
  ResolvedBranch
} from "./internal/coordinator.ts"
export type { Redirect } from "./internal/redirect.ts"
export { CoreApplicationTypeId } from "./internal/gates.ts"
export { RouteDefinitionTypeId, LayoutDefinitionTypeId } from "./internal/definition.ts"
export { RouteDecodeError, RouteDefinitionError, RouteEncodeError, RouteNotFound } from "./internal/errors.ts"
export { resolvePathDestination } from "./internal/destinations.ts"
export { applicationLayer as layer, RuntimeApplication, type ApplicationWitness } from "./internal/application.ts"

/** Navigation failures, including declared gate failures. @since 0.4.0 */
export type NavigationError<E = unknown> =
  | History.HistoryError
  | RouteDecodeError
  | RouteEncodeError
  | RouteNotFound
  | RouteDefinitionError
  | E

/** Identity-specific attempt handle. @since 0.4.0 */
export interface NavigationHandle<E = unknown> {
  readonly id: number
  readonly await: Effect.Effect<NavigationOutcome, NavigationError<E>>
  readonly cancel: Effect.Effect<void>
}

/** Authoritative read-only snapshot. @since 0.4.0 */
export interface RouterState<Routes = unknown> {
  readonly location: Option.Option<History.Location>
  readonly status: NavigationStatus
  readonly presentation: Option.Option<Presentation>
  readonly resolved: Option.Option<ResolvedBranch>
  readonly routes: Routes
}

/** Scoped application router service. @since 0.4.0 */
export interface RouterService<Routes = unknown, E = unknown> {
  readonly applicationId: string
  readonly routes: Routes
  readonly token: object
  readonly awaitInitial: Effect.Effect<void, NavigationError<E>>
  readonly state: Effect.Effect<RouterState<Routes>>
  readonly changes: Stream.Stream<RouterState<Routes>>
  readonly navigate: (
    destination: DestinationOf<Routes>,
    options?: NavigateOptions
  ) => Effect.Effect<NavigationOutcome, NavigationError<E>>
  readonly submit: (
    destination: DestinationOf<Routes>,
    options?: NavigateOptions
  ) => Effect.Effect<NavigationHandle<E>, NavigationError<E>>
  readonly refresh: Effect.Effect<NavigationOutcome, NavigationError<E>>
  readonly retry: Effect.Effect<NavigationOutcome, NavigationError<E>>
  readonly back: Effect.Effect<void, History.HistoryError>
  readonly forward: Effect.Effect<void, History.HistoryError>
  readonly go: (delta: number) => Effect.Effect<void, History.HistoryError>
  readonly href: (destination: DestinationOf<Routes>) => Result.Result<string, RouteEncodeError>
}

/** Renderer-neutral application witness. @since 0.4.0 */
export interface CoreApplication<
  AppId extends string = string,
  Routes = unknown,
  E = unknown,
  R = unknown
> extends ApplicationTypes<E, R> {
  readonly [CoreApplicationTypeId]: true
  readonly appId: AppId
  readonly routes: Routes
  readonly token: object
  readonly service: Context.Service<ApplicationServiceId<AppId, E, R>, RouterService<Routes, E>>
  readonly layer: Layer.Layer<ApplicationServiceId<AppId, E, R>, History.HistoryError, R | History.History>
}

/** Application inferred from its selected definitions. @since 0.4.0 */
export type ApplicationOf<AppId extends string, Defs> = CoreApplication<
  AppId,
  Defs,
  SelectionError<Defs>,
  SelectionRequirements<Defs>
>

const headlessFactory = {
  renderer: "@effect-stack/router",
  requiresPresentation: false,
  normalize: () => undefined,
  isEmpty: () => true
} as const

/** Constructs a headless endpoint. @since 0.4.0 */
export const route: RouteConstructor = ((name: string, path: string, options?: unknown) =>
  defineRoute(headlessFactory, undefined, name, path, options)) as unknown as RouteConstructor

/** Constructs a parent-aware headless layout. @since 0.4.0 */
export const layout: LayoutConstructor = ((name: string, path: string, options?: unknown) =>
  defineLayout(headlessFactory, undefined, name, path, options)) as unknown as LayoutConstructor

/** Collection-independent destination encoding. @since 0.4.0 */
export const href = (destination: Destination): Result.Result<string, RouteEncodeError> =>
  encodeDestination(destination)

/** Typed redirect control failure. @since 0.4.0 */
export const redirect = <Brand>(destination: Destination<Brand>): Redirect<Brand> => makeRedirect(destination)

/** Lazily assembles a fresh application; invalid selections are defects. @since 0.4.0 */
export function make<
  const AppId extends string,
  const Defs extends readonly [AnyDefinitionShape, ...Array<AnyDefinitionShape>]
>(appId: AppId, definitions: Defs): Effect.Effect<ApplicationOf<AppId, Defs>> {
  return makeApplication(appId, definitions, headlessFactory)
}
