import type { Destination, NavigationOutcome } from "@effect-stack/router/Router"
import type * as Router from "@effect-stack/router/Router"
import { navigateDetached, resolveNavigationTarget, retryDetached } from "@effect-stack/router/Adapter"
import { useAtomValue } from "@effect/atom-react"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as React from "react"
import { useRouterContext, useRouterService } from "./context.ts"
import type { LinkProps, NavigateProps, NavigateTarget } from "./route.ts"

/** @since 0.4.0 */
export type NavigationError = Router.NavigationError<unknown>

/** An Effect-based navigation function bound to the provider's router. @since 0.4.0 */
export function useNavigateEffect<App extends { readonly token: object }>(
  app: App
): (
  target: NavigateTarget<Router.RoutesOf<App>>,
  options?: Router.NavigateOptions
) => Effect.Effect<NavigationOutcome, Router.NavigationError<Router.ApplicationErrorOf<App>>>
export function useNavigateEffect(): (
  target: NavigateTarget<unknown>,
  options?: Router.NavigateOptions
) => Effect.Effect<NavigationOutcome, NavigationError>
export function useNavigateEffect(boundApp?: {
  readonly token: object
}): (
  target: NavigateTarget<unknown>,
  options?: { readonly replace?: boolean; readonly state?: unknown }
) => Effect.Effect<NavigationOutcome, NavigationError> {
  const service = useRouterService(boundApp)
  const { atomRouter } = useRouterContext(boundApp)
  const app = atomRouter.app
  return React.useCallback(
    (target, options) =>
      Effect.suspend(() => {
        const destination = resolveNavigationTarget(app, target)
        if (Result.isFailure(destination)) return Effect.fail(destination.failure)
        return service().navigate(destination.success as never, options)
      }),
    [service, app]
  )
}

/** A Promise-based navigation function bound to the provider's router. @since 0.4.0 */
export function useNavigate<App extends { readonly token: object }>(
  app: App
): (target: NavigateTarget<Router.RoutesOf<App>>, options?: Router.NavigateOptions) => Promise<NavigationOutcome>
export function useNavigate(): (
  target: NavigateTarget<unknown>,
  options?: Router.NavigateOptions
) => Promise<NavigationOutcome>
export function useNavigate(boundApp?: {
  readonly token: object
}): (
  target: NavigateTarget<unknown>,
  options?: { readonly replace?: boolean; readonly state?: unknown }
) => Promise<NavigationOutcome> {
  useRouterContext(boundApp)
  const navigate = useNavigateEffect()
  return React.useCallback((target, options) => Effect.runPromise(navigate(target, options)), [navigate])
}

/** Retries the observed URL through the router service. @since 0.4.0 */
export function useRetry(): () => void {
  const service = useRouterService()
  return React.useCallback(() => {
    retryDetached(service())
  }, [service])
}

interface RuntimeTargetProps {
  readonly to: Destination<unknown> | string
  readonly replace?: boolean
  readonly state?: unknown
  readonly params?: unknown
  readonly search?: unknown
  readonly hash?: unknown
}

function LinkComponent(props: RuntimeTargetProps & Omit<React.ComponentPropsWithRef<"a">, "href">): React.ReactNode {
  const { to: _to, params: _params, search: _search, hash: _hash, replace, state, onClick, ...anchor } = props
  const { atomRouter } = useRouterContext()
  const destination = Result.getOrThrow(resolveNavigationTarget(atomRouter.app, props))
  const href = atomRouter.href(destination as never)
  if (Result.isFailure(href)) throw href.failure
  const pathname = href.success.split(/[?#]/)[0] ?? href.success
  const location = useAtomValue(atomRouter.location)
  const active = Option.match(location, {
    onNone: () => false,
    onSome: (value) => value.pathname === pathname
  })
  const service = useRouterService()
  return (
    <a
      {...anchor}
      href={href.success}
      aria-current={active ? "page" : undefined}
      data-active={active ? "true" : undefined}
      onClick={(event) => {
        onClick?.(event)
        if (
          event.defaultPrevented
          || event.button !== 0
          || event.metaKey
          || event.ctrlKey
          || event.shiftKey
          || event.altKey
          || (anchor.target !== undefined && anchor.target !== "_self")
          || (anchor.download !== undefined && anchor.download !== false)
        ) {
          return
        }
        event.preventDefault()
        navigateDetached(service(), destination, {
          ...(replace === undefined ? {} : { replace }),
          ...(state === undefined ? {} : { state })
        })
      }}
    />
  )
}

function NavigateComponent(props: RuntimeTargetProps): null {
  const { replace, state } = props
  const { atomRouter } = useRouterContext()
  const destination = Result.getOrThrow(resolveNavigationTarget(atomRouter.app, props))
  const href = atomRouter.href(destination as never)
  if (Result.isFailure(href)) throw href.failure
  const url = href.success
  const location = useAtomValue(atomRouter.location)
  const service = useRouterService()
  const submit = React.useEffectEvent(() => {
    const current = Option.getOrUndefined(location)
    if (current !== undefined && `${current.pathname}${current.search}${current.hash}` === url) return
    navigateDetached(service(), destination, {
      ...(replace === undefined ? {} : { replace }),
      ...(state === undefined ? {} : { state })
    })
  })
  React.useEffect(() => {
    // Location observations and fresh normalized records are not new navigation commands.
    submit()
  }, [service, url, replace, state])
  return null
}

/**
 * A real anchor with a typed destination and native modified-click behavior.
 *
 * @since 0.4.0
 * @category components
 */
export const Link = LinkComponent as unknown as React.ComponentType<LinkProps<unknown>>

/**
 * Navigates when mounted or when its destination changes.
 *
 * @since 0.4.0
 * @category components
 */
export const Navigate = NavigateComponent as unknown as React.ComponentType<NavigateProps<unknown>>

/**
 * Typed navigation helpers created from an application type. The module imports
 * the application type only; it never imports the assembled application or a
 * route definition module at runtime, so route components can link across routes
 * without eager parent/child definition cycles. Helpers resolve against the
 * nearest active provider; use application-bound helpers when exact provider
 * identity matters.
 *
 * @since 0.4.0
 * @category constructors
 */
export interface NavigationHelpers<Routes, E = unknown> {
  readonly Link: React.ComponentType<LinkProps<Routes>>
  readonly Navigate: React.ComponentType<NavigateProps<Routes>>
  readonly useNavigate: () => (
    target: NavigateTarget<Routes>,
    options?: { readonly replace?: boolean; readonly state?: unknown }
  ) => Promise<NavigationOutcome>
  readonly useNavigateEffect: () => (
    target: NavigateTarget<Routes>,
    options?: { readonly replace?: boolean; readonly state?: unknown }
  ) => Effect.Effect<NavigationOutcome, Router.NavigationError<E>>
}

export function makeNavigation<App extends { readonly routes: unknown }>(): NavigationHelpers<
  App["routes"],
  Router.ApplicationErrorOf<App>
>
export function makeNavigation<App extends { readonly routes: unknown; readonly token: object }>(
  app: App
): NavigationHelpers<App["routes"], Router.ApplicationErrorOf<App>>
export function makeNavigation<App extends { readonly routes: unknown }>(app?: {
  readonly token: object
}): NavigationHelpers<App["routes"], Router.ApplicationErrorOf<App>> {
  type Routes = App["routes"]
  type E = Router.ApplicationErrorOf<App>
  const BoundLink = (props: LinkProps<Routes>): React.ReactNode => {
    useRouterContext(app)
    return React.createElement(Link, props as unknown as LinkProps<unknown>)
  }
  const BoundNavigate = (props: NavigateProps<Routes>): React.ReactNode => {
    useRouterContext(app)
    return React.createElement(Navigate, props as unknown as NavigateProps<unknown>)
  }
  return {
    Link: app === undefined ? (Link as unknown as React.ComponentType<LinkProps<Routes>>) : BoundLink,
    Navigate: app === undefined ? (Navigate as unknown as React.ComponentType<NavigateProps<Routes>>) : BoundNavigate,
    useNavigate: () => {
      useRouterContext(app)
      return useNavigate() as (
        target: NavigateTarget<Routes>,
        options?: Router.NavigateOptions
      ) => Promise<NavigationOutcome>
    },
    useNavigateEffect: () => {
      useRouterContext(app)
      return useNavigateEffect() as unknown as (
        target: NavigateTarget<Routes>,
        options?: { readonly replace?: boolean; readonly state?: unknown }
      ) => Effect.Effect<NavigationOutcome, Router.NavigationError<E>>
    }
  }
}
