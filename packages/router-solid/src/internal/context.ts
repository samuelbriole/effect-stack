import type { AtomRouter } from "@effect-stack/router/AtomRouter"
import type { RouterService } from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-solid"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { createContext, type Accessor, useContext } from "solid-js"
import type { ViewOptions } from "./route.ts"

/** @since 0.4.0 */
export interface RouterContextValue {
  readonly atomRouter: AtomRouter<unknown>
  readonly views: ReadonlyMap<string, ViewOptions>
}

/** @since 0.4.0 */
export const RouterContext = createContext<Accessor<RouterContextValue>>()
/** @since 0.4.0 */
export const DepthContext = createContext<Accessor<number>>()

/** @since 0.4.0 */
export function useRouterContextAccessor(): Accessor<RouterContextValue> {
  const value = useContext(RouterContext)
  if (value === undefined) throw new Error("Router hooks require RouterProvider")
  return value
}

/** @since 0.4.0 */
export function useRouterContext(): RouterContextValue {
  return useRouterContextAccessor()()
}

/** @since 0.4.0 */
export function useRouterService(): Accessor<RouterService<unknown>> {
  const context = useRouterContextAccessor()
  const result = useAtomValue(() => context().atomRouter.service)
  return () => {
    const value = result()
    if (!AsyncResult.isSuccess(value)) throw new Error("Router service is not available yet")
    return value.value
  }
}
