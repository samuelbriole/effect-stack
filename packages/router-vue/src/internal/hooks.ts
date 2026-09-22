import type {
  AnyNode,
  HashOf,
  ParamsOf,
  RouterService,
  RouterState,
  SearchOf,
  SuccessOf
} from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-vue"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Option from "effect/Option"
import { computed, type ComputedRef } from "vue"
import { useRouterContext, useRouterService } from "./context.ts"

/** @since 0.4.0 */
export interface RouteResult<D> {
  readonly params: ParamsOf<D>
  readonly search: SearchOf<D>
  readonly hash: HashOf<D>
  readonly data: SuccessOf<D>
}

/** @since 0.4.0 */
export function useRoute<D extends AnyNode>(descriptor: D): ComputedRef<RouteResult<D>> {
  const context = useRouterContext()
  const view = useAtomValue(() => context.atomRouter.route(descriptor))
  return computed(() => {
    const value = view.value
    if (Option.isNone(value)) throw new Error(`useRoute(${descriptor.id}) is outside its active route branch`)
    if (Option.isNone(value.value.data)) throw new Error(`useRoute(${descriptor.id}) has no resolved data yet`)
    return {
      params: value.value.params,
      search: value.value.search,
      hash: value.value.hash,
      data: value.value.data.value
    } as RouteResult<D>
  })
}

/** @since 0.4.0 */
export function useRouterState(): ComputedRef<RouterState<unknown>> {
  const context = useRouterContext()
  const result = useAtomValue(() => context.atomRouter.state)
  return computed(() => {
    if (!AsyncResult.isSuccess(result.value)) throw new Error("Router state is not available yet")
    return result.value.value
  })
}

/** @since 0.4.0 */
export function useRouter(): () => RouterService<unknown> {
  return useRouterService()
}
