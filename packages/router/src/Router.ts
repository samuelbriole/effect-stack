/**
 * Scoped navigation runtime exposed through Effect Atom.
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberMap from "effect/FiberMap"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
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

export class RouteLoadError<Id extends string, Error> extends RouteLoadErrorBase {
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

/** A route's current loading or rendering input. @since 0.2.0 */
export interface MatchState {
  readonly route: Route.Any
  readonly result: AsyncResult.AsyncResult<ResolvedRoute<Route.Any>, unknown>
}

/** Incoming match state. Only the current navigation may publish into it. @since 0.2.0 */
export interface Branch {
  readonly matches: ReadonlyArray<MatchState>
  readonly notFound: boolean
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

type LoadFailure<R extends Route.Any> = Route.Route.LoadError<R> extends never ? never
  : RouteLoadError<R["id"], Route.Route.LoadError<R>>

type LoaderFailure<R extends Route.Any> = Route.Route.LoaderError<R> extends never ? never
  : RouteLoaderError<R["id"], Route.Route.LoaderError<R>>

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

type ToUnion<Routes extends ReadonlyArray<Route.Any>> = {
  readonly [Index in keyof Routes]: Routes[Index] extends Route.Any ? To<Routes[Index]> : never
}[number]

/**
 * Commands accepted by a router's navigation atom.
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
 * The headless router interface shared by all renderers.
 *
 * @since 0.1.0
 * @category models
 */
export interface Router<Routes extends ReadonlyArray<Route.Any>, LayerError> {
  readonly routes: Routes
  readonly state: Atom.Atom<AsyncResult.AsyncResult<Resolved<Routes>, NavigationError<Routes> | LayerError>>
  readonly navigate: Atom.AtomResultFn<Command<Routes>, void, NavigationError<Routes> | LayerError>
  readonly branch: Atom.Atom<Branch>
  readonly href: <R extends RouteUnion<Routes>>(
    route: R,
    input: Route.Route.Input<R>
  ) => Result.Result<string, Route.RouteEncodeError>
}

interface Engine<Routes extends ReadonlyArray<Route.Any>> {
  readonly state: SubscriptionRef.SubscriptionRef<AsyncResult.AsyncResult<Resolved<Routes>, NavigationError<Routes>>>
  readonly dispatch: (command: Command<Routes>) => Effect.Effect<void, NavigationError<Routes>>
  readonly branch: SubscriptionRef.SubscriptionRef<Branch>
}

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

const resolve = Effect.fn("Router.resolve")(function*<Routes extends ReadonlyArray<Route.Any>>(
  routes: Routes,
  location: History.Location
): Effect.fn.Return<Resolved<Routes>, NavigationError<Routes>, Scope.Scope | Route.Route.Services<RouteUnion<Routes>>> {
  for (const route of routes) {
    const result = Route.match(route, location)
    if (Result.isFailure(result)) return yield* result.failure
    if (Option.isSome(result.success)) return yield* loadMatch<Routes>(result.success.value, location)
  }

  return yield* new RouteNotFound({
    pathname: location.pathname,
    search: location.search,
    hash: location.hash
  })
})

const makeEngine = Effect.fn("Router.makeEngine")(function*<Routes extends ReadonlyArray<Route.Any>>(
  routes: Routes,
  treeRoutes?: ReadonlyArray<RouteTree.Any>
): Effect.fn.Return<
  Engine<Routes>,
  RouterConfigurationError | History.HistoryError,
  History.Service | Scope.Scope | Route.Route.Services<RouteUnion<Routes>>
> {
  if (treeRoutes === undefined) yield* Effect.fromResult(validateRoutes(routes))
  const history = yield* History.Service
  const services = yield* Effect.context<History.Service | Route.Route.Services<RouteUnion<Routes>>>()
  const state = yield* SubscriptionRef.make<AsyncResult.AsyncResult<Resolved<Routes>, NavigationError<Routes>>>(
    AsyncResult.initial(true)
  )
  const generation = yield* Ref.make(0)
  const branch = yield* SubscriptionRef.make<Branch>({ matches: [], notFound: false })
  const transitions = yield* FiberMap.make<"navigation", Resolved<Routes>, NavigationError<Routes>>()

  const resolveLocation = Effect.fn("Router.resolveLocation")(
    function*(
      location: History.Location
    ): Effect.fn.Return<
      Resolved<Routes>,
      NavigationError<Routes>,
      Scope.Scope | Route.Route.Services<RouteUnion<Routes>>
    > {
      if (treeRoutes === undefined) return yield* resolve(routes, location)
      const token = yield* Ref.get(generation)
      const planned = RouteTree.plan(treeRoutes, location)
      const previous = yield* SubscriptionRef.get(branch)
      yield* SubscriptionRef.set(branch, {
        matches: planned.entries.map(({ route }) => ({
          route,
          result: AsyncResult.waitingFrom(
            Option.fromUndefinedOr(previous.matches.find((entry) => entry.route.id === route.id)?.result)
          )
        })),
        notFound: planned.notFound
      })
      const results = yield* Effect.forEach(planned.entries, ({ route, match }, index) => {
        // The planner only returns members of this validated route tree.
        const work = Result.isFailure(match) ? Effect.fail(match.failure) : loadMatch<Routes>(match.success, location)
        return work.pipe(
          Effect.scoped,
          Effect.onExit((exit) =>
            Effect.gen(function*() {
              if (token !== (yield* Ref.get(generation))) return
              if (exit._tag === "Failure" && Cause.hasInterruptsOnly(exit.cause)) return
              yield* SubscriptionRef.update(
                branch,
                (current) => ({
                  ...current,
                  matches: current.matches.map((entry, i) =>
                    i === index ? { route, result: AsyncResult.fromExit(exit) } : entry
                  )
                })
              )
            })
          )
        )
      })
      if (planned.notFound || results.length === 0) return yield* new RouteNotFound(location)
      return results[results.length - 1]
    }
  )

  const publish = Effect.fn("Router.publish")(function*(
    token: number,
    previous: AsyncResult.AsyncResult<Resolved<Routes>, NavigationError<Routes>>,
    exit: Exit.Exit<Resolved<Routes>, NavigationError<Routes>>
  ) {
    const current = yield* Ref.get(generation)
    if (current !== token) {
      return
    }
    yield* SubscriptionRef.set(
      state,
      AsyncResult.fromExitWithPrevious(exit, Option.some(previous))
    )
  })

  const start = Effect.fn("Router.start")(function*(
    transition: Effect.Effect<
      Resolved<Routes>,
      NavigationError<Routes>,
      Scope.Scope | Route.Route.Services<RouteUnion<Routes>>
    >
  ) {
    const token = yield* Ref.updateAndGet(generation, (value) => value + 1)
    const previous = yield* SubscriptionRef.get(state)
    yield* SubscriptionRef.set(state, AsyncResult.waitingFrom(Option.some(previous)))

    const provided = transition.pipe(
      Effect.scoped,
      Effect.provide(services),
      Effect.onExit((exit) => publish(token, previous, exit))
    )
    return yield* FiberMap.run(transitions, "navigation", provided, { startImmediately: true })
  })

  const startAndWait = Effect.fn("Router.startAndWait")(function*(
    transition: Effect.Effect<
      Resolved<Routes>,
      NavigationError<Routes>,
      Scope.Scope | Route.Route.Services<RouteUnion<Routes>>
    >
  ) {
    const fiber = yield* start(transition)
    return yield* Fiber.join(fiber)
  })

  const dispatch = Effect.fn("Router.dispatch")(function*(command: Command<Routes>) {
    switch (command._tag) {
      case "To": {
        const href = yield* Effect.fromResult(Route.href(command.route, command.input))
        const destination = History.destinationFromHref(href, command.state)
        const updateHistory = command.replace ? history.replace(destination) : history.push(destination)
        yield* startAndWait(updateHistory.pipe(Effect.flatMap(resolveLocation)))
        return
      }
      case "Back":
        yield* history.go(-1)
        return
      case "Forward":
        yield* history.go(1)
        return
      case "Go":
        yield* history.go(command.delta)
        return
      case "Refresh": {
        yield* startAndWait(history.current.pipe(Effect.flatMap(resolveLocation)))
        return
      }
    }
  })

  yield* history.changes.pipe(
    Stream.runForEach((location) => start(resolveLocation(location)).pipe(Effect.asVoid)),
    Effect.catch((error) =>
      SubscriptionRef.get(state).pipe(
        Effect.flatMap((previous) =>
          SubscriptionRef.set(state, AsyncResult.failWithPrevious(error, { previous: Option.some(previous) }))
        )
      )
    ),
    Effect.forkScoped
  )

  const initial = yield* history.current
  yield* start(resolveLocation(initial))

  return { state, dispatch, branch }
})

const flattenState = <A, E, LayerError>(
  outer: AsyncResult.AsyncResult<AsyncResult.AsyncResult<A, E>, LayerError>
): AsyncResult.AsyncResult<A, E | LayerError> => {
  switch (outer._tag) {
    case "Initial":
      return AsyncResult.initial(outer.waiting)
    case "Failure":
      return AsyncResult.failure(outer.cause, { waiting: outer.waiting })
    case "Success":
      return outer.value
  }
}

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
  readonly treeRoutes?: ReadonlyArray<RouteTree.Any>
}): Router<Routes, LayerError> => {
  const runtime = Atom.runtime(options.layer)
  const engine = runtime.atom(makeEngine(options.routes, options.treeRoutes))
  const stateRef = Atom.subscriptionRef((get) =>
    get.result(engine).pipe(
      Effect.map((value) => value.state)
    )
  )
  const state = Atom.make((get) => flattenState(get(stateRef)))
  const navigate = runtime.fn((command: Command<Routes>, get) =>
    get.result(engine).pipe(
      Effect.flatMap((value) => value.dispatch(command))
    )
  )
  const branchRef = Atom.subscriptionRef((get) => get.result(engine).pipe(Effect.map((value) => value.branch)))
  const branch = Atom.make((get): Branch => {
    const result = get(branchRef)
    return result._tag === "Success" ? result.value : { matches: [], notFound: false }
  })

  return {
    routes: options.routes,
    state,
    navigate,
    branch,
    href: Route.href
  }
}

/** Creates a flat router. @since 0.1.0 */
export const make = <const Routes extends ReadonlyArray<Route.Any>, LayerError>(options: {
  readonly routes: Routes
  readonly layer: Layer.Layer<History.Service | Route.Route.Services<Routes[number]>, LayerError>
}): Router<Routes, LayerError> => makeRuntime(options)

/** Creates a nested router with ranked branches. @since 0.2.0 */
export const fromTree = <T extends RouteTree.Any, LayerError>(options: {
  readonly routeTree: T
  readonly layer: Layer.Layer<History.Service | Route.Route.Services<RouteTree.All<T>>, LayerError>
}): Router<ReadonlyArray<RouteTree.All<T>>, LayerError> => {
  const routes = RouteTree.flatten(options.routeTree)
  return makeRuntime({ routes, layer: options.layer, treeRoutes: routes })
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
