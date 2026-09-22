/**
 * Read-only router observations over an existing Effect Atom runtime.
 *
 * @since 0.4.0
 */
import type { Key } from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import type { Location } from "./History.ts"
import type { EntryState, NavigationStatus } from "./internal/coordinator.ts"
import type {
  AnyNode,
  Destination,
  HashOf,
  InputOfNode,
  ParamsOf,
  RuntimeNode,
  SearchOf,
  SuccessOf
} from "./internal/contract.ts"
import { collectNodes, getContractNodes } from "./internal/contract.ts"
import { RouteDefinitionError, RouteEncodeError } from "./internal/errors.ts"
import type { CollectionIdOf, NavigationError, RouterService, RouterState, ServiceIdOf } from "./Router.ts"
import { href } from "./Router.ts"

/**
 * A read-only projection of one node in the active presentation.
 *
 * @since 0.4.0
 * @category models
 */
export interface RouteView<D> {
  readonly params: ParamsOf<D>
  readonly search: SearchOf<D>
  readonly hash: HashOf<D>
  readonly input: InputOfNode<D>
  readonly data: Option.Option<SuccessOf<D>>
}

/**
 * Atoms for one contract, backed by a caller-supplied runtime.
 *
 * @since 0.4.0
 * @category models
 */
export interface AtomRouter<C> {
  readonly routes: C
  /** The router service, once the runtime has acquired it. @since 0.4.0 */
  readonly service: Atom.Atom<AsyncResult.AsyncResult<RouterService<C>, unknown>>
  /** The authoritative read-only snapshot. @since 0.4.0 */
  readonly state: Atom.Atom<AsyncResult.AsyncResult<RouterState<C>, unknown>>
  /** The observed location. @since 0.4.0 */
  readonly location: Atom.Atom<Option.Option<Location>>
  /** The latest command status. @since 0.4.0 */
  readonly status: Atom.Atom<NavigationStatus>
  /** The active branch's runtime nodes, ancestors first. @since 0.4.0 */
  readonly branch: Atom.Atom<ReadonlyArray<AnyNode>>
  /** A typed read-only projection for one node, `None` when inactive. @since 0.4.0 */
  readonly route: <D extends AnyNode>(descriptor: D) => Atom.Atom<Option.Option<RouteView<D>>>
  /** Encodes a destination that belongs to this contract. @since 0.4.0 */
  readonly href: (destination: Destination<CollectionIdOf<C>>) => Result.Result<string, RouteEncodeError>
}

const sameOption = <A>(left: Option.Option<A>, right: Option.Option<A>): boolean => {
  if (Option.isSome(left) && Option.isSome(right)) return left.value === right.value
  return Option.isNone(left) && Option.isNone(right)
}

const resolveView = <D extends AnyNode>(entry: {
  readonly input: Result.Result<{ readonly params: unknown; readonly search: unknown; readonly hash: unknown }, unknown>
  readonly data: AsyncResult.AsyncResult<unknown, unknown>
  readonly retained: Option.Option<{ readonly input: unknown; readonly data: unknown }>
}): Option.Option<RouteView<D>> => {
  if (AsyncResult.isSuccess(entry.data) && Result.isSuccess(entry.input)) {
    const input = entry.input.success
    return Option.some({
      params: input.params,
      search: input.search,
      hash: input.hash,
      input,
      data: Option.some(entry.data.value)
    } as RouteView<D>)
  }
  if (Option.isSome(entry.retained)) {
    const retained = entry.retained.value
    const input = retained.input as { readonly params: unknown; readonly search: unknown; readonly hash: unknown }
    return Option.some({
      params: input.params,
      search: input.search,
      hash: input.hash,
      input,
      data: Option.some(retained.data)
    } as RouteView<D>)
  }
  if (Result.isSuccess(entry.input)) {
    const input = entry.input.success
    return Option.some({
      params: input.params,
      search: input.search,
      hash: input.hash,
      input,
      data: Option.none()
    } as RouteView<D>)
  }
  return Option.none()
}

/**
 * A required marker used to reject a runtime that does not provide a
 * contract's router service. Applications never construct it.
 *
 * @since 0.4.0
 * @category models
 */
export interface AtomRouterMissingService<Id extends string = string> {
  readonly __effectStackRouterMissingService: Id
}

/**
 * The runtime shape required by `AtomRouter.make` and renderer providers: the
 * runtime's context must supply the contract's service identifier.
 *
 * @since 0.4.0
 * @category models
 */
export type AtomRuntimeRequirement<C extends { readonly service: Key<string, unknown> }, R, ER> = Atom.AtomRuntime<
  R,
  ER
>
  & ([ServiceIdOf<C>] extends [R] ? unknown : AtomRouterMissingService<ServiceIdOf<C>>)

const displayEntries = (state: RouterState<unknown>): ReadonlyArray<EntryState> => {
  const presentation = Option.getOrUndefined(state.presentation)
  if (presentation === undefined) return []
  if (presentation._tag === "Pending") {
    const resolved = Option.getOrUndefined(state.resolved)
    return resolved === undefined ? presentation.entries : resolved.entries
  }
  return presentation.entries
}

/**
 * Builds read-only router atoms from an existing application runtime. Both the
 * service atom and the snapshot observation validate the finalized contract
 * carried by the acquired runtime, so a runtime assembled from a different
 * collection version fails at startup.
 *
 * @since 0.4.0
 * @category constructors
 */
export const make = <C extends { readonly service: Key<string, unknown> }, R, ER>(
  runtime: AtomRuntimeRequirement<C, R, ER>,
  contract: C
): AtomRouter<C> => {
  const atomRuntime = runtime as Atom.AtomRuntime<R, ER>
  const contractNodes = getContractNodes(contract)
  const byId = new Map<string, RuntimeNode>()
  for (const node of collectNodes(contractNodes)) byId.set(node.id, node)
  const owns = (node: { readonly id: string }): boolean => byId.get(node.id) === (node as unknown as RuntimeNode)
  const foreignError = (node: { readonly id: string }): RouteEncodeError =>
    new RouteEncodeError({
      routeId: node.id,
      part: "path",
      message: "Destination does not belong to this router contract"
    })

  const serviceEffect = contract.service as unknown as Effect.Effect<RouterService<C>, never, R>
  const validatedService = Effect.gen(function* () {
    const router = yield* serviceEffect
    if ((router as unknown as { readonly routes: unknown }).routes !== contract) {
      return yield* Effect.die(
        new RouteDefinitionError({
          message: "The router runtime was assembled from a different contract version than the supplied collection"
        })
      )
    }
    return router
  })
  const snapshotRef = atomRuntime.subscriptionRef<RouterState<C>, NavigationError<C>>(
    Effect.gen(function* () {
      const router = yield* validatedService
      const initial = yield* router.state
      const ref = yield* SubscriptionRef.make(initial)
      yield* router.changes.pipe(
        Stream.runForEach((value) => SubscriptionRef.set(ref, value)),
        Effect.forkScoped
      )
      return ref
    }) as Effect.Effect<SubscriptionRef.SubscriptionRef<RouterState<C>>, NavigationError<C>, R | Scope.Scope>
  )
  const serviceAtom = atomRuntime.atom(validatedService) as Atom.Atom<
    AsyncResult.AsyncResult<RouterService<C>, unknown>
  >

  const state = snapshotRef as Atom.Atom<AsyncResult.AsyncResult<RouterState<C>, unknown>>

  const location = Atom.make((get) => Option.flatMap(AsyncResult.value(get(state)), (value) => value.location)).pipe(
    Atom.withEquality<Option.Option<Location>>((left, right) => sameOption(left, right))
  )

  const status = Atom.make((get) =>
    Option.match(AsyncResult.value(get(state)), {
      onNone: (): NavigationStatus => ({ _tag: "Idle" }),
      onSome: (value) => value.status
    })
  )

  const branch = Atom.make((get) =>
    Option.match(AsyncResult.value(get(state)), {
      onNone: () => [] as ReadonlyArray<AnyNode>,
      onSome: (value) => displayEntries(value).map((entry) => entry.node as unknown as AnyNode)
    })
  )

  const route = <D extends AnyNode>(descriptor: D): Atom.Atom<Option.Option<RouteView<D>>> => {
    if (!owns(descriptor)) {
      throw new RouteDefinitionError({
        message: `Route projection "${descriptor.id}" does not belong to this router contract`
      })
    }
    return Atom.make((get): Option.Option<RouteView<D>> => {
      const result = get(state)
      if (!AsyncResult.isSuccess(result)) return Option.none()
      const entry = displayEntries(result.value).find(
        (candidate) => candidate.node === (descriptor as unknown as RuntimeNode)
      )
      if (entry === undefined) return Option.none()
      return resolveView<D>(entry)
    }).pipe(Atom.withEquality<Option.Option<RouteView<D>>>(sameOption))
  }

  return {
    routes: contract as unknown as C,
    service: serviceAtom,
    state,
    location,
    status,
    branch,
    route,
    href: (destination) => (owns(destination.node) ? href(destination) : Result.fail(foreignError(destination.node)))
  }
}
