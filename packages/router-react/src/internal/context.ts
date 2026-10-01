import type { AtomRouter } from "@effect-stack/router/AtomRouter"
import type { CoreApplication, RouterService } from "@effect-stack/router/Router"
import { RouteDefinitionError } from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as React from "react"
import type { ResolvedViewOptions, ViewComponent } from "./route.ts"

/** @since 0.4.0 */
export interface RouterContextValue {
  readonly atomRouter: AtomRouter<CoreApplication>
  readonly views: ReadonlyMap<string, ResolvedViewOptions>
  readonly pending: ViewComponent
}

/** @since 0.4.0 */
export const RouterContext = React.createContext<RouterContextValue | null>(null)
/** @since 0.4.0 */
export const DepthContext = React.createContext(0)

/** @since 0.4.0 */
export function useRouterContext(app?: { readonly token: object }): RouterContextValue {
  const value = React.useContext(RouterContext)
  if (value === null) throw new Error("Router hooks require a router provider")
  if (app !== undefined && value.atomRouter.app.token !== app.token) {
    throw new RouteDefinitionError({
      message: "This bound router helper belongs to a different application than the active provider"
    })
  }
  return value
}

/**
 * Returns a stable accessor for the runtime router service. Availability is
 * checked when the accessor is invoked, not during render, so a Provider can
 * render its pending or startup-failure fallback before (or without) the
 * service being ready.
 *
 * @since 0.4.0
 */
export function useRouterService(app?: { readonly token: object }): () => RouterService<unknown, unknown> {
  const { atomRouter } = useRouterContext(app)
  const result = useAtomValue(atomRouter.service)
  return React.useCallback(() => {
    if (!AsyncResult.isSuccess(result)) {
      throw new Error("Router service is not available yet")
    }
    return result.value as unknown as RouterService<unknown, unknown>
  }, [result])
}
