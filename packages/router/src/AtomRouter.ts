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
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import type { Location } from "./History.ts"
import type {
  AnyDefinition,
  AnyNode,
  DestinationOf,
  HashOfDef,
  DecodedRouteInputOfDef,
  ParamsOfDef,
  SearchOfDef
} from "./internal/definition.ts"
import { applicationRuntime } from "./internal/application.ts"
import type { ApplicationErrorOf, RoutesOf } from "./internal/gates.ts"
import { RouteDefinitionError, type RouteEncodeError } from "./internal/errors.ts"
import { encodeDestination, ownsNode } from "./internal/href.ts"
import { displayEntries } from "./internal/presentation.ts"
import type { NavigationError, RouterService, RouterState } from "./Router.ts"

/**
 * A read-only projection of one definition in the active presentation.
 *
 * @since 0.4.0
 * @category models
 */
export interface RouteView<Def> {
  readonly params: ParamsOfDef<Def>
  readonly search: SearchOfDef<Def>
  readonly hash: HashOfDef<Def>
  readonly input: DecodedRouteInputOfDef<Def>
}

/**
 * Atoms for one assembled application, backed by a caller-supplied runtime.
 *
 * @since 0.4.0
 * @category models
 */
export interface AtomRouter<App> {
  readonly app: App
  /** The router service, once the runtime has acquired it. @since 0.4.0 */
  readonly service: Atom.Atom<AsyncResult.AsyncResult<RouterService<RoutesOf<App>, ApplicationErrorOf<App>>, unknown>>
  /** The authoritative read-only snapshot. @since 0.4.0 */
  readonly state: Atom.Atom<AsyncResult.AsyncResult<RouterState<RoutesOf<App>>, unknown>>
  /** The observed location. @since 0.4.0 */
  readonly location: Atom.Atom<Option.Option<Location>>
  /** The status of accepted navigation. @since 0.4.0 */
  readonly status: Atom.Atom<RouterState["status"]>
  /** The active branch's runtime nodes, ancestors first. @since 0.4.0 */
  readonly branch: Atom.Atom<ReadonlyArray<AnyNode>>
  /** A typed read-only projection for one definition, `None` when inactive. @since 0.4.0 */
  readonly route: <Def extends AnyDefinition>(node: Def) => Atom.Atom<Option.Option<RouteView<Def>>>
  /** Encodes a destination that belongs to this application's selection. @since 0.4.0 */
  readonly href: (destination: DestinationOf<RoutesOf<App>>) => Result.Result<string, RouteEncodeError>
}

const sameOption = <A>(left: Option.Option<A>, right: Option.Option<A>): boolean => {
  if (Option.isSome(left) && Option.isSome(right)) return left.value === right.value
  return Option.isNone(left) && Option.isNone(right)
}

const resolveView = <Def>(entry: {
  readonly input: Result.Result<{ readonly params: unknown; readonly search: unknown; readonly hash: unknown }, unknown>
}): Option.Option<RouteView<Def>> => {
  if (Result.isSuccess(entry.input)) {
    const input = entry.input.success
    return Option.some({
      params: input.params,
      search: input.search,
      hash: input.hash,
      input
    } as RouteView<Def>)
  }
  return Option.none()
}

/**
 * A required marker used to reject a runtime that does not provide an
 * application's router service. Applications never construct it.
 *
 * @since 0.4.0
 * @category models
 */
export interface AtomRouterMissingService<Id extends string = string> {
  readonly __effectStackRouterMissingService: Id
}

/** The application service identifier required from a runtime. @since 0.4.0 */
export type ApplicationServiceIdOf<App> = App extends { readonly service: Key<infer Id, unknown> } ? Id : never

/**
 * The runtime shape required by `AtomRouter.make` and renderer providers: the
 * runtime's context must supply the application's service identifier.
 *
 * @since 0.4.0
 * @category models
 */
export type AtomRuntimeRequirement<App extends { readonly service: Key<string, unknown> }, R, ER> = Atom.AtomRuntime<
  R,
  ER
>
  & ([ApplicationServiceIdOf<App>] extends [R] ? unknown : AtomRouterMissingService<ApplicationServiceIdOf<App>>)

/**
 * Builds read-only router atoms from an existing application runtime. Both the
 * service atom and the snapshot observation validate the finalized application
 * identity carried by the acquired runtime, so a runtime assembled from a
 * different application specification fails at startup.
 *
 * @since 0.4.0
 * @category constructors
 */
export const make = <
  App extends {
    readonly service: Key<string, unknown>
    readonly routes: unknown
    readonly appId: string
    readonly token: object
  },
  R,
  ER
>(
  runtime: AtomRuntimeRequirement<App, R, ER>,
  app: App
): AtomRouter<App> => {
  const atomRuntime = runtime as Atom.AtomRuntime<R, ER>
  const appRuntime = applicationRuntime(app)
  if (appRuntime === undefined) {
    throw new RouteDefinitionError({ message: "AtomRouter.make requires an assembled application witness" })
  }
  const byId = appRuntime.byId

  const serviceEffect = app.service as unknown as Effect.Effect<
    RouterService<RoutesOf<App>, ApplicationErrorOf<App>>,
    never,
    R
  >
  const validatedService = Effect.gen(function* () {
    const router = yield* serviceEffect
    if (
      (router as unknown as { readonly routes: unknown }).routes !== app.routes
      || (router as unknown as { readonly token: unknown }).token !== app.token
      || (router as unknown as { readonly applicationId: unknown }).applicationId !== app.appId
    ) {
      return yield* Effect.die(
        new RouteDefinitionError({
          message:
            "The router runtime was assembled from a different application specification than the supplied witness"
        })
      )
    }
    return router
  })
  const snapshotRef = atomRuntime.subscriptionRef<RouterState<RoutesOf<App>>, NavigationError<ApplicationErrorOf<App>>>(
    Effect.gen(function* () {
      const router = yield* validatedService
      const initial = yield* router.state
      const ref = yield* SubscriptionRef.make(initial)
      yield* router.changes.pipe(
        Stream.runForEach((value) => SubscriptionRef.set(ref, value)),
        Effect.forkScoped
      )
      return ref
    }) as Effect.Effect<
      SubscriptionRef.SubscriptionRef<RouterState<RoutesOf<App>>>,
      NavigationError<ApplicationErrorOf<App>>,
      R | Scope.Scope
    >
  )
  const serviceAtom = atomRuntime.atom(validatedService) as Atom.Atom<
    AsyncResult.AsyncResult<RouterService<RoutesOf<App>, ApplicationErrorOf<App>>, unknown>
  >

  const state = snapshotRef as Atom.Atom<AsyncResult.AsyncResult<RouterState<RoutesOf<App>>, unknown>>

  const location = Atom.make((get) => Option.flatMap(AsyncResult.value(get(state)), (value) => value.location)).pipe(
    Atom.withEquality<Option.Option<Location>>((left, right) => sameOption(left, right))
  )

  const status = Atom.make((get) =>
    Option.match(AsyncResult.value(get(state)), {
      onNone: (): RouterState["status"] => ({ _tag: "Idle" }),
      onSome: (value) => value.status
    })
  )

  const branch = Atom.make((get) =>
    Option.match(AsyncResult.value(get(state)), {
      onNone: () => [] as ReadonlyArray<AnyNode>,
      onSome: (value) => displayEntries(value).map((entry) => entry.node as unknown as AnyNode)
    })
  )

  const route = <Def extends AnyDefinition>(node: Def): Atom.Atom<Option.Option<RouteView<Def>>> => {
    if (!ownsNode(byId, node)) {
      throw new RouteDefinitionError({
        message: `Route projection "${(node as unknown as AnyNode).id}" does not belong to this router selection`
      })
    }
    return Atom.make((get): Option.Option<RouteView<Def>> => {
      const result = get(state)
      if (!AsyncResult.isSuccess(result)) return Option.none()
      const entry = displayEntries(result.value).find((candidate) => candidate.node === (node as unknown as AnyNode))
      if (entry === undefined) return Option.none()
      return resolveView<Def>(entry)
    }).pipe(Atom.withEquality<Option.Option<RouteView<Def>>>(sameOption))
  }

  return {
    app,
    service: serviceAtom,
    state,
    location,
    status,
    branch,
    route,
    href: (destination) => encodeDestination(destination, byId)
  }
}
