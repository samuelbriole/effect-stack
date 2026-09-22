import type {
  AnyNode,
  HashOf,
  ParamsOf,
  RouterService,
  RouterState,
  SearchOf,
  SuccessOf
} from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-solid"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Option from "effect/Option"
import type { Accessor } from "solid-js"
import { useRouterContextAccessor, useRouterService } from "./context.ts"

/** @since 0.4.0 */
export interface RouteResult<D> {
  readonly params: ParamsOf<D>
  readonly search: SearchOf<D>
  readonly hash: HashOf<D>
  readonly data: SuccessOf<D>
}

/** @since 0.4.0 */
export function useRoute<D extends AnyNode>(descriptor: D): Accessor<RouteResult<D>> {
  const context = useRouterContextAccessor()
  const view = useAtomValue(() => context().atomRouter.route(descriptor))
  return () => {
    const value = view()
    if (Option.isNone(value)) throw new Error(`useRoute(${descriptor.id}) is outside its active route branch`)
    if (Option.isNone(value.value.data)) throw new Error(`useRoute(${descriptor.id}) has no resolved data yet`)
    return {
      params: value.value.params,
      search: value.value.search,
      hash: value.value.hash,
      data: value.value.data.value
    } as RouteResult<D>
  }
}

/** @since 0.4.0 */
export function useRouterState(): Accessor<RouterState<unknown>> {
  const context = useRouterContextAccessor()
  const result = useAtomValue(() => context().atomRouter.state)
  return () => {
    const value = result()
    if (!AsyncResult.isSuccess(value)) throw new Error("Router state is not available yet")
    return value.value
  }
}

/** @since 0.4.0 */
export function useRouter(): Accessor<RouterService<unknown>> {
  return useRouterService()
}
