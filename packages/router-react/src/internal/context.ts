import type { AtomRouter } from "@effect-stack/router/AtomRouter"
import type { CoreApplication, RouterService } from "@effect-stack/router/Router"
import { RouteDefinitionError } from "@effect-stack/router/Router"
import { RegistryContext, useAtomMount } from "@effect/atom-react"
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
 * checked when the accessor is invoked, not during render. Captured callbacks
 * therefore observe a refreshed runtime's pending or failed service instead of
 * retaining a service from an earlier acquisition.
 *
 * @since 0.4.0
 */
export function useRouterService(app?: { readonly token: object }): () => RouterService<unknown, unknown> {
  const { atomRouter } = useRouterContext(app)
  const registry = React.useContext(RegistryContext)
  useAtomMount(atomRouter.service)
  return React.useCallback(() => {
    const result = registry.get(atomRouter.service)
    if (!AsyncResult.isSuccess(result) || result.waiting) {
      throw new Error("Router service is not available yet")
    }
    return result.value as unknown as RouterService<unknown, unknown>
  }, [registry, atomRouter])
}
