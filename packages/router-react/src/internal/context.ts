import type { AtomRouter } from "@effect-stack/router/AtomRouter"
import type { RouterService } from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as React from "react"
import type { ViewOptions } from "./route.ts"

/** @since 0.4.0 */
export interface RouterContextValue {
  readonly atomRouter: AtomRouter<unknown>
  readonly views: ReadonlyMap<string, ViewOptions>
}

/** @since 0.4.0 */
export const RouterContext = React.createContext<RouterContextValue | null>(null)
/** @since 0.4.0 */
export const DepthContext = React.createContext(0)

/** @since 0.4.0 */
export function useRouterContext(): RouterContextValue {
  const value = React.useContext(RouterContext)
  if (value === null) throw new Error("Router hooks require RouterProvider")
  return value
}

/** @since 0.4.0 */
export function useRouterService(): RouterService<unknown> {
  const { atomRouter } = useRouterContext()
  const result = useAtomValue(atomRouter.service)
  if (!AsyncResult.isSuccess(result)) {
    throw new Error("Router service is not available yet")
  }
  return result.value
}
