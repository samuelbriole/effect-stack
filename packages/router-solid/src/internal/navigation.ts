import type { Destination, NavigationOutcome } from "@effect-stack/router/Router"
import type { Location } from "@effect-stack/router/History"
import { useAtomValue } from "@effect/atom-solid"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { createComponent, createEffect, createMemo, mergeProps, splitProps, type Accessor, type JSX } from "solid-js"
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
  const [local, anchor] = splitProps(props, ["to", "onClick", "children"])
  const navigate = useNavigate()
  const location = useLocation()
  const context = useRouterContextAccessor()
  // Destination-derived values are reactive: changing `props.to` updates the
  // rendered href and the click target without remounting the link. Native
  // attributes stay reactive too because `anchor` is forwarded through
  // `mergeProps` rather than spread into a snapshot.
  const href = createMemo(() => Result.getOrThrow(context().atomRouter.href(local.to)))
  const pathname = createMemo(() => {
    const url = href()
    return url.split(/[?#]/)[0] ?? url
  })
  const active = createMemo(() => Option.exists(location(), (value) => value.pathname === pathname()))
  return createComponent(
    Dynamic,
    mergeProps(anchor, {
      component: "a" as const,
      get href() {
        return href()
      },
      get "aria-current"() {
        return active() ? "page" : undefined
      },
      get "data-active"() {
        return active() ? "true" : undefined
      },
      onClick: (event: MouseEvent & { readonly currentTarget: HTMLAnchorElement }) => {
        const handler = local.onClick as unknown as
          | ((event: MouseEvent & { readonly currentTarget: HTMLAnchorElement }) => void)
          | undefined
        handler?.(event)
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
        void navigate(local.to).catch(() => {})
      },
      get children() {
        return local.children
      }
    })
  )
}

/** @since 0.4.0 */
export function Navigate(props: {
  readonly to: Destination<string>
  readonly replace?: boolean
  readonly state?: unknown
}): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const context = useRouterContextAccessor()
  createEffect(() => {
    const href = context().atomRouter.href(props.to)
    if (Result.isFailure(href)) return
    const current = Option.getOrUndefined(location())
    if (current !== undefined && `${current.pathname}${current.search}${current.hash}` === href.success) return
    void navigate(props.to, {
      ...(props.replace === undefined ? {} : { replace: props.replace }),
      ...(props.state === undefined ? {} : { state: props.state })
    }).catch(() => {})
  })
  return null as unknown as JSX.Element
}
