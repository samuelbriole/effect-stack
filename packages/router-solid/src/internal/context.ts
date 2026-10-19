import type { AtomRouter } from "@effect-stack/router/AtomRouter"
import { RouteDefinitionError, type RouterService } from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-solid"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { createContext, type Accessor, useContext } from "solid-js"
import type { ResolvedViewOptions, ViewComponent } from "./route.ts"

/** @since 0.4.0 */
export interface RouterContextValue {
  readonly atomRouter: AtomRouter<unknown>
  readonly views: ReadonlyMap<string, ResolvedViewOptions>
  readonly pending: ViewComponent
}

/** @since 0.4.0 */
export const RouterContext = createContext<Accessor<RouterContextValue>>()
/** @since 0.4.0 */
export const DepthContext = createContext<Accessor<number>>()

/** @since 0.4.0 */
export function useRouterContextAccessor(app?: { readonly token: object }): Accessor<RouterContextValue> {
  const value = useContext(RouterContext)
  if (value === undefined) throw new Error("Router hooks require a router provider")
  return () => {
    const context = value()
    if (app !== undefined && (context.atomRouter.app as { readonly token: object }).token !== app.token) {
      throw new RouteDefinitionError({
        message: "This bound router helper belongs to a different application than the active provider"
      })
    }
    return context
  }
}

/** @since 0.4.0 */
export function useRouterService(app?: { readonly token: object }): Accessor<RouterService<unknown, unknown>> {
  const context = useRouterContextAccessor(app)
  const result = useAtomValue(() => context().atomRouter.service)
  return () => {
    context()
    const value = result()
    if (!AsyncResult.isSuccess(value) || value.waiting) throw new Error("Router service is not available yet")
    return value.value as unknown as RouterService<unknown, unknown>
  }
}
