import type { AtomRouter, AtomRuntimeRequirement } from "@effect-stack/router/AtomRouter"
import type { AnyNode, RouterService, RuntimeNode } from "@effect-stack/router/Router"
import { AtomRouter as AtomRouterModule, Router } from "@effect-stack/router"
import { useAtomMount, useAtomValue } from "@effect/atom-react"
import { Cause } from "effect"
import type * as Context from "effect/Context"
import * as Option from "effect/Option"
import * as React from "react"
import { RouterContext, type RouterContextValue } from "./context.ts"
import { DefaultError, DefaultPending, Outlet } from "./rendering.tsx"
import { useRetry } from "./navigation.tsx"
import type { ErrorProps, Views } from "./route.ts"
import { flattenViews } from "./route.ts"

/** @since 0.4.0 */
export interface RouterProviderProps<C extends { readonly service: Context.Key<string, unknown> }, R, ER> {
  readonly routes: C
  readonly runtime: AtomRuntimeRequirement<C, R, ER>
  readonly views: Views<C>
  readonly pending?: React.ComponentType
  readonly error?: React.ComponentType<ErrorProps>
}

function RouterView({
  pending: Pending = DefaultPending,
  error: ErrorView = DefaultError
}: {
  readonly pending?: React.ComponentType
  readonly error?: React.ComponentType<ErrorProps>
}) {
  const { atomRouter } = React.useContext(RouterContext) as RouterContextValue
  const result = useAtomValue(atomRouter.state)
  const retry = useRetry()
  if (result._tag === "Initial") return <Pending />
  if (result._tag === "Failure") return <ErrorView error={Cause.squash(result.cause)} reset={retry} />
  if (Option.isNone(result.value.presentation)) return <Pending />
  return <Outlet />
}

/**
 * Provides a contract's router atoms and views, mounting the existing runtime
 * in the surrounding official `RegistryProvider`.
 *
 * @since 0.4.0
 * @category components
 */
export function RouterProvider<C extends { readonly service: Context.Key<string, unknown> }, R, ER>(
  props: RouterProviderProps<C, R, ER>
): React.ReactNode {
  const { routes, runtime, views, pending, error } = props
  const atomRouter = React.useMemo(
    () => AtomRouterModule.make(runtime, routes) as AtomRouter<unknown>,
    [runtime, routes]
  )
  const viewMap = React.useMemo(
    () => flattenViews(Router.nodes(routes) as Record<string, RuntimeNode>, views),
    [routes, views]
  )
  useAtomMount(atomRouter.state)
  useAtomMount(atomRouter.service)
  const context = React.useMemo<RouterContextValue>(() => ({ atomRouter, views: viewMap }), [atomRouter, viewMap])
  return (
    <RouterContext.Provider value={context}>
      <RouterView {...(pending === undefined ? {} : { pending })} {...(error === undefined ? {} : { error })} />
    </RouterContext.Provider>
  )
}

/** @since 0.4.0 */
export type { RouterService, AnyNode }
