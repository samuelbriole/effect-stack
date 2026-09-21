import { RenderPolicy, Router, type RouteTree } from "@effect-stack/router"
import { injectRegistry, useAtomValue } from "@effect/atom-vue"
import { Effect, Option, Result } from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import {
  type AnchorHTMLAttributes,
  computed,
  defineComponent,
  type FunctionalComponent,
  h,
  type PropType,
  watchEffect
} from "vue"
import { useRuntime } from "./context.ts"
import type { Destination, RegisteredRouter } from "./router.ts"

/** Failures accepted by the registered router's awaitable and Effect navigation operations. @since 0.2.0 */
export type NavigationError = Effect.Error<ReturnType<RegisteredRouter["core"]["execute"]>>
/** The provider's registry is supplied; interruption cancels this operation's transition. @since 0.2.0 */
export function useNavigateEffect(): (destination: Destination) => Effect.Effect<void, NavigationError> {
  const { compiled, core } = useRuntime()
  const registry = injectRegistry()
  return (destination) =>
    Effect.suspend(() => {
      const { route, input } = compiled.target(destination)
      return core
        .execute(
          destination.replace
            ? Router.replace<RouteTree.Any>(route, input, destination.state)
            : Router.push<RouteTree.Any>(route, input, destination.state)
        )
        .pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry)) as Effect.Effect<void, NavigationError>
    })
}
/** Awaits this transition's resolution and scoped cleanup; encode failures stay typed. @since 0.1.0 */
export function useNavigate(): (
  destination: Destination,
  options?: { readonly signal?: AbortSignal }
) => Promise<void> {
  const navigate = useNavigateEffect()
  return (destination, options) => Effect.runPromise(navigate(destination), options)
}

const destinationProps = {
  to: { type: String, required: true as const },
  params: Object as PropType<unknown>,
  search: Object as PropType<unknown>,
  hash: { default: undefined },
  replace: Boolean,
  state: { default: undefined }
}
/** @since 0.1.0 */
export type LinkProps = Destination
  & Omit<AnchorHTMLAttributes, "href" | "onClick"> & {
    readonly exact?: boolean
    readonly onClick?: ((event: MouseEvent) => void) | ReadonlyArray<(event: MouseEvent) => void>
  }

/** A real anchor with typed destinations, native events, and reactive active state. @since 0.1.0 */
export const Link = defineComponent({
  name: "RouterLink",
  inheritAttrs: false,
  props: { ...destinationProps, exact: Boolean },
  setup(props, { attrs, slots }) {
    const router = useRuntime()
    const navigate = useNavigate()
    // Active state tracks the selected location projection rather than full router state.
    const locationAtom = Atom.map(router.core.branch, (branch) => branch.location)
    const location = useAtomValue(() => locationAtom)
    const destination = () => props as Destination
    const href = computed(() => {
      const encoded = router.href(destination())
      if (Result.isFailure(encoded)) throw encoded.failure
      return encoded.success
    })
    const onClick = (event: MouseEvent) => {
      const anchor = event.currentTarget as HTMLAnchorElement
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
        || (anchor.target !== "" && anchor.target !== "_self")
        || anchor.hasAttribute("download")
      )
        return
      event.preventDefault()
      // Router state already publishes failures to route boundaries; the bridge consumes them.
      navigate(destination()).catch(() => {})
    }
    return () => {
      const current = location.value
      const pathname = href.value.split(/[?#]/)[0]
      const active =
        Option.isSome(current)
        && (current.value.pathname === pathname
          || (!props.exact && pathname !== "/" && current.value.pathname.startsWith(`${pathname}/`)))
      // Vue dispatches event arrays with its native error handling and
      // stopImmediatePropagation semantics; interception runs last.
      const handlers =
        attrs.onClick === undefined
          ? [onClick]
          : [...(Array.isArray(attrs.onClick) ? attrs.onClick : [attrs.onClick]), onClick]
      return h(
        "a",
        {
          ...attrs,
          href: href.value,
          "aria-current": active ? "page" : undefined,
          "data-active": active ? "true" : undefined,
          onClick: handlers
        },
        slots.default?.()
      )
    }
  }
}) as unknown as FunctionalComponent<LinkProps>

/** Navigates on mount or whenever its structural intent (href, replace, state) changes. @since 0.1.0 */
export const Navigate = defineComponent({
  name: "RouterNavigate",
  inheritAttrs: false,
  props: destinationProps,
  setup(props) {
    const router = useRuntime()
    const navigate = useNavigate()
    const locationAtom = Atom.map(router.core.branch, (branch) => branch.location)
    const location = useAtomValue(() => locationAtom)
    let previous: RenderPolicy.NavigationIntent | undefined
    watchEffect(
      () => {
        const destination = props as Destination
        const encoded = router.href(destination)
        if (Result.isFailure(encoded)) throw encoded.failure
        // State is read reactively here, so structural changes retrigger this effect even
        // when the URL is unchanged.
        const intent: RenderPolicy.NavigationIntent = {
          href: encoded.success,
          replace: props.replace,
          state: props.state
        }
        if (RenderPolicy.sameIntent(previous, intent)) return
        previous = intent
        // Pending boundaries can unmount and remount a declarative redirect. An
        // already-satisfied location, including explicit state, is a no-op.
        if (RenderPolicy.isSatisfied(intent, location.value)) return
        // Router state already publishes failures to route boundaries; the bridge consumes them.
        navigate(destination).catch(() => {})
      },
      { flush: "post" }
    )
    return () => null
  }
}) as unknown as FunctionalComponent<Destination>
