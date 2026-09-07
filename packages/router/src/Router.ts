/**
 * Scoped navigation runtime exposed through Effect Atom.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberMap from "effect/FiberMap"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as History from "./History.ts"
import * as Route from "./Route.ts"
import * as RouteTree from "./RouteTree.ts"

/**
 * No configured route matched a location.
 *
 * @since 0.1.0
 * @category errors
 */
export class RouteNotFound extends Schema.TaggedError<RouteNotFound>()("@effect-stack/router/RouteNotFound", {
  pathname: Schema.String,
  search: Schema.String,
  hash: Schema.String
}) {}

/**
 * The route set contains duplicate IDs or path templates.
 *
 * @since 0.1.0
 * @category errors
 */
export class RouterConfigurationError extends Schema.TaggedError<RouterConfigurationError>()(
  "@effect-stack/router/RouterConfigurationError",
  {
    message: Schema.String
  }
) {}

/**
 * A lazy route module failed to load.
 *
 * @since 0.1.0
 * @category errors
 */
class RouteLoadErrorBase extends Schema.TaggedError<RouteLoadErrorBase>()(
  "RouteLoadError",
  {
    routeId: Schema.String,
    error: Schema.Unknown
  }
) {}

/**
 * A lazy route module failed to load, typed with its route ID and load error.
 *
 * @since 0.2.0
 * @category errors
 */
export class RouteLoadError<Id extends string, Error> extends RouteLoadErrorBase {
  // Explicit constructor binds `Id`/`Error` inference at typed `new` sites;
  // declared fields alone are not inference positions.
  constructor(options: { readonly routeId: Id; readonly error: Error }) {
    super({ routeId: options.routeId, error: options.error })
  }
  declare readonly routeId: Id
  declare readonly error: Error
}

class RouteLoaderErrorBase extends Schema.TaggedError<RouteLoaderErrorBase>()(
  "@effect-stack/router/RouteLoaderError",
  { routeId: Schema.String, error: Schema.Unknown }
) {}

/**
 * A route's data loader failed. Defects and interruption remain in Cause.
 *
 * @since 0.2.0
 * @category errors
 */
export class RouteLoaderError<Id extends string, Error> extends RouteLoaderErrorBase {
  // Explicit constructor binds `Id`/`Error` inference at typed `new` sites;
  // declared fields alone are not inference positions.
  constructor(options: { readonly routeId: Id; readonly error: Error }) {
    super({ routeId: options.routeId, error: options.error })
  }
  declare readonly routeId: Id
  declare readonly error: Error
}

/**
 * A route resolved from the current location.
 *
 * @since 0.1.0
 * @category models
 */
export interface ResolvedRoute<R extends Route.Any> extends Route.Match<R> {
  readonly location: History.Location
  readonly module: Route.Route.Module<R>
  readonly loaderData: Route.Route.LoaderData<R>
}

/**
 * The successfully decoded navigation input for one route in the active
 * branch. Location stays at branch level; this carries only the decoded route
 * inputs so renderers can show pending params while data loads.
 *
 * @since 0.2.0
 * @category models
 */
export interface IncomingRoute<R extends Route.Any> {
  readonly route: R
  readonly params: Route.Route.Params<R>
  readonly search: Route.Route.Search<R>
  readonly hash: Route.Route.Hash<R>
}

/**
 * An identity token for one accepted navigation transition. It is opaque;
 * compare by reference to detect superseded or completed transitions.
 *
 * @since 0.2.0
 * @category models
 */
export interface TransitionId {
  readonly _tag: "@effect-stack/router/TransitionId"
  readonly sequence: number
}

type LoadFailure<R extends Route.Any> = Route.Route.LoadError<R> extends never ? never
  : RouteLoadError<R["id"], Route.Route.LoadError<R>>

type LoaderFailure<R extends Route.Any> = Route.Route.LoaderError<R> extends never ? never
  : RouteLoaderError<R["id"], Route.Route.LoaderError<R>>

/**
 * Failures this specific route can produce while resolving: malformed URL
 * input, a failed lazy module, or a failed data loader. Defects and
 * interruption remain in the `Cause`, not this channel.
 *
 * @since 0.2.0
 * @category errors
 */
export type RouteFailure<R extends Route.Any> = Route.RouteDecodeError | LoadFailure<R> | LoaderFailure<R>

/**
 * One route planned into the active branch, with its loading state.
 *
 * - `transitionId` is the transition that produced the current `result`.
 * - `incoming` is the decoded navigation input, published before loaders run.
 * - `result` is the current asynchronous resolution for this entry, with this
 *   route's typed failures.
 * - `retained` is the route's last successful snapshot, preserved across
 *   waiting and failed revalidations so the original input and data remain
 *   observable.
 *
 * @since 0.2.0
 * @category models
 */
export interface MatchState<R extends Route.Any> {
  readonly routeId: R["id"]
  readonly route: R
  readonly transitionId: TransitionId
  readonly incoming: Result.Result<IncomingRoute<R>, Route.RouteDecodeError>
  readonly result: AsyncResult.AsyncResult<ResolvedRoute<R>, RouteFailure<R>>
  readonly retained: Option.Option<ResolvedRoute<R>>
}

/**
 * The distributive entry type for every route in a route list.
 *
 * @since 0.2.0
 * @category type utilities
 */
export type MatchStates<Routes extends ReadonlyArray<Route.Any>> = Routes[number] extends infer R
  ? R extends Route.Any ? MatchState<R>
  : never
  : never

/**
 * The most recent fully successful navigation: one completed transition whose
 * every branch entry resolved successfully.
 *
 * @since 0.2.0
 * @category models
 */
export interface SuccessfulBranch<Routes extends ReadonlyArray<Route.Any> = ReadonlyArray<Route.Any>> {
  readonly transitionId: TransitionId
  readonly location: History.Location
  readonly matches: ReadonlyArray<Resolved<Routes>>
}

/**
 * A snapshot of one navigation across the whole matched branch, in tree order
 * (ancestors first). Settled transitions never leave stale waiting flags.
 *
 * @since 0.2.0
 * @category models
 */
export interface Branch<Routes extends ReadonlyArray<Route.Any> = ReadonlyArray<Route.Any>, E = unknown> {
  readonly transitionId: TransitionId
  readonly location: Option.Option<History.Location>
  readonly notFound: boolean
  readonly result: AsyncResult.AsyncResult<void, NavigationError<Routes> | E>
  readonly lastSuccess: Option.Option<SuccessfulBranch<Routes>>
  readonly matches: ReadonlyArray<MatchStates<Routes>>
}

type RouteUnion<Routes extends ReadonlyArray<Route.Any>> = Routes[number]

/**
 * The resolved union produced by a route tuple.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type Resolved<Routes extends ReadonlyArray<Route.Any>> = RouteUnion<Routes> extends infer R
  ? R extends Route.Any ? ResolvedRoute<R>
  : never
  : never

/**
 * Failures that can occur after a navigation command has been accepted.
 *
 * @since 0.1.0
 * @category errors
 */
export type NavigationError<Routes extends ReadonlyArray<Route.Any>> =
  | History.HistoryError
  | Route.RouteDecodeError
  | Route.RouteEncodeError
  | RouteNotFound
  | RouterConfigurationError
  | (RouteUnion<Routes> extends infer R ? R extends Route.Any ? LoadFailure<R> | LoaderFailure<R> : never : never)

/**
 * A typed push or replace target for one route.
 *
 * @since 0.1.0
 * @category models
 */
export interface To<R extends Route.Any> {
  readonly _tag: "To"
  readonly route: R
  readonly input: Route.Route.Input<R>
  readonly replace: boolean
  readonly state?: unknown
}

type ToUnion<Routes extends ReadonlyArray<Route.Any>> = Routes[number] extends infer R
  ? R extends Route.Any ? To<R> : never
  : never

/**
 * Commands accepted by a router's navigation atoms.
 *
 * `To` and `Refresh` describe a transition the caller can await to completion;
 * `Back`, `Forward`, and `Go` are acceptance-only because the resulting
 * navigation arrives asynchronously through the host history.
 *
 * @since 0.1.0
 * @category models
 */
export type Command<Routes extends ReadonlyArray<Route.Any>> =
  | ToUnion<Routes>
  | { readonly _tag: "Back" }
  | { readonly _tag: "Forward" }
  | { readonly _tag: "Go"; readonly delta: number }
  | { readonly _tag: "Refresh" }

/**
 * Atoms for one route, cached by route ID so repeated selections share
 * subscriptions and skip notifications when the selected value is unchanged.
 *
 * @since 0.2.0
 * @category models
 */
export interface RouteAtoms<R extends Route.Any> {
  readonly route: R
  /** The route's entry in the active branch, if any. @since 0.2.0 */
  readonly state: Atom.Atom<Option.Option<MatchState<R>>>
  /** The decoded pending input for the route. @since 0.2.0 */
  readonly incoming: Atom.Atom<Option.Option<Result.Result<IncomingRoute<R>, Route.RouteDecodeError>>>
  /** The selected path parameters, equal-compared. @since 0.2.0 */
  readonly params: Atom.Atom<Option.Option<Route.Route.Params<R>>>
  /** The selected search parameters, equal-compared. @since 0.2.0 */
  readonly search: Atom.Atom<Option.Option<Route.Route.Search<R>>>
  /**
   * The route's current resolved view: the live success while it holds, and
   * the last retained successful snapshot during waiting or failed
   * revalidation. `None` only when the route is inactive or never succeeded.
   *
   * @since 0.2.0
   */
  readonly resolved: Atom.Atom<Option.Option<ResolvedRoute<R>>>
}

/**
 * Failures while constructing the scoped router engine: the router `Layer`,
 * route configuration, or history access.
 *
 * @since 0.2.0
 * @category errors
 */
export type EngineError<LayerError> =
  | LayerError
  | RouterConfigurationError
  | History.HistoryError
  | RouteNotFound

/**
 * The headless router interface shared by all renderers.
 *
 * @since 0.1.0
 * @category models
 */
export interface Router<Routes extends ReadonlyArray<Route.Any>, LayerError> {
  readonly routes: Routes
  /** The leaf (deepest matched route) resolution across all transitions. @since 0.1.0 */
  readonly state: Atom.Atom<AsyncResult.AsyncResult<Resolved<Routes>, NavigationError<Routes> | LayerError>>
  /**
   * Compatibility projection of the latest dispatched navigation operation,
   * including operations started through `execute` or the host history. Writes
   * accept `Command`s plus the `Atom.Reset` and `Atom.Interrupt` control
   * symbols; the projected `AsyncResult` waits while an operation is in flight
   * and settles when that operation's transition finishes. Cancelling a write
   * through `Atom.Interrupt` or `Atom.Reset` interrupts and finalizes the exact
   * transition it started. Writing `Atom.Reset` returns the projection to
   * `Initial`; the settling of the operation it replaced stays hidden, and the
   * projection tracks the next dispatched operation from then on.
   *
   * @since 0.1.0
   */
  readonly navigate: Atom.AtomResultFn<Command<Routes>, void, NavigationError<Routes> | LayerError>
  /** The active branch snapshot for all matched routes. @since 0.2.0 */
  readonly branch: Atom.Atom<Branch<Routes, LayerError>>
  /** The latest fully successful navigation, if any. @since 0.2.0 */
  readonly completed: Atom.Atom<Option.Option<SuccessfulBranch<Routes>>>
  readonly href: <R extends RouteUnion<Routes>>(
    route: R,
    input: Route.Route.Input<R>
  ) => Result.Result<string, Route.RouteEncodeError>
  /** The compiled route tree for tree routers; `undefined` for flat routers. @since 0.2.0 */
  readonly compiled: RouteTree.Compiled | undefined
  /**
   * Dispatches a navigation command and joins the exact transition fiber it
   * starts, with typed failures and without routing through any shared atom.
   * `To` and `Refresh` complete when their transition settles; `Back`,
   * `Forward`, and `Go` complete once the host accepts the traversal.
   * Interrupting the caller interrupts exactly the transition it started and
   * awaits its cleanup. The scoped engine stays mounted for the lifetime of
   * the call, so headless callers keep long-running loaders alive.
   *
   * @since 0.2.0
   */
  readonly execute: (command: Command<Routes>) => Effect.Effect<
    void,
    NavigationError<Routes> | LayerError,
    AtomRegistry.AtomRegistry
  >
  /**
   * Rebuilds a failed Layer, runtime, and engine when they are unhealthy and
   * awaits the rebuilt engine's initial transition; on a healthy runtime it
   * dispatches `Refresh` and awaits that transition. Typed failures mirror
   * `execute`.
   *
   * @since 0.2.0
   */
  readonly retry: Effect.Effect<void, NavigationError<Routes> | LayerError, AtomRegistry.AtomRegistry>
  /** Route-scoped atoms for one route in this router's set, cached by ID. @since 0.2.0 */
  readonly routeAtoms: <R extends RouteUnion<Routes>>(route: R) => RouteAtoms<R>
}

// --- engine internals ---

interface PlannedEntry {
  readonly route: Route.Any
  readonly incoming: Result.Result<IncomingRoute<Route.Any>, Route.RouteDecodeError>
}

interface NavigationPlan {
  readonly entries: ReadonlyArray<PlannedEntry>
  readonly notFound: boolean
}

// Internal entries erase the per-route typed error channel; the public
// `MatchState<R>` keeps it precise, and casts happen only at the validated
// boundary over this router's own route set.
type ErasedMatch = Omit<MatchState<Route.Any>, "result"> & {
  readonly result: AsyncResult.AsyncResult<ErasedResolved, unknown>
}

type ErasedIncoming = Result.Result<IncomingRoute<Route.Any>, Route.RouteDecodeError>
type ErasedResolved = ResolvedRoute<Route.Any>
type ErasedError = NavigationError<ReadonlyArray<Route.Any>>

interface Snapshot<Routes extends ReadonlyArray<Route.Any>> {
  readonly active: TransitionId
  readonly branch: Branch<Routes, never>
  readonly leaf: AsyncResult.AsyncResult<Resolved<Routes>, NavigationError<Routes>>
  readonly operation: AsyncResult.AsyncResult<void, NavigationError<Routes>>
  readonly operationTick: number
}

interface Engine<Routes extends ReadonlyArray<Route.Any>> {
  readonly snapshot: SubscriptionRef.SubscriptionRef<Snapshot<Routes>>
  readonly dispatch: (command: Command<Routes>) => Effect.Effect<
    Option.Option<Fiber.Fiber<Resolved<Routes>, NavigationError<Routes>>>,
    NavigationError<Routes>
  >
  readonly awaitInitial: Effect.Effect<void, NavigationError<Routes>>
}

let transitionSequence = 0

const makeTransitionId = (): TransitionId => ({
  _tag: "@effect-stack/router/TransitionId",
  sequence: (transitionSequence += 1)
})

// Monotonic across engines so `Atom.Reset` boundaries remain meaningful after
// a runtime rebuild.
let operationEpoch = 0

const emptyBranch = <Routes extends ReadonlyArray<Route.Any>>(transitionId: TransitionId): Branch<Routes, never> => ({
  transitionId,
  location: Option.none(),
  notFound: false,
  result: AsyncResult.initial(true),
  lastSuccess: Option.none(),
  matches: []
})

const routeLoadError = <R extends Route.Any>(route: R, error: Route.Route.LoadError<R>): LoadFailure<R> =>
  new RouteLoadError({ routeId: route.id, error }) as LoadFailure<R>

const validateRoutes = (routes: ReadonlyArray<Route.Any>): Result.Result<void, RouterConfigurationError> => {
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const route of routes) {
    if (ids.has(route.id)) {
      return Result.fail(new RouterConfigurationError({ message: `Duplicate route id: ${route.id}` }))
    }
    if (paths.has(route.path)) {
      return Result.fail(new RouterConfigurationError({ message: `Duplicate route path: ${route.path}` }))
    }
    ids.add(route.id)
    paths.add(route.path)
  }
  return Result.succeed(undefined)
}

const pathSegments = (path: string): ReadonlyArray<string> => path === "/" ? [] : path.slice(1).split("/")

const structurallyMatches = (route: Route.Any, pathname: string): boolean => {
  const expected = pathSegments(route.path)
  const actual = pathSegments(pathname)
  if (expected.length !== actual.length) {
    return false
  }
  return expected.every((segment, index) => {
    if (segment.startsWith(":")) {
      return true
    }
    try {
      return decodeURIComponent(actual[index]) === segment
    } catch {
      // Malformed encoding is reported by the route's own decoder.
      return true
    }
  })
}

const incomingFromMatch = (matched: Route.Match<Route.Any>): IncomingRoute<Route.Any> => ({
  route: matched.route,
  params: matched.params,
  search: matched.search,
  hash: matched.hash
})

const matchFromIncoming = (incoming: IncomingRoute<Route.Any>): Route.Match<Route.Any> => ({
  id: incoming.route.id,
  route: incoming.route,
  params: incoming.params,
  search: incoming.search,
  hash: incoming.hash
})

const planFlatRoutes = (routes: ReadonlyArray<Route.Any>, location: History.Location): NavigationPlan => {
  for (const route of routes) {
    if (!structurallyMatches(route, location.pathname)) {
      continue
    }
    const matched = Route.match(route, location)
    if (Result.isFailure(matched)) {
      return { notFound: false, entries: [{ route, incoming: Result.fail(matched.failure) }] }
    }
    if (Option.isNone(matched.success)) {
      continue
    }
    return { notFound: false, entries: [{ route, incoming: Result.succeed(incomingFromMatch(matched.success.value)) }] }
  }
  return { notFound: true, entries: [] }
}

const planTreeRoutes = (compiled: RouteTree.Compiled, location: History.Location): NavigationPlan => {
  const planned = compiled.plan(location)
  return {
    notFound: planned.notFound,
    entries: planned.entries.map((entry) => ({
      route: entry.route,
      incoming: Result.map(entry.match, incomingFromMatch)
    }))
  }
}

// Structural comparison for decoded URL values, falling back to reference
// equality for values Effect's `Equal` does not recognize.
const sameSelectedValue = (left: unknown, right: unknown): boolean =>
  Object.is(left, right) || Equal.equals(left as Equal.Equal, right as Equal.Equal)

const sameIncoming = (left: ErasedIncoming, right: ErasedIncoming): boolean => {
  if (Result.isFailure(left) || Result.isFailure(right)) {
    if (Result.isFailure(left) && Result.isFailure(right)) {
      return left.failure.routeId === right.failure.routeId && left.failure.part === right.failure.part &&
        left.failure.input === right.failure.input && left.failure.message === right.failure.message
    }
    return false
  }
  const a = left.success
  const b = right.success
  return a.route === b.route && sameSelectedValue(a.params, b.params) && sameSelectedValue(a.search, b.search) &&
    sameSelectedValue(a.hash, b.hash)
}

const withoutWaiting = <A, E>(result: AsyncResult.AsyncResult<A, E>): AsyncResult.AsyncResult<A, E> => {
  if (!result.waiting) {
    return result
  }
  switch (result._tag) {
    case "Initial":
      return AsyncResult.initial(false)
    case "Success":
      return AsyncResult.success(result.value)
    case "Failure":
      return AsyncResult.failure(result.cause, { previousSuccess: result.previousSuccess })
  }
}

const joinVoid = <A, E>(fiber: Fiber.Fiber<A, E>): Effect.Effect<void, E> => Fiber.join(fiber).pipe(Effect.asVoid)

// v4 resumes a caller's continuation after an eager `FiberMap.run` fork from a
// deferred scheduler turn, so a caller could otherwise be interrupted between
// the transition starting and the caller observing it. Dispatch, map
// installation (inside the engine's uninterruptible acceptance section), and
// this abort finalizer registration are atomic with respect to the caller.
const dispatchAndJoin = <Routes extends ReadonlyArray<Route.Any>>(
  engine: Engine<Routes>,
  command: Command<Routes>
): Effect.Effect<void, NavigationError<Routes>> =>
  Effect.scoped(Effect.gen(function*() {
    const fiber = yield* Effect.uninterruptible(Effect.gen(function*() {
      const started = yield* engine.dispatch(command)
      if (Option.isSome(started)) {
        yield* Effect.addFinalizer(() => Fiber.interrupt(started.value))
      }
      return started
    }))
    if (Option.isSome(fiber)) {
      yield* joinVoid(fiber.value)
    }
  }))

const loadMatch = Effect.fn("Router.loadMatch")(function*<Routes extends ReadonlyArray<Route.Any>>(
  matched: Route.Match<RouteUnion<Routes>>,
  location: History.Location
): Effect.fn.Return<
  Resolved<Routes>,
  NavigationError<Routes>,
  Scope.Scope | Route.Route.Services<RouteUnion<Routes>>
> {
  const route = matched.route
  const load = route.load as
    | undefined
    | (() => Effect.Effect<
      Route.Route.Module<RouteUnion<Routes>>,
      Route.Route.LoadError<RouteUnion<Routes>>,
      Scope.Scope | Route.Route.LoadServices<RouteUnion<Routes>>
    >)
  // The match was decoded with this exact route's schemas. Erasing the route
  // tuple for iteration must not erase the loader's data/error/service union.
  const loader = route.loader as
    | undefined
    | ((
      input: Route.LoaderInput<
        Route.Route.Params<RouteUnion<Routes>>,
        Route.Route.Search<RouteUnion<Routes>>,
        Route.Route.Hash<RouteUnion<Routes>>
      >
    ) => Effect.Effect<
      Route.Route.LoaderData<RouteUnion<Routes>>,
      Route.Route.LoaderError<RouteUnion<Routes>>,
      Scope.Scope | Route.Route.LoaderServices<RouteUnion<Routes>>
    >)
  const moduleEffect = load === undefined ? Effect.void : Effect.suspend(load).pipe(
    Effect.mapError((error) => routeLoadError(route, error) as NavigationError<Routes>)
  )
  const dataEffect = loader === undefined ? Effect.void : Effect.suspend(() => loader({ ...matched, location })).pipe(
    Effect.mapError((error) => new RouteLoaderError({ routeId: route.id, error }) as NavigationError<Routes>)
  )
  const [module, loaderData] = yield* Effect.all([moduleEffect, dataEffect], { concurrency: "unbounded" })
  return {
    ...matched,
    location,
    module,
    loaderData
  } as Resolved<Routes>
})

const makeEngine = Effect.fn("Router.makeEngine")(function*<Routes extends ReadonlyArray<Route.Any>>(
  routes: Routes,
  compiled?: RouteTree.Compiled
): Effect.fn.Return<
  Engine<Routes>,
  RouterConfigurationError | History.HistoryError,
  History.Service | Scope.Scope | Route.Route.Services<RouteUnion<Routes>>
> {
  if (compiled === undefined) yield* Effect.fromResult(validateRoutes(routes))
  const history = yield* History.Service
  const services = yield* Effect.context<History.Service | Route.Route.Services<RouteUnion<Routes>>>()
  const opening = makeTransitionId()
  const snapshot = yield* SubscriptionRef.make<Snapshot<Routes>>({
    active: opening,
    branch: emptyBranch(opening),
    leaf: AsyncResult.initial(true),
    operation: AsyncResult.initial(true),
    operationTick: 0
  })
  const transitions = yield* FiberMap.make<"navigation", Resolved<Routes>, NavigationError<Routes>>()
  // v4's `FiberMap.run` forks eagerly and installs the fiber in the map from a
  // deferred continuation, so two concurrent acceptances could both see an
  // empty map and orphan the older transition. The acceptance section (active
  // token swap + fork/map install) therefore runs under a mutex and
  // uninterruptibly, making supersession ordering deterministic.
  const startLock = yield* Semaphore.make(1)
  const erased = (branch: Branch<Routes, never>): ReadonlyArray<ErasedMatch> =>
    branch.matches as unknown as ReadonlyArray<ErasedMatch>
  const withOperation = (
    current: Snapshot<Routes>,
    operation: AsyncResult.AsyncResult<void, NavigationError<Routes>>
  ): Snapshot<Routes> => ({ ...current, operation, operationTick: (operationEpoch += 1) })

  const guarded = Effect.fn("Router.guarded")(function*(
    transition: TransitionId,
    update: (current: Snapshot<Routes>) => Snapshot<Routes>
  ) {
    yield* SubscriptionRef.update(snapshot, (current) => current.active === transition ? update(current) : current)
  })

  // Acceptance publishes every planned entry's decoded input and a fresh
  // waiting state before any module or data loader starts. Every rerun reuses
  // the stable decoded input object when the navigation input is unchanged,
  // but the per-route loading state is always truthful for the new transition.
  const accept = Effect.fn("Router.accept")(function*(
    transition: TransitionId,
    location: History.Location,
    plan: NavigationPlan
  ) {
    yield* guarded(transition, (current) => {
      const previous = erased(current.branch)
      const matches = plan.entries.map((entry): ErasedMatch => {
        const last = previous.find((candidate) => candidate.routeId === entry.route.id)
        const incoming = last !== undefined && sameIncoming(last.incoming, entry.incoming)
          ? last.incoming
          : entry.incoming
        const retained = last === undefined
          ? Option.none<ErasedResolved>()
          : Option.orElse(AsyncResult.value(last.result), () => last.retained)
        return {
          routeId: entry.route.id,
          route: entry.route,
          transitionId: transition,
          incoming,
          result: AsyncResult.waitingFrom(last === undefined ? Option.none() : Option.some(last.result)),
          retained
        }
      })
      return {
        ...current,
        branch: {
          transitionId: transition,
          location: Option.some(location),
          notFound: plan.notFound,
          result: AsyncResult.waitingFrom(Option.some(current.branch.result)),
          lastSuccess: current.branch.lastSuccess,
          matches: matches as unknown as ReadonlyArray<MatchStates<Routes>>
        }
      }
    })
  })

  // Each entry settles independently; untouched entries keep their identity
  // while other entries are still loading.
  const commitEntry = Effect.fn("Router.commitEntry")(function*(
    transition: TransitionId,
    index: number,
    exit: Exit.Exit<ErasedResolved, unknown>
  ) {
    yield* guarded(transition, (current) => {
      const previous = erased(current.branch)
      if (index >= previous.length) {
        return current
      }
      const matches = previous.map((entry, i): ErasedMatch => {
        if (i !== index) {
          return entry
        }
        return {
          routeId: entry.routeId,
          route: entry.route,
          transitionId: transition,
          incoming: entry.incoming,
          result: AsyncResult.fromExitWithPrevious(exit, Option.some(entry.result)),
          retained: Exit.isSuccess(exit) ? Option.some(exit.value) : entry.retained
        }
      })
      return {
        ...current,
        branch: { ...current.branch, matches: matches as unknown as ReadonlyArray<MatchStates<Routes>> }
      }
    })
  })

  const commitOperation = Effect.fn("Router.commitOperation")(function*(failure: ErasedError | undefined) {
    const result: AsyncResult.AsyncResult<void, NavigationError<Routes>> = failure === undefined
      ? AsyncResult.success(undefined)
      : AsyncResult.fail(failure) as AsyncResult.AsyncResult<void, NavigationError<Routes>>
    yield* SubscriptionRef.update(snapshot, (current) => withOperation(current, result))
  })

  const settle = Effect.fn("Router.settle")(function*(
    transition: TransitionId,
    exit: Exit.Exit<Resolved<Routes>, NavigationError<Routes>>
  ) {
    yield* guarded(transition, (current) => {
      const previous = erased(current.branch)
      const matches = previous.map((entry): ErasedMatch => {
        const result = withoutWaiting(entry.result)
        if (result === entry.result) {
          return entry
        }
        return {
          routeId: entry.routeId,
          route: entry.route,
          transitionId: entry.transitionId,
          incoming: entry.incoming,
          result,
          retained: entry.retained
        }
      })
      const settled = AsyncResult.fromExitWithPrevious(exit, Option.some(current.leaf))
      const operation = settled as unknown as AsyncResult.AsyncResult<void, NavigationError<Routes>>
      const location = current.branch.location
      const lastSuccess = Exit.isSuccess(exit) && Option.isSome(location)
        ? Option.some<SuccessfulBranch<Routes>>({
          transitionId: transition,
          location: location.value,
          matches: matches.flatMap((entry) =>
            AsyncResult.isSuccess(entry.result) ? [entry.result.value] : []
          ) as unknown as ReadonlyArray<Resolved<Routes>>
        })
        : current.branch.lastSuccess
      // The operation revision advances only on dispatch/acceptance (start,
      // commitOperation). Settlement keeps the accepted operation's tick, so a
      // reset written while an operation was in flight remains in effect after
      // that same operation settles.
      return {
        ...current,
        branch: {
          transitionId: transition,
          location: current.branch.location,
          notFound: current.branch.notFound,
          result: operation,
          lastSuccess,
          matches: matches as unknown as ReadonlyArray<MatchStates<Routes>>
        },
        leaf: settled,
        operation
      }
    })
  })

  const start = Effect.fn("Router.start")(function*(
    transition: TransitionId,
    work: Effect.Effect<
      Resolved<Routes>,
      NavigationError<Routes>,
      Scope.Scope | Route.Route.Services<RouteUnion<Routes>>
    >
  ) {
    const provided = work.pipe(
      Effect.scoped,
      Effect.provide(services),
      Effect.onExit((exit) => settle(transition, exit))
    )
    return yield* startLock.withPermits(1)(
      Effect.uninterruptible(Effect.gen(function*() {
        yield* SubscriptionRef.update(snapshot, (current) =>
          withOperation({
            ...current,
            active: transition,
            leaf: AsyncResult.waitingFrom(Option.some(current.leaf))
          }, AsyncResult.waitingFrom(Option.some(current.operation))))
        return yield* FiberMap.run(transitions, "navigation", provided, { startImmediately: true })
      }))
    )
  })

  const navigateTo = Effect.fn("Router.navigateTo")(function*(
    transition: TransitionId,
    location: History.Location
  ): Effect.fn.Return<
    Resolved<Routes>,
    NavigationError<Routes>,
    Scope.Scope | Route.Route.Services<RouteUnion<Routes>>
  > {
    const plan = compiled === undefined ? planFlatRoutes(routes, location) : planTreeRoutes(compiled, location)
    yield* accept(transition, location, plan)
    const results = yield* Effect.forEach(plan.entries, (entry, index) => {
      // The plan only returns members of this validated route set.
      const work: Effect.Effect<
        Resolved<Routes>,
        NavigationError<Routes>,
        Scope.Scope | Route.Route.Services<RouteUnion<Routes>>
      > = Result.isFailure(entry.incoming)
        ? Effect.fail(entry.incoming.failure as NavigationError<Routes>)
        : loadMatch<Routes>(matchFromIncoming(entry.incoming.success) as Route.Match<RouteUnion<Routes>>, location)
      return work.pipe(
        Effect.scoped,
        Effect.onExit((exit) => commitEntry(transition, index, exit))
      )
    })
    if (plan.notFound || results.length === 0) {
      return yield* new RouteNotFound({
        pathname: location.pathname,
        search: location.search,
        hash: location.hash
      })
    }
    return results[results.length - 1]
  })

  // Erased once for dispatching; the public `Command<Routes>` retains each
  // route's correlated input, while the runtime only needs the member union.
  const dispatch = Effect.fn("Router.dispatch")(function*(input: Command<Routes>) {
    const command = input as unknown as Command<ReadonlyArray<Route.Any>>
    switch (command._tag) {
      case "To": {
        const href = yield* Effect.fromResult(Route.href(command.route, command.input))
        const destination = History.destinationFromHref(href, command.state)
        const transition = makeTransitionId()
        const work = (command.replace ? history.replace(destination) : history.push(destination)).pipe(
          Effect.flatMap((location) => navigateTo(transition, location))
        )
        return Option.some(yield* start(transition, work))
      }
      case "Back":
        yield* history.go(-1)
        yield* commitOperation(undefined)
        return Option.none()
      case "Forward":
        yield* history.go(1)
        yield* commitOperation(undefined)
        return Option.none()
      case "Go":
        yield* history.go(command.delta)
        yield* commitOperation(undefined)
        return Option.none()
      case "Refresh": {
        const transition = makeTransitionId()
        const work = history.current.pipe(Effect.flatMap((location) => navigateTo(transition, location)))
        return Option.some(yield* start(transition, work))
      }
    }
  })

  yield* history.changes.pipe(
    Stream.runForEach((location) => {
      const transition = makeTransitionId()
      return start(transition, navigateTo(transition, location)).pipe(Effect.asVoid)
    }),
    Effect.catch((error) =>
      SubscriptionRef.update(snapshot, (current) => {
        const withFailedOperation = withOperation(
          current,
          AsyncResult.failWithPrevious(error, {
            previous: Option.some(current.operation)
          })
        )
        return {
          ...withFailedOperation,
          leaf: AsyncResult.failWithPrevious(error, { previous: Option.some(current.leaf) })
        }
      })
    ),
    Effect.forkScoped
  )

  const initial = yield* history.current
  const initialFiber = yield* start(opening, navigateTo(opening, initial))

  return {
    snapshot,
    awaitInitial: joinVoid(initialFiber),
    dispatch: (command) =>
      dispatch(command).pipe(
        Effect.tapError((failure) => commitOperation(failure)),
        Effect.map((fiber) => fiber as Option.Option<Fiber.Fiber<Resolved<Routes>, NavigationError<Routes>>>)
      )
  }
})

// --- atom-facing surface ---

const sameOptionBy =
  <A>(equals: (left: A, right: A) => boolean) => (left: Option.Option<A>, right: Option.Option<A>): boolean => {
    if (Option.isSome(left) && Option.isSome(right)) {
      return equals(left.value, right.value)
    }
    return Option.isNone(left) && Option.isNone(right)
  }

const sameReference = <A>(left: A, right: A): boolean => left === right

/**
 * Creates a renderer-neutral router whose scoped dependencies are supplied by
 * a Layer. The layer must provide History and every service required by lazy
 * route modules and data loaders.
 *
 * @since 0.1.0
 * @category constructors
 */
const makeRuntime = <
  const Routes extends ReadonlyArray<Route.Any>,
  LayerError
>(options: {
  readonly routes: Routes
  readonly layer: Layer.Layer<History.Service | Route.Route.Services<RouteUnion<Routes>>, LayerError>
  readonly compiled?: RouteTree.Compiled
}): Router<Routes, LayerError> => {
  const runtime = Atom.runtime(options.layer)
  const engine = runtime.atom(makeEngine(options.routes, options.compiled))
  const snapshotView = runtime.subscriptionRef((get) =>
    get.result(engine).pipe(
      Effect.map((value) => value.snapshot)
    )
  )
  const fallbackTransition = makeTransitionId()
  // The operation epoch observed when `Atom.Reset` was last written;
  // operations at or before this boundary project as `Initial`.
  const resetBoundary = Atom.make(0)

  const unwrap = <A, E>(result: AsyncResult.AsyncResult<A, E>): AsyncResult.AsyncResult<void, E> => {
    switch (result._tag) {
      case "Initial":
        return AsyncResult.initial(result.waiting)
      case "Failure":
        return AsyncResult.failure(result.cause, { waiting: result.waiting })
      case "Success":
        return AsyncResult.success(undefined, { waiting: result.waiting })
    }
  }

  const state = Atom.make((get): AsyncResult.AsyncResult<Resolved<Routes>, NavigationError<Routes> | LayerError> => {
    const result = get(snapshotView)
    if (result._tag === "Success") {
      return result.value.leaf
    }
    if (result._tag === "Failure") {
      return AsyncResult.failure(result.cause, { waiting: result.waiting })
    }
    return AsyncResult.initial(result.waiting)
  })

  const branch = Atom.make((get): Branch<Routes, LayerError> => {
    const result = get(snapshotView)
    if (result._tag === "Success") {
      return result.value.branch
    }
    return {
      ...emptyBranch<Routes>(fallbackTransition),
      result: unwrap(result),
      location: Option.none(),
      lastSuccess: Option.none(),
      matches: []
    }
  })

  const completed = Atom.map(branch, (value) => value.lastSuccess)

  // Command intake shared by `navigate` writes; writing before the engine is
  // ready queues the command, and its per-call result is superseded by the
  // engine's authoritative operation projection. Cancelling a submission
  // (a new command, `Atom.Interrupt`, `Atom.Reset`, or atom teardown)
  // interrupts and finalizes the exact transition it started, mirroring
  // `execute`.
  const submitted = runtime.fn((command: Command<Routes>, get) =>
    get.result(engine).pipe(
      Effect.flatMap((value) => dispatchAndJoin(value, command))
    )
  )

  const navigate: Atom.AtomResultFn<Command<Routes>, void, NavigationError<Routes> | LayerError> = Atom.writable(
    (get): AsyncResult.AsyncResult<void, NavigationError<Routes> | LayerError> => {
      const submission = get(submitted)
      const result = get(snapshotView)
      if (result._tag === "Success") {
        if (result.value.operationTick <= get(resetBoundary)) {
          return AsyncResult.initial()
        }
        return result.value.operation
      }
      if (submission._tag === "Failure") {
        return submission
      }
      if (result._tag === "Failure") {
        return AsyncResult.failure(result.cause, { waiting: result.waiting })
      }
      return submission
    },
    (ctx, value) => {
      if (value === Atom.Reset) {
        const snapshot = ctx.get(snapshotView)
        ctx.set(resetBoundary, snapshot._tag === "Success" ? snapshot.value.operationTick : 0)
      }
      ctx.set(submitted, value)
    }
  )

  const execute = (command: Command<Routes>): Effect.Effect<
    void,
    NavigationError<Routes> | LayerError,
    AtomRegistry.AtomRegistry
  > =>
    Effect.scoped(Effect.gen(function*() {
      const registry = yield* AtomRegistry.AtomRegistry
      // Retain the scoped engine for the whole operation so headless callers
      // (no other atom mounted) never lose a running transition to eviction.
      yield* AtomRegistry.mount(registry, engine)
      const value = yield* AtomRegistry.getResult(registry, engine, { suspendOnWaiting: true })
      yield* dispatchAndJoin(value, command)
    }))

  const retry: Effect.Effect<void, NavigationError<Routes> | LayerError, AtomRegistry.AtomRegistry> = Effect.scoped(
    Effect.gen(function*() {
      const registry = yield* AtomRegistry.AtomRegistry
      yield* AtomRegistry.mount(registry, engine)
      const settled = yield* AtomRegistry.getResult(registry, engine, { suspendOnWaiting: true }).pipe(Effect.exit)
      if (Exit.isSuccess(settled)) {
        // Healthy runtime: re-dispatch the current location.
        yield* dispatchAndJoin(settled.value, refresh as Command<Routes>)
        return
      }
      // Failed Layer/runtime/engine: refresh the runtime so its scoped Layer
      // re-executes, then await the rebuilt engine's own initial transition.
      registry.refresh(engine)
      registry.refresh(runtime)
      const value = yield* AtomRegistry.getResult(registry, engine, { suspendOnWaiting: true })
      yield* value.awaitInitial
    })
  )

  const routeAtomsCache = new Map<string, RouteAtoms<Route.Any>>()

  const createRouteAtoms = <R extends RouteUnion<Routes>>(route: R): RouteAtoms<R> => {
    const entry = (get: Atom.AtomContext): Option.Option<MatchState<R>> => {
      const result = get(snapshotView)
      if (result._tag !== "Success") {
        return Option.none()
      }
      const matches = result.value.branch.matches as unknown as ReadonlyArray<ErasedMatch>
      const match = matches.find((candidate) => candidate.routeId === route.id)
      return match === undefined ? Option.none() : Option.some(match as unknown as MatchState<R>)
    }
    const stateAtom = Atom.make(entry).pipe(
      Atom.withEquality<Option.Option<MatchState<R>>>(sameOptionBy(sameReference))
    )
    const incoming = Atom.make(
      (get): Option.Option<Result.Result<IncomingRoute<R>, Route.RouteDecodeError>> =>
        Option.map(get(stateAtom), (value) => value.incoming)
    ).pipe(
      Atom.withEquality<Option.Option<Result.Result<IncomingRoute<R>, Route.RouteDecodeError>>>(
        sameOptionBy((left, right) =>
          left === right || sameIncoming(left as unknown as ErasedIncoming, right as unknown as ErasedIncoming)
        )
      )
    )
    const params = Atom.make((get): Option.Option<Route.Route.Params<R>> =>
      Option.flatMap(
        get(incoming),
        (value) => Result.isSuccess(value) ? Option.some(value.success.params) : Option.none()
      )
    ).pipe(Atom.withEquality<Option.Option<Route.Route.Params<R>>>(sameOptionBy(sameSelectedValue)))
    const search = Atom.make((get): Option.Option<Route.Route.Search<R>> =>
      Option.flatMap(
        get(incoming),
        (value) => Result.isSuccess(value) ? Option.some(value.success.search) : Option.none()
      )
    ).pipe(Atom.withEquality<Option.Option<Route.Route.Search<R>>>(sameOptionBy(sameSelectedValue)))
    const resolved = Atom.make((get): Option.Option<ResolvedRoute<R>> => {
      const current = get(stateAtom)
      if (Option.isNone(current)) {
        return Option.none()
      }
      const value = current.value
      return AsyncResult.isSuccess(value.result) ? Option.some(value.result.value) : value.retained
    }).pipe(Atom.withEquality<Option.Option<ResolvedRoute<R>>>(sameOptionBy(sameReference)))
    return { route, state: stateAtom, incoming, params, search, resolved }
  }

  const routeAtoms = <R extends RouteUnion<Routes>>(route: R): RouteAtoms<R> => {
    const cached = routeAtomsCache.get(route.id)
    if (cached !== undefined) {
      return cached as RouteAtoms<R>
    }
    const created = createRouteAtoms(route)
    routeAtomsCache.set(route.id, created)
    return created
  }

  return {
    routes: options.routes,
    state,
    navigate,
    branch,
    completed,
    href: Route.href,
    compiled: options.compiled,
    execute,
    retry,
    routeAtoms
  }
}

/** Creates a flat router. @since 0.1.0 */
export const make = <const Routes extends ReadonlyArray<Route.Any>, LayerError>(options: {
  readonly routes: Routes
  readonly layer: Layer.Layer<History.Service | Route.Route.Services<Routes[number]>, LayerError>
}): Router<Routes, LayerError> => makeRuntime(options)

/**
 * Creates a nested router from a route tree. The compiled tree is validated
 * once and cached by root identity, so adapters may call `RouteTree.compile`
 * themselves and share the same value.
 *
 * @since 0.2.0
 */
export const fromTree = <T extends RouteTree.Any, LayerError>(options: {
  readonly routeTree: T
  readonly layer: Layer.Layer<History.Service | Route.Route.Services<RouteTree.All<T>>, LayerError>
}): Router<ReadonlyArray<RouteTree.All<T>>, LayerError> => {
  const compiled = RouteTree.compile(options.routeTree)
  return makeRuntime({
    routes: compiled.routes as ReadonlyArray<RouteTree.All<T>>,
    layer: options.layer,
    compiled
  })
}

/**
 * Creates a typed push command.
 *
 * @since 0.1.0
 * @category navigation
 */
export const push = <R extends Route.Any>(route: R, input: Route.Route.Input<R>, state?: unknown): To<R> => ({
  _tag: "To",
  route,
  input,
  replace: false,
  ...(state === undefined ? {} : { state })
})

/**
 * Creates a typed replace command.
 *
 * @since 0.1.0
 * @category navigation
 */
export const replace = <R extends Route.Any>(route: R, input: Route.Route.Input<R>, state?: unknown): To<R> => ({
  _tag: "To",
  route,
  input,
  replace: true,
  ...(state === undefined ? {} : { state })
})

/** @since 0.1.0 @category navigation */
export const back = { _tag: "Back" } as const

/** @since 0.1.0 @category navigation */
export const forward = { _tag: "Forward" } as const

/** @since 0.1.0 @category navigation */
export const go = (delta: number): { readonly _tag: "Go"; readonly delta: number } => ({ _tag: "Go", delta })

/** @since 0.1.0 @category navigation */
export const refresh = { _tag: "Refresh" } as const
