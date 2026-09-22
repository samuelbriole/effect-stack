import type { AtomRouter } from "@effect-stack/router/AtomRouter"
import type { RouterService } from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-vue"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { inject, type ComputedRef, type InjectionKey } from "vue"
import type { ViewOptions } from "./route.ts"

/** @since 0.4.0 */
export interface RouterContextValue {
  readonly atomRouter: AtomRouter<unknown>
  readonly views: ReadonlyMap<string, ViewOptions>
}

/** @since 0.4.0 */
export const routerKey: InjectionKey<RouterContextValue> = Symbol.for("@effect-stack/router-vue/context")
/** @since 0.4.0 */
export const depthKey: InjectionKey<ComputedRef<number>> = Symbol.for("@effect-stack/router-vue/depth")

/** @since 0.4.0 */
export function useRouterContext(): RouterContextValue {
  const value = inject(routerKey, null)
  if (value === null) throw new Error("Router composables require RouterProvider")
  return value
}

/** @since 0.4.0 */
export function useRouterService(): () => RouterService<unknown> {
  const context = useRouterContext()
  const result = useAtomValue(() => context.atomRouter.service)
  return () => {
    if (!AsyncResult.isSuccess(result.value)) throw new Error("Router service is not available yet")
    return result.value.value
  }
}
