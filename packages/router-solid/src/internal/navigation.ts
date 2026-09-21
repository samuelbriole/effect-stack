import { RenderPolicy, Route, Router, type RouteTree } from "@effect-stack/router"
import { RegistryContext, useAtomValue } from "@effect/atom-solid"
import { Effect, Option, Result } from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import { createComponent, createEffect, createMemo, type JSX, mergeProps, splitProps, useContext } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useRuntime } from "./context.ts"
import type { Destination, RegisteredRouter } from "./router.ts"

/** @since 0.2.0 */
export type NavigationError = Effect.Error<ReturnType<RegisteredRouter["core"]["execute"]>>
/** The provider's registry is supplied; interruption cancels this operation's transition. @since 0.2.0 */
export function useNavigateEffect(): (destination: Destination) => Effect.Effect<void, NavigationError> {
  const router = useRuntime()
  const registry = useContext(RegistryContext)
  return (destination: Destination) =>
    Effect.suspend(() => {
      const { route, input } = router.compiled.target(destination)
      return router.core
        .execute(
          destination.replace
            ? Router.replace<RouteTree.Any>(route, input, destination.state)
            : Router.push<RouteTree.Any>(route, input, destination.state)
        )
        .pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
    }) as Effect.Effect<void, NavigationError>
}
/** Awaits this transition's resolution and scoped cleanup. @since 0.1.0 */
export function useNavigate(): (
  destination: Destination,
  options?: { readonly signal?: AbortSignal }
) => Promise<void> {
  const navigate = useNavigateEffect()
  return (destination, options) => Effect.runPromise(navigate(destination), options)
}
/** Rebuilds failed initialization, or refreshes a healthy runtime. @since 0.2.0 */
export function useRetry(): () => void {
  const { core } = useRuntime()
  const registry = useContext(RegistryContext)
  return () => {
    void Effect.runPromise(core.retry.pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))).catch(() => {})
  }
}

/** @since 0.1.0 */
export type LinkProps = Destination
  & Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    readonly exact?: boolean
  }

/** A reactive real anchor with the shared typed destination model. @since 0.1.0 */
export function Link(props: LinkProps): JSX.Element {
  const router = useRuntime()
  const navigate = useNavigate()
  const locationAtom = Atom.map(router.core.branch, (branch) => branch.location)
  const location = useAtomValue(() => locationAtom)
  const [local, anchor] = splitProps(props, ["to", "params", "search", "hash", "replace", "state", "exact", "onClick"])
  const href = createMemo(() => {
    const { route, input } = router.compiled.target(local)
    const encoded = Route.href(route, input)
    if (Result.isFailure(encoded)) throw encoded.failure
    return encoded.success
  })
  const active = createMemo(() => {
    const current = location()
    if (Option.isNone(current)) return false
    const pathname = href().split(/[?#]/)[0]
    return (
      current.value.pathname === pathname
      || (!local.exact && pathname !== "/" && current.value.pathname.startsWith(`${pathname}/`))
    )
  })
  const onClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    const handler = local.onClick
    if (typeof handler === "function") handler(event)
    else if (handler !== undefined) handler[0](handler[1], event)
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || (event.currentTarget.target !== "" && event.currentTarget.target !== "_self")
      || event.currentTarget.hasAttribute("download")
    )
      return
    event.preventDefault()
    // Router state already renders operation failures; the anchor consumes the rejection.
    navigate(local as Destination).catch(() => {})
  }
  return createComponent(
    Dynamic,
    mergeProps(anchor, {
      component: "a" as const,
      get href() {
        return href()
      },
      get "aria-current"() {
        return active() ? ("page" as const) : undefined
      },
      get "data-active"() {
        return active() ? "true" : undefined
      },
      onClick
    })
  )
}

/** Navigates on mount or when the tracked destination or state changes. @since 0.1.0 */
export function Navigate(props: Destination): JSX.Element {
  const router = useRuntime()
  const navigate = useNavigate()
  const registry = useContext(RegistryContext)
  let previous: RenderPolicy.NavigationIntent | undefined
  createEffect(() => {
    const result = router.href(props)
    if (Result.isFailure(result)) throw result.failure
    const intent: RenderPolicy.NavigationIntent = {
      href: result.success,
      replace: props.replace === true,
      state: props.state
    }
    if (RenderPolicy.sameIntent(previous, intent)) return
    previous = intent
    // Keep explicit history-state updates observable while pending fallbacks remount
    // this component after its URL is already satisfied.
    if (RenderPolicy.isSatisfied(intent, registry.get(router.core.branch).location)) return
    navigate(props).catch(() => {})
  })
  return undefined
}
