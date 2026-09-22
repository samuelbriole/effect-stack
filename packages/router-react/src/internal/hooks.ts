import type { AtomRouter } from "@effect-stack/router/AtomRouter"
import type {
  AnyNode,
  HashOf,
  ParamsOf,
  RouterService,
  RouterState,
  SearchOf,
  SuccessOf
} from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Option from "effect/Option"
import * as React from "react"
import { useRouterContext, useRouterService } from "./context.ts"

/** The decoded, resolved values for one route. @since 0.4.0 */
export interface RouteResult<D> {
  readonly params: ParamsOf<D>
  readonly search: SearchOf<D>
  readonly hash: HashOf<D>
  readonly data: SuccessOf<D>
}

/**
 * Reads the active route's decoded inputs and prepared data. Throws a diagnosed
 * error when used outside the route's active, resolved branch.
 *
 * @since 0.4.0
 * @category hooks
 */
export function useRoute<D extends AnyNode>(descriptor: D): RouteResult<D> {
  const { atomRouter } = useRouterContext()
  const atom = React.useMemo(() => (atomRouter as AtomRouter<unknown>).route(descriptor), [atomRouter, descriptor])
  const view = useAtomValue(atom)
  if (Option.isNone(view)) {
    throw new Error(`useRoute(${descriptor.id}) is outside its active route branch`)
  }
  if (Option.isNone(view.value.data)) {
    throw new Error(`useRoute(${descriptor.id}) has no resolved data yet`)
  }
  return {
    params: view.value.params,
    search: view.value.search,
    hash: view.value.hash,
    data: view.value.data.value
  } as RouteResult<D>
}

/**
 * Reads the full read-only router state.
 *
 * @since 0.4.0
 * @category hooks
 */
export function useRouterState(): RouterState<unknown> {
  const { atomRouter } = useRouterContext()
  const result = useAtomValue(atomRouter.state)
  if (!AsyncResult.isSuccess(result)) {
    throw new Error("Router state is not available yet")
  }
  return result.value
}

/**
 * Returns the runtime router service for imperative navigation.
 *
 * @since 0.4.0
 * @category hooks
 */
export function useRouter(): RouterService<unknown> {
  return useRouterService()
}
