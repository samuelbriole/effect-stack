import { RenderPolicy, Route, Router, type RouteTree } from "@effect-stack/router"
import { RegistryContext, useAtomValue } from "@effect/atom-react"
import { Effect, Option, Result } from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import * as React from "react"
import { useRuntime } from "./context.ts"
import type { Destination, RegisteredRouter } from "./router.ts"

/** @since 0.2.0 */
export type NavigationError = Effect.Error<ReturnType<RegisteredRouter["core"]["execute"]>>
/** The provider's registry is supplied; interruption cancels this operation's transition. @since 0.2.0 */
export function useNavigateEffect(): (destination: Destination) => Effect.Effect<void, NavigationError> {
  const { core, compiled } = useRuntime()
  const registry = React.useContext(RegistryContext)
  return React.useCallback((destination: Destination) =>
    Effect.suspend(() => {
      const { route, input } = compiled.target(destination)
      return core.execute(
        destination.replace
          ? Router.replace<RouteTree.Any>(route, input, destination.state)
          : Router.push<RouteTree.Any>(route, input, destination.state)
      ).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
    }) as Effect.Effect<void, NavigationError>, [core, compiled, registry])
}
/** Awaits this transition's resolution and scoped cleanup. @since 0.1.0 */
export function useNavigate(): (
  destination: Destination,
  options?: { readonly signal?: AbortSignal }
) => Promise<void> {
  const navigate = useNavigateEffect()
  return React.useCallback((destination, options) => Effect.runPromise(navigate(destination), options), [navigate])
}
export function useRetry(): () => void {
  const { core } = useRuntime()
  const registry = React.useContext(RegistryContext)
  return React.useCallback(() => {
    void Effect.runPromise(core.retry.pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))).catch(() => {})
  }, [core, registry])
}

/** Real anchors with typed destinations and native modified-click behavior. @since 0.1.0 */
export function Link(
  props: Destination & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { readonly exact?: boolean }
): React.ReactNode {
  const { to, params, search, hash, replace, state, exact = false, onClick, ...anchor } = props
  const router = useRuntime()
  const navigate = useNavigate()
  const destination = { to, params, search, hash, replace, state } as Destination
  const { route, input } = router.compiled.target(destination)
  const href = Route.href(route, input)
  if (Result.isFailure(href)) throw href.failure
  const pathname = href.success.split(/[?#]/)[0]
  const activeAtom = React.useMemo(() =>
    Atom.map(router.core.branch, (branch) =>
      Option.isSome(branch.location) &&
      (branch.location.value.pathname === pathname ||
        (!exact && pathname !== "/" && branch.location.value.pathname.startsWith(`${pathname}/`)))), [
    router,
    pathname,
    exact
  ])
  const active = useAtomValue(activeAtom)
  return (
    <a
      {...anchor}
      href={href.success}
      aria-current={active ? "page" : undefined}
      data-active={active ? "true" : undefined}
      onClick={(event) => {
        onClick?.(event)
        if (
          event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey ||
          event.altKey || (anchor.target !== undefined && anchor.target !== "_self") ||
          (anchor.download !== undefined && anchor.download !== false)
        ) return
        event.preventDefault()
        void navigate(destination).catch(() => {})
      }}
    />
  )
}

/** Navigates when mounted or when its destination changes. @since 0.1.0 */
export function Navigate(props: Destination) {
  const navigate = useNavigate()
  const router = useRuntime()
  const registry = React.useContext(RegistryContext)
  const latest = React.useRef(props)
  latest.current = props
  const href = router.href(props)
  if (Result.isFailure(href)) throw href.failure
  const url = href.success
  const previous = React.useRef<
    { readonly intent: RenderPolicy.NavigationIntent; readonly navigate: typeof navigate } | undefined
  >(undefined)
  React.useEffect(() => {
    const intent = { href: url, replace: latest.current.replace === true, state: latest.current.state }
    if (previous.current?.navigate === navigate && RenderPolicy.sameIntent(previous.current.intent, intent)) return
    previous.current = { intent, navigate }
    if (RenderPolicy.isSatisfied(intent, registry.get(router.core.branch).location)) return
    void navigate(latest.current).catch(() => {})
  }, [navigate, props.replace, props.state, registry, router, url])
  return null
}
