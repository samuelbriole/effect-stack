/**
 * Router observations and actions over an existing Effect Atom runtime.
 *
 * @since 0.4.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
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
import { applicationRuntime, RuntimeApplication, type ApplicationWitness } from "./internal/application.ts"
import type { ApplicationErrorOf, RoutesOf } from "./internal/gates.ts"
import { RouteDefinitionError, type RouteEncodeError } from "./internal/errors.ts"
import { encodeDestination, ownsNode } from "./internal/href.ts"
import { displayEntries } from "./internal/presentation.ts"
import type { NavigateOptions, NavigationError, NavigationOutcome, RouterService, RouterState } from "./Router.ts"

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
export interface AtomRouter<App, ER = unknown> {
  readonly app: App
  /** The router service, once the runtime has acquired it. @since 0.4.0 */
  readonly service: Atom.Atom<AsyncResult.AsyncResult<RouterService<RoutesOf<App>, ApplicationErrorOf<App>>, unknown>>
  /** Creates a fresh, lazy navigation action backed by the validated runtime. @since 0.4.0 */
  readonly navigate: (
    destination: DestinationOf<RoutesOf<App>>,
    options?: NavigateOptions
  ) => Atom.Atom<AsyncResult.AsyncResult<NavigationOutcome, NavigationError<ApplicationErrorOf<App>> | ER>>
  /** Creates a fresh, lazy retry of the observed location. @since 0.4.0 */
  readonly retry: () => Atom.Atom<
    AsyncResult.AsyncResult<NavigationOutcome, NavigationError<ApplicationErrorOf<App>> | ER>
  >
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

/** A runtime containing the single acquired application selected by `Router.layer`. @since 0.4.0 */
export type RouterRuntimeRequirement<R, ER> = Atom.AtomRuntime<R, ER>
  & ([RuntimeApplication] extends [R]
    ? unknown
    : {
        readonly __effectStackRouterMissingService: "@effect-stack/router/RuntimeApplication"
      })

/**
 * Builds router atoms from an existing application runtime. Observations and
 * actions validate the finalized application
 * identity carried by the acquired runtime, so a runtime assembled from a
 * different application specification fails at startup.
 *
 * @since 0.4.0
 * @category constructors
 */
export const make = <App extends ApplicationWitness, R, ER>(
  runtime: RouterRuntimeRequirement<R, ER>,
  app: App
): AtomRouter<App, ER> => {
  const appRuntime = applicationRuntime(app)
  if (appRuntime === undefined) {
    throw new RouteDefinitionError({ message: "AtomRouter.make requires an assembled application witness" })
  }
  const byId = appRuntime.byId

  // The public requirement proves the standard key is present, not an arbitrary dynamic key.
  const selected = RuntimeApplication as unknown as Effect.Effect<RuntimeApplication["Service"], never, R>
  const validatedService = Effect.map(selected, (value) => {
    const router = value.router
    if (
      value.app !== app
      || router.routes !== app.routes
      || router.token !== app.token
      || router.applicationId !== app.appId
    ) {
      throw new RouteDefinitionError({
        message: "The runtime selected a different application than the mounted witness"
      })
    }
    return router as RouterService<RoutesOf<App>, ApplicationErrorOf<App>>
  })
  const serviceAtom = Atom.make((get) =>
    Effect.flatMap(get.result(runtime, { suspendOnWaiting: true }), (context) =>
      validatedService.pipe(Effect.provide(context))
    )
  )
  const state = runtime.atom(Stream.unwrap(Effect.map(validatedService, (router) => router.changes)))
  const action = (
    run: (
      router: RouterService<RoutesOf<App>, ApplicationErrorOf<App>>
    ) => Effect.Effect<NavigationOutcome, NavigationError<ApplicationErrorOf<App>>>
  ) =>
    Atom.make((get) => {
      // Hold one runtime acquisition without tracking it: a refresh is not a new command.
      get.mount(runtime)
      return Effect.flatMap(get.resultOnce(runtime, { suspendOnWaiting: true }), (context) =>
        Effect.flatMap(validatedService, run).pipe(Effect.provide(context))
      )
    }).pipe(Atom.setIdleTTL(0))

  // Each command owns its result slot and acquires its validated service only once.
  const navigate = (destination: DestinationOf<RoutesOf<App>>, options?: NavigateOptions) =>
    action((router) => router.navigate(destination, options))
  const retry = () => action((router) => router.retry)

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
      if (entry === undefined || Result.isFailure(entry.input)) return Option.none()
      const input = entry.input.success
      return Option.some({ params: input.params, search: input.search, hash: input.hash, input } as RouteView<Def>)
    }).pipe(Atom.withEquality<Option.Option<RouteView<Def>>>(sameOption))
  }

  return {
    app,
    service: serviceAtom,
    navigate,
    retry,
    state,
    location,
    status,
    branch,
    route,
    href: (destination) => encodeDestination(destination, byId)
  }
}
