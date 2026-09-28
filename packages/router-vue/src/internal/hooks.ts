import type {
  AnyDefinition,
  ApplicationErrorOf,
  RouterService,
  RouterState,
  RoutesOf,
  DecodedRouteInputOfDef
} from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-vue"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Option from "effect/Option"
import { computed, type ComputedRef } from "vue"
import { useRouterContext, useRouterService } from "./context.ts"

/** Reads coherent decoded input from the displayed branch. @since 0.4.0 */
export function useRouteInput<Def extends AnyDefinition>(definition: Def): ComputedRef<DecodedRouteInputOfDef<Def>> {
  const context = useRouterContext()
  const view = useAtomValue(() => context.atomRouter.route(definition))
  return computed(() => {
    const value = view.value
    if (Option.isNone(value)) throw new Error(`useRouteInput(${definition.id}) is outside its active route branch`)
    return value.value.input as DecodedRouteInputOfDef<Def>
  })
}

/** @since 0.4.0 */
export function useRouterState(): ComputedRef<RouterState<unknown>>
export function useRouterState<App extends { readonly token: object }>(
  app: App
): ComputedRef<RouterState<RoutesOf<App>>>
export function useRouterState(app?: { readonly token: object }): ComputedRef<RouterState<unknown>> {
  const context = useRouterContext(app)
  const result = useAtomValue(() => context.atomRouter.state)
  return computed(() => {
    void context.atomRouter
    if (!AsyncResult.isSuccess(result.value)) throw new Error("Router state is not available yet")
    return result.value.value as RouterState<unknown>
  })
}

/** @since 0.4.0 */
export function useRouter(): () => RouterService<unknown, unknown>
export function useRouter<App extends { readonly token: object }>(
  app: App
): () => RouterService<RoutesOf<App>, ApplicationErrorOf<App>>
export function useRouter(app?: { readonly token: object }): () => RouterService<unknown, unknown> {
  return useRouterService(app)
}
