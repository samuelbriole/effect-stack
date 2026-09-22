import type { AtomRouter, AtomRuntimeRequirement } from "@effect-stack/router/AtomRouter"
import type { RuntimeNode } from "@effect-stack/router/Router"
import { AtomRouter as AtomRouterModule, Router } from "@effect-stack/router"
import { useAtomMount, useAtomValue } from "@effect/atom-solid"
import { Cause } from "effect"
import type * as Context from "effect/Context"
import * as Option from "effect/Option"
import { createComponent, createMemo, type Component, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { RouterContext, useRouterContextAccessor, type RouterContextValue } from "./context.ts"
import { useRetry } from "./navigation.ts"
import { DefaultError, DefaultPending, Outlet } from "./rendering.ts"
import { flattenViews, type ErrorProps, type Views } from "./route.ts"

/** @since 0.4.0 */
export interface RouterProviderProps<C extends { readonly service: Context.Key<string, unknown> }, R, ER> {
  readonly routes: C
  readonly runtime: AtomRuntimeRequirement<C, R, ER>
  readonly views: Views<C>
  readonly pending?: Component
  readonly error?: Component<ErrorProps>
}

function RouterView(props: { readonly pending?: Component; readonly error?: Component<ErrorProps> }): JSX.Element {
  const context = useRouterContextAccessor()
  const result = useAtomValue(() => context().atomRouter.state)
  const retry = useRetry()
  const view = createMemo<Component>(() => {
    const value = result()
    if (value._tag === "Initial") return props.pending ?? DefaultPending
    if (value._tag === "Failure") {
      const ErrorView = props.error ?? DefaultError
      return () => createComponent(ErrorView, { error: Cause.squash(value.cause), reset: retry })
    }
    if (Option.isNone(value.value.presentation)) return props.pending ?? DefaultPending
    return Outlet
  })
  return createComponent(Dynamic, {
    get component() {
      return view()
    }
  })
}

/**
 * Provides a contract's router atoms and views over a caller-supplied runtime.
 *
 * @since 0.4.0
 * @category components
 */
export function RouterProvider<C extends { readonly service: Context.Key<string, unknown> }, R, ER>(
  props: RouterProviderProps<C, R, ER>
): JSX.Element {
  const atomRouter = createMemo(() => AtomRouterModule.make(props.runtime, props.routes) as AtomRouter<unknown>)
  const views = createMemo(() => flattenViews(Router.nodes(props.routes) as Record<string, RuntimeNode>, props.views))
  const value = createMemo<RouterContextValue>(() => ({ atomRouter: atomRouter(), views: views() }))
  useAtomMount(() => atomRouter().state)
  useAtomMount(() => atomRouter().service)
  return createComponent(RouterContext.Provider, {
    value,
    get children() {
      return createComponent(RouterView, {
        ...(props.pending === undefined ? {} : { pending: props.pending }),
        ...(props.error === undefined ? {} : { error: props.error })
      })
    }
  })
}
