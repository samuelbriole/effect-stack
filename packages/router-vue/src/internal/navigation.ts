import type { Destination, NavigationOutcome } from "@effect-stack/router/Router"
import type * as Router from "@effect-stack/router/Router"
import { RouteDefinitionError } from "@effect-stack/router/Router"
import { navigateDetached, resolveNavigationTarget, retryDetached } from "@effect-stack/router/Adapter"
import { useAtomValue } from "@effect/atom-vue"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import {
  computed,
  defineComponent,
  h,
  mergeProps,
  type FunctionalComponent,
  type PropType,
  type VNode,
  type VNodeChild,
  watch
} from "vue"
import { useRouterContext, useRouterService } from "./context.ts"
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
  return useNavigationEffect(app)
}

const useNavigationEffect = (app?: {
  readonly token: object
}): ((
  target: NavigateTarget<unknown>,
  options?: Router.NavigateOptions
) => Effect.Effect<NavigationOutcome, NavigationError>) => {
  const service = useRouterService(app)
  const context = useRouterContext(app)
  return (target, options) =>
    Effect.suspend(() => {
      try {
        const destination = resolveNavigationTarget(context.atomRouter.app, target)
        if (Result.isFailure(destination)) return Effect.fail(destination.failure)
        return service().navigate(destination.success as never, options) as Effect.Effect<
          NavigationOutcome,
          NavigationError
        >
      } catch (error) {
        return error instanceof RouteDefinitionError ? Effect.fail(error) : Effect.die(error)
      }
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
  const navigate = useNavigationEffect(app)
  return (target, options) => Effect.runPromise(navigate(target, options))
}

/** @since 0.4.0 */
export function useRetry(): () => void {
  const service = useRouterService()
  return () => {
    retryDetached(service())
  }
}

const LinkComponent = defineComponent({
  name: "RouterLink",
  inheritAttrs: false,
  props: {
    to: { type: [Object, String] as PropType<Destination<unknown> | string>, required: true as const },
    params: { type: null as unknown as PropType<unknown>, default: undefined },
    search: { type: null as unknown as PropType<unknown>, default: undefined },
    hash: { type: null as unknown as PropType<unknown>, default: undefined },
    replace: { type: Boolean, default: undefined },
    state: { type: null, default: undefined }
  },
  setup(props, { attrs, slots }) {
    const context = useRouterContext()
    const service = useRouterService()
    const location = useAtomValue(() => context.atomRouter.location)
    return (): VNode | null => {
      const destination = Result.getOrThrow(resolveNavigationTarget(context.atomRouter.app, props))
      const href = Result.getOrThrow(context.atomRouter.href(destination as never))
      const pathname = href.split(/[?#]/)[0] ?? href
      const active = Option.exists(location.value, (value) => value.pathname === pathname)
      const onNavigate = (event: MouseEvent) => {
        if (
          event.defaultPrevented
          || event.button !== 0
          || event.metaKey
          || event.ctrlKey
          || event.shiftKey
          || event.altKey
          || (attrs.target !== undefined && attrs.target !== "_self")
          || (attrs.download !== undefined && attrs.download !== false)
        ) {
          return
        }
        event.preventDefault()
        navigateDetached(service(), props as never, {
          ...(props.replace === undefined ? {} : { replace: props.replace }),
          ...(props.state === undefined ? {} : { state: props.state })
        })
      }
      return h(
        "a",
        mergeProps(attrs, {
          href,
          "aria-current": active ? "page" : undefined,
          "data-active": active ? "true" : undefined,
          // Vue's native event invoker flattens listener arrays and runs each
          // handler through `callWithAsyncErrorHandling`, so user callbacks keep
          // framework error handling and `stopImmediatePropagation` semantics.
          // Routing runs last, after user `preventDefault`/`stopImmediatePropagation`.
          onClick: [onNavigate]
        }),
        slots.default?.()
      )
    }
  }
})

const NavigateComponent = defineComponent({
  name: "RouterNavigate",
  props: {
    to: { type: [Object, String] as PropType<Destination<unknown> | string>, required: true as const },
    params: { type: null as unknown as PropType<unknown>, default: undefined },
    search: { type: null as unknown as PropType<unknown>, default: undefined },
    hash: { type: null as unknown as PropType<unknown>, default: undefined },
    replace: { type: Boolean, default: undefined },
    state: { type: null, default: undefined }
  },
  setup(props) {
    const context = useRouterContext()
    const service = useRouterService()
    const location = useAtomValue(() => context.atomRouter.location)
    const destination = computed((): Destination<unknown> =>
      Result.getOrThrow(resolveNavigationTarget(context.atomRouter.app, props))
    )
    const href = computed(() => {
      const result = context.atomRouter.href(destination.value as never)
      return Result.isFailure(result) ? undefined : result.success
    })
    watch(
      [href, () => props.replace, (): unknown => props.state, () => context.atomRouter],
      ([url]) => {
        if (url === undefined) return
        const current = Option.getOrUndefined(location.value)
        if (current !== undefined && `${current.pathname}${current.search}${current.hash}` === url) return
        navigateDetached(service(), props as never, {
          ...(props.replace === undefined ? {} : { replace: props.replace }),
          ...(props.state === undefined ? {} : { state: props.state })
        })
      },
      { immediate: true }
    )
    return (): null => null
  }
})

/** @since 0.4.0 */
export const Link = LinkComponent
/** @since 0.4.0 */
export const Navigate = NavigateComponent

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
  readonly Link: FunctionalComponent<LinkProps<Routes>>
  readonly Navigate: FunctionalComponent<NavigateProps<Routes>>
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
export function makeNavigation(app?: { readonly routes: unknown; readonly token: object }): NavigationHelpers<unknown> {
  const bind = (component: typeof Link | typeof Navigate) => {
    const Bound: FunctionalComponent<LinkProps<unknown>> = (props, { slots }) => {
      void useRouterContext(app).atomRouter
      return h(component, props as never, slots)
    }
    Bound.inheritAttrs = false
    return Bound
  }
  return {
    Link: app === undefined ? (Link as unknown as FunctionalComponent<LinkProps<unknown>>) : bind(Link),
    Navigate:
      app === undefined
        ? (Navigate as unknown as FunctionalComponent<NavigateProps<unknown>>)
        : (bind(Navigate) as FunctionalComponent<NavigateProps<unknown>>),
    useNavigate: () => (app === undefined ? useNavigate() : useNavigate(app)),
    useNavigateEffect: () => (app === undefined ? useNavigateEffect() : useNavigateEffect(app))
  }
}

/** @since 0.4.0 */
export type { VNodeChild }
