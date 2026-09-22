import type { Destination, NavigationOutcome } from "@effect-stack/router/Router"
import type { Location } from "@effect-stack/router/History"
import { Router } from "@effect-stack/router"
import { useAtomValue } from "@effect/atom-solid"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { createComponent, createEffect, type Accessor, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useRouterContextAccessor, useRouterService } from "./context.ts"

/** @since 0.4.0 */
export type NavigationError = unknown

/** @since 0.4.0 */
export function useNavigateEffect(): (
  destination: Destination<string>,
  options?: { readonly replace?: boolean; readonly state?: unknown }
) => Effect.Effect<NavigationOutcome, NavigationError> {
  const service = useRouterService()
  return (destination, options) =>
    service().navigate(destination, options) as Effect.Effect<NavigationOutcome, NavigationError>
}

/** @since 0.4.0 */
export function useNavigate(): (
  destination: Destination<string>,
  options?: { readonly replace?: boolean; readonly state?: unknown }
) => Promise<NavigationOutcome> {
  const navigate = useNavigateEffect()
  return (destination, options) => Effect.runPromise(navigate(destination, options))
}

/** @since 0.4.0 */
export function useRetry(): () => void {
  const service = useRouterService()
  return () => {
    void Effect.runPromise(service().retry).catch(() => {})
  }
}

/** @since 0.4.0 */
export function useLocation(): Accessor<Option.Option<Location>> {
  const context = useRouterContextAccessor()
  return useAtomValue(() => context().atomRouter.location)
}

/** @since 0.4.0 */
export function Link(
  props: {
    readonly to: Destination<string>
    readonly children?: JSX.Element
  } & JSX.AnchorHTMLAttributes<HTMLAnchorElement>
): JSX.Element {
  const { to, onClick, children, ...anchor } = props
  const navigate = useNavigate()
  const location = useLocation()
  const href = Router.href(to)
  if (Result.isFailure(href)) throw href.failure
  const url = href.success
  const pathname = url.split(/[?#]/)[0] ?? url
  const active = () => Option.exists(location(), (value) => value.pathname === pathname)
  return createComponent(Dynamic, {
    component: "a" as const,
    ...anchor,
    href: url,
    get "aria-current"() {
      return active() ? "page" : undefined
    },
    get "data-active"() {
      return active() ? "true" : undefined
    },
    onClick: (event: MouseEvent & { readonly currentTarget: HTMLAnchorElement }) => {
      if (onClick !== undefined) {
        const handler = onClick as unknown as (
          event: MouseEvent & { readonly currentTarget: HTMLAnchorElement }
        ) => void
        handler(event)
      }
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
        || (anchor.target !== undefined && anchor.target !== "_self")
        || anchor.download !== undefined
      ) {
        return
      }
      event.preventDefault()
      void navigate(to).catch(() => {})
    },
    get children() {
      return children
    }
  })
}

/** @since 0.4.0 */
export function Navigate(props: {
  readonly to: Destination<string>
  readonly replace?: boolean
  readonly state?: unknown
}): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const href = Router.href(props.to)
  if (Result.isFailure(href)) throw href.failure
  const url = href.success
  createEffect(() => {
    const current = Option.getOrUndefined(location())
    if (current !== undefined && `${current.pathname}${current.search}${current.hash}` === url) return
    void navigate(props.to, {
      ...(props.replace === undefined ? {} : { replace: props.replace }),
      ...(props.state === undefined ? {} : { state: props.state })
    }).catch(() => {})
  })
  return null as unknown as JSX.Element
}
