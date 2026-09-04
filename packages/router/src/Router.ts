/**
 * Scoped navigation runtime exposed through Effect Atom.
 *
 * @since 0.1.0
 */
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

/**
 * No configured route matched a location.
 *
 * @since 0.1.0
 * @category errors
 */
export class RouteNotFound extends Schema.TaggedError<RouteNotFound>()("@effect-web/router/RouteNotFound", {
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
  "@effect-web/router/RouterConfigurationError",
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
export interface RouteLoadError<Id extends string, Error> {
  readonly _tag: "RouteLoadError"
  readonly routeId: Id
  readonly error: Error
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
  | (RouteUnion<Routes> extends infer R ? R extends Route.Any ? LoadFailure<R> : never : never)

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
  readonly href: <R extends RouteUnion<Routes>>(
    route: R,
    input: Route.Route.Input<R>
  ) => Result.Result<string, Route.RouteEncodeError>
}

interface Engine<Routes extends ReadonlyArray<Route.Any>> {
  readonly state: SubscriptionRef.SubscriptionRef<AsyncResult.AsyncResult<Resolved<Routes>, NavigationError<Routes>>>
  readonly dispatch: (command: Command<Routes>) => Effect.Effect<void, NavigationError<Routes>>
}

const routeLoadError = <R extends Route.Any>(route: R, error: Route.Route.LoadError<R>): LoadFailure<R> =>
  ({
    _tag: "RouteLoadError",
    routeId: route.id,
    error
  }) as LoadFailure<R>

const validateRoutes = (routes: ReadonlyArray<Route.Any>): Result.Result<void, RouterConfigurationError> => {
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const route of routes) {
    const pathParameters = [...Route.pathParameterNames(route.path)].sort()
    const schemaParameters = Object.keys(route.paramsSchema.fields).sort()
    if (
      pathParameters.length !== schemaParameters.length ||
      pathParameters.some((parameter, index) => parameter !== schemaParameters[index])
    ) {
      return Result.fail(
        new RouterConfigurationError({
          message: `Route ${route.id} path parameters (${pathParameters.join(", ")}) do not match its Schema fields (${
            schemaParameters.join(", ")
          })`
        })
      )
    }
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

const resolve = <Routes extends ReadonlyArray<Route.Any>>(
  routes: Routes,
  location: History.Location
): Effect.Effect<
  Resolved<Routes>,
  NavigationError<Routes>,
  Scope.Scope | Route.Route.LoadServices<RouteUnion<Routes>>
> =>
  Effect.gen(function*() {
    for (const route of routes) {
      const result = Route.match(route, location)
      if (Result.isFailure(result)) {
        return yield* result.failure
      }
      if (Option.isNone(result.success)) {
        continue
      }

      const matched = result.success.value
      if (route.load === undefined) {
        return {
          ...matched,
          location,
          module: undefined
        } as Resolved<Routes>
      }

      const load = route.load as () => Effect.Effect<
        Route.Route.Module<RouteUnion<Routes>>,
        Route.Route.LoadError<RouteUnion<Routes>>,
        Scope.Scope | Route.Route.LoadServices<RouteUnion<Routes>>
      >
      const module = yield* load().pipe(
        Effect.mapError((error) => routeLoadError(route, error) as NavigationError<Routes>)
      )
      return {
        ...matched,
        location,
        module
      } as Resolved<Routes>
    }

    return yield* new RouteNotFound({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash
    })
  })

const currentPrevious = <A, E>(
  state: AsyncResult.AsyncResult<A, E>
): Option.Option<AsyncResult.AsyncResult<A, E>> => Option.some(state)

const makeEngine = <Routes extends ReadonlyArray<Route.Any>>(
  routes: Routes
): Effect.Effect<
  Engine<Routes>,
  RouterConfigurationError | History.HistoryError,
  History.Service | Scope.Scope | Route.Route.LoadServices<RouteUnion<Routes>>
> =>
  Effect.gen(function*() {
    yield* Effect.fromResult(validateRoutes(routes))
    const history = yield* History.Service
    const services = yield* Effect.context<History.Service | Route.Route.LoadServices<RouteUnion<Routes>>>()
    const state = yield* SubscriptionRef.make<AsyncResult.AsyncResult<Resolved<Routes>, NavigationError<Routes>>>(
      AsyncResult.initial(true)
    )
    const generation = yield* Ref.make(0)
    const transitions = yield* FiberMap.make<"navigation", Resolved<Routes>, NavigationError<Routes>>()

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
        AsyncResult.fromExitWithPrevious(exit, currentPrevious(previous))
      )
    })

    const start = Effect.fn("Router.start")(function*(location: History.Location) {
      const token = yield* Ref.updateAndGet(generation, (value) => value + 1)
      const previous = yield* SubscriptionRef.get(state)
      yield* SubscriptionRef.set(state, AsyncResult.waitingFrom(currentPrevious(previous)))

      const transition = resolve(routes, location).pipe(
        Effect.scoped,
        Effect.provide(services),
        Effect.onExit((exit) => publish(token, previous, exit))
      )
      return yield* FiberMap.run(transitions, "navigation", transition, { startImmediately: true })
    })

    const startAndWait = Effect.fn("Router.startAndWait")(function*(location: History.Location) {
      const fiber = yield* start(location)
      return yield* Fiber.join(fiber)
    })

    const dispatch = Effect.fn("Router.dispatch")(function*(command: Command<Routes>) {
      switch (command._tag) {
        case "To": {
          const href = yield* Effect.fromResult(Route.href(command.route, command.input))
          const destination = History.destinationFromHref(href, command.state)
          const location = command.replace
            ? yield* history.replace(destination)
            : yield* history.push(destination)
          yield* startAndWait(location)
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
          const location = yield* history.current
          yield* startAndWait(location)
          return
        }
      }
    })

    yield* history.changes.pipe(
      Stream.runForEach((location) => start(location).pipe(Effect.asVoid)),
      Effect.catch((error) =>
        SubscriptionRef.get(state).pipe(
          Effect.flatMap((previous) =>
            SubscriptionRef.set(state, AsyncResult.failWithPrevious(error, { previous: currentPrevious(previous) }))
          )
        )
      ),
      Effect.forkScoped
    )

    const initial = yield* history.current
    yield* start(initial)

    return { state, dispatch }
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
 * route modules.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <
  const Routes extends ReadonlyArray<Route.Any>,
  LayerError
>(options: {
  readonly routes: Routes
  readonly layer: Layer.Layer<History.Service | Route.Route.LoadServices<RouteUnion<Routes>>, LayerError>
}): Router<Routes, LayerError> => {
  const runtime = Atom.runtime(options.layer)
  const engine = runtime.atom(makeEngine(options.routes))
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

  return {
    routes: options.routes,
    state,
    navigate,
    href: Route.href
  }
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
