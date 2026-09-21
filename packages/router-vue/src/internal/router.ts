import { BrowserHistory, type History, Route, Router, RouteTree } from "@effect-stack/router"
import { Layer, type Result } from "effect"
import { markRaw } from "vue"
import type { Register } from "../index.ts"

/** @since 0.1.0 */
export type RegisteredRouter = Register extends { readonly router: infer R } ? R : ClientRouter<RouteTree.Any, unknown>
type RegisteredTree = RegisteredRouter extends { readonly routeTree: infer T extends RouteTree.Any } ? T : RouteTree.Any
/** @since 0.1.0 */
export type Destination<T extends RouteTree.Any = RegisteredTree> = RouteTree.Destination<T>
/** @since 0.1.0 */
export interface ClientRouter<T extends RouteTree.Any, E> {
  readonly routeTree: T
  /** Compiled lookups shared with the core planner, prepared once per route tree. @since 0.2.0 */
  readonly compiled: RouteTree.Compiled<RouteTree.All<T>>
  readonly core: Router.Router<ReadonlyArray<RouteTree.All<T>>, E>
  readonly href: (destination: Destination<T>) => Result.Result<string, Route.RouteEncodeError>
}
export type RuntimeRouter = ClientRouter<RouteTree.Any, unknown>

/** Constructs a runtime from native Effect application and History Layers. @since 0.1.0 */
export function createRouter<T extends RouteTree.Any, E = never, HE = never>(
  options: {
    readonly routeTree: T
    readonly history?: Layer.Layer<History.Service, HE>
  } & ([Route.Route.Services<RouteTree.All<T>>] extends [never]
    ? { readonly layer?: Layer.Layer<never, E> }
    : { readonly layer: Layer.Layer<Route.Route.Services<RouteTree.All<T>>, E> })
): ClientRouter<T, E | HE | History.HistoryError> {
  const history: Layer.Layer<History.Service, HE | History.HistoryError> = options.history ?? BrowserHistory.layer
  // Public options require a Layer whenever the route tree requests services.
  const application = (options.layer ?? Layer.empty) as Layer.Layer<Route.Route.Services<RouteTree.All<T>>, E>
  // Compiled lookups are cached by root identity, so `fromTree` reuses this object.
  const compiled = RouteTree.compile(options.routeTree)
  const core = Router.fromTree({ routeTree: options.routeTree, layer: Layer.merge(history, application) })
  return markRaw({
    routeTree: options.routeTree,
    compiled,
    core,
    href: (destination: Destination<T>) => {
      const { route, input } = compiled.target(destination)
      return Route.href(route, input)
    }
  })
}
