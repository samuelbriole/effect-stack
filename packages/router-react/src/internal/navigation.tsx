import type { Destination, NavigationOutcome } from "@effect-stack/router/Router"
import { Router } from "@effect-stack/router"
import { useAtomValue } from "@effect/atom-react"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as React from "react"
import { useRouterContext, useRouterService } from "./context.ts"

/** @since 0.4.0 */
export type NavigationError = unknown

/** An Effect-based navigation function bound to the provider's router. @since 0.4.0 */
export function useNavigateEffect(): (
  destination: Destination<string>,
  options?: { readonly replace?: boolean; readonly state?: unknown }
) => Effect.Effect<NavigationOutcome, NavigationError> {
  const service = useRouterService()
  return React.useCallback(
    (destination, options) =>
      service.navigate(destination, options) as Effect.Effect<NavigationOutcome, NavigationError>,
    [service]
  )
}

/** A Promise-based navigation function bound to the provider's router. @since 0.4.0 */
export function useNavigate(): (
  destination: Destination<string>,
  options?: { readonly replace?: boolean; readonly state?: unknown }
) => Promise<NavigationOutcome> {
  const navigate = useNavigateEffect()
  return React.useCallback((destination, options) => Effect.runPromise(navigate(destination, options)), [navigate])
}

/** Retries the observed URL through the router service. @since 0.4.0 */
export function useRetry(): () => void {
  const service = useRouterService()
  return React.useCallback(() => {
    void Effect.runPromise(service.retry).catch(() => {})
  }, [service])
}

/**
 * A real anchor with a typed destination and native modified-click behavior.
 *
 * @since 0.4.0
 * @category components
 */
export function Link(
  props: { readonly to: Destination<string> } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">
): React.ReactNode {
  const { to, onClick, ...anchor } = props
  const { atomRouter } = useRouterContext()
  const navigate = useNavigate()
  const href = Router.href(to)
  if (Result.isFailure(href)) throw href.failure
  const pathname = href.success.split(/[?#]/)[0] ?? href.success
  const location = useAtomValue(atomRouter.location)
  const active = Option.match(location, {
    onNone: () => false,
    onSome: (value) => value.pathname === pathname
  })
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
        void navigate(to).catch(() => {})
      }}
    />
  )
}

/**
 * Navigates when mounted or when its destination changes.
 *
 * @since 0.4.0
 * @category components
 */
export function Navigate(props: {
  readonly to: Destination<string>
  readonly replace?: boolean
  readonly state?: unknown
}): null {
  const navigate = useNavigate()
  const { atomRouter } = useRouterContext()
  const location = useAtomValue(atomRouter.location)
  const href = Router.href(props.to)
  if (Result.isFailure(href)) throw href.failure
  const url = href.success
  React.useEffect(() => {
    const current = Option.getOrUndefined(location)
    if (current !== undefined && `${current.pathname}${current.search}${current.hash}` === url) return
    void navigate(props.to, {
      ...(props.replace === undefined ? {} : { replace: props.replace }),
      ...(props.state === undefined ? {} : { state: props.state })
    }).catch(() => {})
    // Navigation is intentionally keyed by the encoded destination.
  }, [navigate, url, props.replace, props.state])
  return null
}
