import type {
  AnyDefinition,
  ApplicationErrorOf,
  RouterService,
  RouterState,
  RoutesOf,
  DecodedRouteInputOfDef
} from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-react"
import * as Option from "effect/Option"
import * as React from "react"
import { useRouterContext, useRouterService } from "./context.ts"

/**
 * Reads the displayed definition's coherent decoded input. Throws a
 * diagnosed error when used outside the definition's active, resolved branch.
 *
 * @since 0.4.0
 * @category hooks
 */
export function useRouteInput<Def extends AnyDefinition>(definition: Def): DecodedRouteInputOfDef<Def> {
  const { atomRouter } = useRouterContext()
  const atom = React.useMemo(() => atomRouter.route(definition), [atomRouter, definition])
  const view = useAtomValue(atom)
  if (Option.isNone(view)) {
    throw new Error(`useRouteInput(${definition.id}) is outside its active route branch`)
  }
  return view.value.input as DecodedRouteInputOfDef<Def>
}

/**
 * Reads the full read-only router state.
 *
 * @since 0.4.0
 * @category hooks
 */
export function useRouterState(): RouterState<unknown>
export function useRouterState<App extends { readonly token: object }>(app: App): RouterState<RoutesOf<App>>
export function useRouterState(app?: { readonly token: object }): RouterState<unknown> {
  const { atomRouter } = useRouterContext(app)
  const result = useAtomValue(atomRouter.state)
  if (result._tag !== "Success") {
    throw new Error("Router state is not available yet")
  }
  return result.value as RouterState<unknown>
}

/**
 * Returns the runtime router service for imperative navigation.
 *
 * @since 0.4.0
 * @category hooks
 */
export function useRouter(): RouterService<unknown, unknown>
export function useRouter<App extends { readonly token: object }>(
  app: App
): RouterService<RoutesOf<App>, ApplicationErrorOf<App>>
export function useRouter(app?: { readonly token: object }): RouterService<unknown, unknown> {
  return useRouterService(app)()
}
