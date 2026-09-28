import type {
  AnyDefinition,
  ApplicationErrorOf,
  RouterService,
  RouterState,
  RoutesOf,
  DecodedRouteInputOfDef
} from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-solid"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Option from "effect/Option"
import type { Accessor } from "solid-js"
import { useRouterContextAccessor, useRouterService } from "./context.ts"

/** Reads coherent decoded input from the displayed branch. @since 0.4.0 */
export function useRouteInput<Def extends AnyDefinition>(definition: Def): Accessor<DecodedRouteInputOfDef<Def>> {
  const context = useRouterContextAccessor()
  const view = useAtomValue(() => context().atomRouter.route(definition))
  return () => {
    const value = view()
    if (Option.isNone(value)) throw new Error(`useRouteInput(${definition.id}) is outside its active route branch`)
    return value.value.input as DecodedRouteInputOfDef<Def>
  }
}

/** @since 0.4.0 */
export function useRouterState(): Accessor<RouterState<unknown>>
export function useRouterState<App extends { readonly token: object }>(app: App): Accessor<RouterState<RoutesOf<App>>>
export function useRouterState(app?: { readonly token: object }): Accessor<RouterState<unknown>> {
  const context = useRouterContextAccessor(app)
  const result = useAtomValue(() => context().atomRouter.state)
  return () => {
    context()
    const value = result()
    if (!AsyncResult.isSuccess(value)) throw new Error("Router state is not available yet")
    return value.value
  }
}

/** @since 0.4.0 */
export function useRouter(): Accessor<RouterService<unknown, unknown>>
export function useRouter<App extends { readonly token: object }>(
  app: App
): Accessor<RouterService<RoutesOf<App>, ApplicationErrorOf<App>>>
export function useRouter(app?: { readonly token: object }): Accessor<RouterService<unknown, unknown>> {
  return useRouterService(app)
}
