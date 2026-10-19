import type { Destination, NavigationOutcome } from "@effect-stack/router/Router"
import type { Location } from "@effect-stack/router/History"
import type * as Router from "@effect-stack/router/Router"
import { resolveNavigationTarget } from "@effect-stack/router/Adapter"
import { useAtomValue } from "@effect/atom-solid"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import {
  createComponent,
  createEffect,
  createMemo,
  createRenderEffect,
  mergeProps,
  on,
  splitProps,
  untrack,
  type Accessor,
  type Component,
  type JSX
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { useRouterContextAccessor, useRouterService } from "./context.ts"
import type { LinkProps, NavigateProps, NavigateTarget } from "./route.ts"

/** @since 0.4.0 */
export type NavigationError = Router.NavigationError<unknown>

/** @since 0.4.0 */
export function useNavigateEffect<App extends { readonly token: object }>(
  app: App
): (
  target: NavigateTarget<Router.RoutesOf<App>>,
  options?: Router.NavigateOptions
) => Effect.Effect<NavigationOutcome, Router.NavigationError<Router.ApplicationErrorOf<App>>>
export function useNavigateEffect(): (
  target: NavigateTarget<unknown>,
  options?: { readonly replace?: boolean; readonly state?: unknown }
) => Effect.Effect<NavigationOutcome, NavigationError>
export function useNavigateEffect(app?: {
  readonly token: object
}): (
  target: NavigateTarget<unknown>,
  options?: Router.NavigateOptions
) => Effect.Effect<NavigationOutcome, NavigationError> {
  return navigateEffect(app)
}

const navigateEffect = (app?: {
  readonly token: object
}): ((
  target: NavigateTarget<unknown>,
  options?: Router.NavigateOptions
) => Effect.Effect<NavigationOutcome, NavigationError>) => {
  const service = useRouterService(app)
  const context = useRouterContextAccessor(app)
  return (target, options) =>
    Effect.suspend(() => {
      const destination = resolveNavigationTarget(context().atomRouter.app, target)
      if (Result.isFailure(destination)) return Effect.fail(destination.failure)
      return service().navigate(destination.success as never, options)
    })
}

/** @since 0.4.0 */
export function useNavigate<App extends { readonly token: object }>(
  app: App
): (target: NavigateTarget<Router.RoutesOf<App>>, options?: Router.NavigateOptions) => Promise<NavigationOutcome>
export function useNavigate(): (
  target: NavigateTarget<unknown>,
  options?: { readonly replace?: boolean; readonly state?: unknown }
) => Promise<NavigationOutcome>
export function useNavigate(app?: {
  readonly token: object
}): (target: NavigateTarget<unknown>, options?: Router.NavigateOptions) => Promise<NavigationOutcome> {
  const navigate = navigateEffect(app)
  return (target, options) => Effect.runPromise(navigate(target, options))
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

function LinkComponent(
  props: {
    readonly to: Destination<unknown> | string
    readonly params?: unknown
    readonly search?: unknown
    readonly hash?: unknown
    readonly replace?: boolean
    readonly state?: unknown
    readonly children?: JSX.Element
  } & JSX.AnchorHTMLAttributes<HTMLAnchorElement>
): JSX.Element {
  const [local, anchor] = splitProps(props, [
    "to",
    "params",
    "search",
    "hash",
    "replace",
    "state",
    "onClick",
    "children"
  ])
  const navigate = useNavigate()
  const location = useLocation()
  const context = useRouterContextAccessor()
  const href = createMemo(() =>
    Result.getOrThrow(
      context().atomRouter.href(Result.getOrThrow(resolveNavigationTarget(context().atomRouter.app, local)) as never)
    )
  )
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
      onClick: function (this: HTMLAnchorElement, event: MouseEvent & { readonly currentTarget: HTMLAnchorElement }) {
        const handler = local.onClick as unknown
        // Honor Solid's `EventHandlerUnion` tuple form: `[handler, data]` is
        // invoked as `handler.call(currentTarget, data, event)`.
        if (Array.isArray(handler)) {
          const [fn, data] = handler as unknown as readonly [
            ((this: HTMLAnchorElement, data: unknown, event: MouseEvent) => void) | undefined,
            unknown
          ]
          fn?.call(this, data, event)
        } else {
          const fn = handler as ((this: HTMLAnchorElement, event: MouseEvent) => void) | undefined
          fn?.call(this, event)
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
        const destination = resolveNavigationTarget(context().atomRouter.app, local)
        if (Result.isFailure(destination)) return
        void navigate(destination.success, {
          ...(local.replace === undefined ? {} : { replace: local.replace }),
          ...(local.state === undefined ? {} : { state: local.state })
        }).catch(() => {})
      },
      get children() {
        return local.children
      }
    })
  )
}

function NavigateComponent(props: {
  readonly to: Destination<unknown> | string
  readonly params?: unknown
  readonly search?: unknown
  readonly hash?: unknown
  readonly replace?: boolean
  readonly state?: unknown
}): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const context = useRouterContextAccessor()
  const destination = createMemo(() => Result.getOrThrow(resolveNavigationTarget(context().atomRouter.app, props)))
  const href = createMemo(() => {
    const result = context().atomRouter.href(destination() as never)
    return Result.isFailure(result) ? undefined : result.success
  })
  const replace = createMemo(() => props.replace)
  const state = createMemo(() => props.state)
  const atomRouter = createMemo(() => context().atomRouter)
  createEffect(
    on([href, replace, state, atomRouter], ([url]) => {
      if (url === undefined) return
      const current = Option.getOrUndefined(untrack(location))
      if (current !== undefined && `${current.pathname}${current.search}${current.hash}` === url) return
      void navigate(destination(), {
        ...(props.replace === undefined ? {} : { replace: props.replace }),
        ...(props.state === undefined ? {} : { state: props.state })
      }).catch(() => {})
    })
  )
  return null as unknown as JSX.Element
}

/** @since 0.4.0 */
export const Link = LinkComponent as unknown as Component<LinkProps<unknown>>
/** @since 0.4.0 */
export const Navigate = NavigateComponent as unknown as Component<NavigateProps<unknown>>

/**
 * Typed navigation helpers created from an application type. The module imports
 * the application type only; it never imports the assembled application or a
 * route definition module at runtime. Helpers resolve against the nearest active
 * provider; use application-bound helpers when exact provider identity matters.
 *
 * @since 0.4.0
 * @category constructors
 */
export interface NavigationHelpers<Routes, E = unknown> {
  readonly Link: Component<LinkProps<Routes>>
  readonly Navigate: Component<NavigateProps<Routes>>
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
export function makeNavigation<App extends { readonly routes: unknown; readonly token: object }>(
  app?: App
): NavigationHelpers<App["routes"], Router.ApplicationErrorOf<App>> {
  type Routes = App["routes"]
  type E = Router.ApplicationErrorOf<App>
  const bound =
    <P extends object>(component: Component<P>): Component<P> =>
    (props) => {
      const context = useRouterContextAccessor(app)
      createRenderEffect(() => {
        context()
      })
      return createComponent(component, props)
    }
  return {
    Link: (app === undefined ? Link : bound(Link)) as unknown as Component<LinkProps<Routes>>,
    Navigate: (app === undefined ? Navigate : bound(Navigate)) as unknown as Component<NavigateProps<Routes>>,
    useNavigate: () =>
      (app === undefined ? useNavigate() : useNavigate(app)) as (
        target: NavigateTarget<Routes>,
        options?: Router.NavigateOptions
      ) => Promise<NavigationOutcome>,
    useNavigateEffect: () =>
      (app === undefined ? useNavigateEffect() : useNavigateEffect(app)) as unknown as (
        target: NavigateTarget<Routes>,
        options?: { readonly replace?: boolean; readonly state?: unknown }
      ) => Effect.Effect<NavigationOutcome, Router.NavigationError<E>>
  }
}
