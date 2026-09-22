/**
 * Effect-native route contracts, typed destinations, implementation Layers,
 * and the scoped navigation service.
 *
 * @since 0.4.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Option from "effect/Option"
import type * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type {
  Coordinator,
  NavigateOptions,
  NavigationOutcome,
  NavigationStatus,
  Presentation,
  ResolvedBranch,
  RouteImplementation,
  Snapshot
} from "./internal/coordinator.ts"
import { make as makeCoordinator } from "./internal/coordinator.ts"
import { compile } from "./internal/compiler.ts"
import type {
  AllNodes,
  AnyNode,
  ContractDefs,
  ContractRoutes,
  Destination,
  ErrorOf,
  HandlerInputOf,
  ImplementationRequirements,
  NodeInfo,
  RuntimeNode,
  SuccessOf
} from "./internal/contract.ts"
import { collectNodes, ContractNodes, makeContract } from "./internal/contract.ts"
import { RouteDefinitionError } from "./internal/errors.ts"
import type { RouteDecodeError, RouteEncodeError, RouteNotFound } from "./internal/errors.ts"
import type { Redirect } from "./internal/redirect.ts"
import { redirect as makeRedirect } from "./internal/redirect.ts"
import * as HistoryService from "./History.ts"
import { encode } from "./internal/url.ts"

export type {
  AnyGroupDescriptor,
  AnyNode,
  ContractDef,
  ContractDefs,
  ContractRoutes,
  Destination,
  ErrorOf,
  GroupDescriptor,
  HandlerInputOf,
  HashOf,
  IdOf,
  ImplementationRequirements,
  InputOfNode,
  NodeInfo,
  ParamsOf,
  RouteDescriptor,
  RuntimeGroupNode,
  RuntimeNode,
  SearchOf,
  SuccessOf
} from "./internal/contract.ts"
export type {
  EntryState,
  NavigationOutcome,
  NavigateOptions,
  NavigationStatus,
  Presentation,
  ResolvedBranch
} from "./internal/coordinator.ts"
export type { Redirect } from "./internal/redirect.ts"
export { RouteDecodeError, RouteDefinitionError, RouteEncodeError, RouteNotFound } from "./internal/errors.ts"
export * as History from "./History.ts"

/** The identifier of a contract's runtime service. @since 0.4.0 */
export type ServiceIdOf<C> = C extends { readonly service: Context.Key<infer Id, unknown> } ? Id : never

/** The collection identifier carried by a contract. @since 0.4.0 */
export type CollectionIdOf<C> =
  ServiceIdOf<C> extends `@effect-stack/router/${infer CollectionId}/service` ? CollectionId : string

type ImplementationIdOf<D> = D extends { readonly "~node": infer I extends NodeInfo }
  ? `@effect-stack/router/${I["collectionId"]}/impl/${I["id"]}`
  : never

type NodeCollectionId<D> = D extends { readonly "~node": infer I extends NodeInfo } ? I["collectionId"] : never

/** The union of domain errors declared by a contract. @since 0.4.0 */
export type DomainErrors<C> = AllNodes<C> extends infer N ? (N extends AnyNode ? ErrorOf<N> : never) : never

/** Failures observable from navigation for a contract. @since 0.4.0 */
export type NavigationError<C> =
  | HistoryService.HistoryError
  | RouteDecodeError
  | RouteEncodeError
  | RouteNotFound
  | RouteDefinitionError
  | DomainErrors<C>

/** A typed navigation attempt handle. @since 0.4.0 */
export interface NavigationHandle<C> {
  readonly id: number
  readonly await: Effect.Effect<NavigationOutcome, NavigationError<C>>
  readonly cancel: Effect.Effect<void>
}

/** Read-only router observation. @since 0.4.0 */
export interface RouterState<C> {
  readonly location: Option.Option<HistoryService.Location>
  readonly status: NavigationStatus
  readonly presentation: Option.Option<Presentation>
  readonly resolved: Option.Option<ResolvedBranch>
  readonly routes: C
}

/**
 * The runtime router service exposed through a contract's `service` key.
 *
 * @since 0.4.0
 * @category services
 */
export interface RouterService<C> {
  readonly routes: C
  readonly awaitInitial: Effect.Effect<void, NavigationError<C>>
  readonly state: Effect.Effect<RouterState<C>>
  readonly changes: Stream.Stream<RouterState<C>>
  readonly navigate: (
    destination: Destination<CollectionIdOf<C>>,
    options?: NavigateOptions
  ) => Effect.Effect<NavigationOutcome, NavigationError<C>>
  readonly submit: (
    destination: Destination<CollectionIdOf<C>>,
    options?: NavigateOptions
  ) => Effect.Effect<NavigationHandle<C>, NavigationError<C>>
  readonly refresh: Effect.Effect<NavigationOutcome, NavigationError<C>>
  readonly retry: Effect.Effect<NavigationOutcome, NavigationError<C>>
  readonly back: Effect.Effect<void, HistoryService.HistoryError>
  readonly forward: Effect.Effect<void, HistoryService.HistoryError>
  readonly go: (delta: number) => Effect.Effect<void, HistoryService.HistoryError>
  readonly href: (destination: Destination<CollectionIdOf<C>>) => Result.Result<string, RouteEncodeError>
}

type ServiceId<CollectionId extends string> = `@effect-stack/router/${CollectionId}/service`

/**
 * A named route contract.
 *
 * @since 0.4.0
 * @category models
 */
export type Contract<CollectionId extends string, Defs extends ContractDefs> = ContractRoutes<CollectionId, Defs> & {
  readonly service: Context.Service<ServiceId<CollectionId>, RouterService<Contract<CollectionId, Defs>>>
}

/**
 * Declares a named route contract with typed destinations and a runtime service
 * key.
 *
 * @since 0.4.0
 * @category constructors
 */
export const schema = <const CollectionId extends string, const Defs extends ContractDefs>(
  collectionId: CollectionId,
  defs: Defs
): Contract<CollectionId, Defs> => {
  const contract = makeContract(collectionId, defs)
  const value = { ...contract.routes, service: contract.service } as Record<PropertyKey, unknown>
  Object.defineProperty(value, ContractNodes, {
    value: contract.routes,
    enumerable: false,
    configurable: false,
    writable: false
  })
  return value as unknown as Contract<CollectionId, Defs>
}

/**
 * Returns the runtime nodes carried by a contract. Intended for renderer
 * adapters; not part of ordinary application code.
 *
 * @since 0.4.0
 * @category utilities
 */
export const nodes = (contract: unknown): Record<string, RuntimeNode> =>
  (contract as { readonly [ContractNodes]: Record<string, RuntimeNode> })[ContractNodes]

/**
 * Encodes a typed destination into a canonical href.
 *
 * @since 0.4.0
 * @category encoding
 */
export const href = <CollectionId extends string>(
  destination: Destination<CollectionId>
): Result.Result<string, RouteEncodeError> =>
  encode(
    destination.node,
    destination.input as {
      readonly params: unknown
      readonly search: unknown
      readonly hash: unknown
    }
  )

/**
 * Creates a typed redirect control failure for a handler.
 *
 * @since 0.4.0
 * @category navigation
 */
export const redirect = <CollectionId extends string>(destination: Destination<CollectionId>): Redirect<CollectionId> =>
  makeRedirect(destination)

const routeLayer = (
  descriptor: RuntimeNode,
  build: Effect.Effect<(input: unknown) => Effect.Effect<unknown, unknown, Scope.Scope>, unknown, unknown>
): Layer.Layer<unknown, unknown, unknown> => {
  const tag = descriptor.implementationTag
  if (tag === undefined) {
    throw new RouteDefinitionError({ message: `Route "${descriptor.id}" does not declare an implementation contract` })
  }
  return Layer.effect(
    tag,
    Effect.map(build, (run): RouteImplementation => ({ node: descriptor, run }))
  ) as Layer.Layer<unknown, unknown, unknown>
}

const captureContext = Effect.gen(function* () {
  const context = yield* Effect.context<never>()
  return Context.omit(Scope.Scope)(context)
})

/**
 * A small builder for routes whose handler must be constructed effectfully.
 * Direct handlers infer their input through `build`; effectful construction
 * uses `buildEffect`.
 *
 * @since 0.4.0
 * @category models
 */
export interface RouteBuilder<D extends AnyNode> {
  readonly descriptor: D
  readonly build: <A extends SuccessOf<D>, E extends ErrorOf<D> | Redirect<NodeCollectionId<D>>, R>(
    handler: (input: HandlerInputOf<D>) => Effect.Effect<A, E, R>
  ) => Layer.Layer<ImplementationIdOf<D>, never, Exclude<R, Scope.Scope>>
  readonly buildEffect: <A extends SuccessOf<D>, E extends ErrorOf<D> | Redirect<NodeCollectionId<D>>, RH, EC, RC>(
    factory: Effect.Effect<(input: HandlerInputOf<D>) => Effect.Effect<A, E, RH>, EC, RC>
  ) => Layer.Layer<ImplementationIdOf<D>, EC, RC | Exclude<RH, Scope.Scope>>
}

/**
 * Implements one route or group directly with a handler Layer.
 *
 * @since 0.4.0
 * @category layers
 */
export function route<D extends AnyNode>(descriptor: D): RouteBuilder<D>

/**
 * Implements one route or group directly with a handler Layer.
 *
 * @since 0.4.0
 * @category layers
 */
export function route<
  D extends AnyNode,
  A extends SuccessOf<D>,
  E extends ErrorOf<D> | Redirect<NodeCollectionId<D>>,
  R
>(
  descriptor: D,
  handler: (input: HandlerInputOf<D>) => Effect.Effect<A, E, R>
): Layer.Layer<ImplementationIdOf<D>, never, Exclude<R, Scope.Scope>>

/**
 * Implements one route or group with an application-scoped handler factory.
 *
 * @since 0.4.0
 * @category layers
 */
export function route<
  D extends AnyNode,
  A extends SuccessOf<D>,
  E extends ErrorOf<D> | Redirect<NodeCollectionId<D>>,
  RH,
  EC,
  RC
>(
  descriptor: D,
  factory: Effect.Effect<(input: HandlerInputOf<D>) => Effect.Effect<A, E, RH>, EC, RC>
): Layer.Layer<ImplementationIdOf<D>, EC, RC | Exclude<RH, Scope.Scope>>

export function route(
  descriptor: AnyNode,
  handler?: unknown
  // oxlint-disable-next-line typescript/no-explicit-any -- The overload implementation erases every output for runtime dispatch.
): Layer.Layer<any, any, any> | RouteBuilder<AnyNode> {
  const node = descriptor as unknown as RuntimeNode
  if (arguments.length < 2) {
    const builder: RouteBuilder<AnyNode> = {
      descriptor,
      build: (inner) => route(descriptor, inner as never) as never,
      buildEffect: (factory) => route(descriptor, factory as never) as never
    }
    return builder
  }
  if (Effect.isEffect(handler)) {
    const factory = handler as Effect.Effect<
      (input: unknown) => Effect.Effect<unknown, unknown, Scope.Scope>,
      unknown,
      unknown
    >
    const build = Effect.gen(function* () {
      const inner = yield* factory
      const context = yield* captureContext
      return (input: unknown) => inner(input).pipe(Effect.provide(context))
    })
    return routeLayer(node, build)
  }
  const direct = handler as (input: unknown) => Effect.Effect<unknown, unknown, Scope.Scope>
  const build = Effect.gen(function* () {
    const context = yield* captureContext
    return (input: unknown) => direct(input).pipe(Effect.provide(context))
  })
  return routeLayer(node, build)
}

/**
 * Assembles the runtime router Layer for a contract. Requires every mandatory
 * implementation service and History; missing implementations remain
 * unsatisfied Layer requirements.
 *
 * @since 0.4.0
 * @category layers
 */
export const layer = <C extends { readonly service: Context.Key<unknown, unknown> }>(
  contract: C
): Layer.Layer<ServiceIdOf<C>, never, ImplementationRequirements<C> | HistoryService.Service> => {
  const routes = (contract as unknown as { readonly [ContractNodes]: Record<string, RuntimeNode> })[ContractNodes]
  const compiled = compile(routes)
  const runtimeNodes = collectNodes(routes)
  const build = Effect.gen(function* () {
    yield* HistoryService.Service
    const implementations = new Map<string, RouteImplementation>()
    for (const node of runtimeNodes) {
      if (node.implementationTag === undefined) continue
      const implementation = (yield* node.implementationTag) as RouteImplementation
      implementations.set(node.id, implementation)
    }
    const coordinator = yield* makeCoordinator(compiled, implementations)
    return makeService(contract, coordinator)
  })
  const serviceTag = (contract as unknown as { readonly service: Context.Key<ServiceIdOf<C>, RouterService<C>> })
    .service
  // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- The captured build requirements are declared by the public signature.
  const buildErased = build as Effect.Effect<RouterService<C>, never, never>
  return Layer.effect(serviceTag, buildErased) as Layer.Layer<
    ServiceIdOf<C>,
    never,
    ImplementationRequirements<C> | HistoryService.Service
  >
}

const toPublicState =
  <C>(routes: C) =>
  (snapshot: Snapshot): RouterState<C> => ({
    location: snapshot.location,
    status: snapshot.status,
    presentation: snapshot.presentation,
    resolved: snapshot.resolved,
    routes
  })

const makeService = <C>(contract: C, coordinator: Coordinator): RouterService<C> => ({
  routes: contract,
  // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
  awaitInitial: coordinator.awaitInitial as Effect.Effect<void, NavigationError<C>>,
  state: SubscriptionRef.get(coordinator.snapshot).pipe(Effect.map(toPublicState(contract))),
  changes: SubscriptionRef.changes(coordinator.snapshot).pipe(Stream.map(toPublicState(contract))),
  navigate: (destination, options) =>
    // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
    coordinator.navigate(destination, options) as Effect.Effect<NavigationOutcome, NavigationError<C>>,
  submit: (destination, options) => {
    const handleEffect = coordinator.submit(destination, options).pipe(
      Effect.map((handle): NavigationHandle<C> => ({
        id: handle.id,
        // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
        await: handle.await as Effect.Effect<NavigationOutcome, NavigationError<C>>,
        cancel: handle.cancel
      }))
    )
    // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
    return handleEffect as Effect.Effect<NavigationHandle<C>, NavigationError<C>>
  },
  // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
  refresh: coordinator.refresh as Effect.Effect<NavigationOutcome, NavigationError<C>>,
  // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- Internal errors are erased; the public contract declares the union.
  retry: coordinator.retry as Effect.Effect<NavigationOutcome, NavigationError<C>>,
  back: coordinator.back,
  forward: coordinator.forward,
  go: coordinator.go,
  href
})
