import type { AtomRouter } from "@effect-stack/router/AtomRouter"
import { RouteDefinitionError, type CoreApplication, type RouterService } from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-vue"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { inject, toRaw, type Component, type ComputedRef, type InjectionKey } from "vue"
import type { ResolvedViewOptions } from "./route.ts"

/** @since 0.4.0 */
export interface RouterContextValue {
  readonly atomRouter: AtomRouter<CoreApplication>
  readonly views: ReadonlyMap<string, ResolvedViewOptions>
  readonly pending: Component
}

/** @since 0.4.0 */
export const routerKey: InjectionKey<RouterContextValue> = Symbol.for("@effect-stack/router-vue/context")
/** @since 0.4.0 */
export const depthKey: InjectionKey<ComputedRef<number>> = Symbol.for("@effect-stack/router-vue/depth")

/** @since 0.4.0 */
export function useRouterContext(app?: { readonly token: object }): RouterContextValue {
  const value = inject(routerKey, null)
  if (value === null) throw new Error("Router composables require a router provider")
  if (app === undefined) return value
  const check = (): void => {
    if (value.atomRouter.app.token !== toRaw(app).token) {
      throw new RouteDefinitionError({
        message: "This bound router helper belongs to a different application than the active provider"
      })
    }
  }
  check()
  return {
    get atomRouter() {
      check()
      return value.atomRouter
    },
    get views() {
      check()
      return value.views
    },
    get pending() {
      check()
      return value.pending
    }
  }
}

/** @since 0.4.0 */
export function useRouterService(app?: { readonly token: object }): () => RouterService<unknown> {
  const context = useRouterContext(app)
  const result = useAtomValue(() => context.atomRouter.service)
  return () => {
    void context.atomRouter
    if (!AsyncResult.isSuccess(result.value)) throw new Error("Router service is not available yet")
    return result.value.value as unknown as RouterService<unknown>
  }
}
