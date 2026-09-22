import type { Destination, NavigationOutcome } from "@effect-stack/router/Router"
import { Router } from "@effect-stack/router"
import { useAtomValue } from "@effect/atom-vue"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { defineComponent, h, type PropType, type VNode, watchEffect } from "vue"
import { useRouterContext, useRouterService } from "./context.ts"

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
export const Link = defineComponent({
  name: "RouterLink",
  inheritAttrs: false,
  props: {
    to: { type: Object as PropType<Destination<string>>, required: true as const }
  },
  setup(props, { attrs }) {
    const context = useRouterContext()
    const navigate = useNavigate()
    const location = useAtomValue(() => context.atomRouter.location)
    return (): VNode | null => {
      const href = Result.getOrThrow(Router.href(props.to))
      const pathname = href.split(/[?#]/)[0] ?? href
      const active = Option.exists(location.value, (value) => value.pathname === pathname)
      return h(
        "a",
        {
          ...attrs,
          href,
          "aria-current": active ? "page" : undefined,
          "data-active": active ? "true" : undefined,
          onClick: (event: MouseEvent) => {
            const handler = attrs.onClick as ((event: MouseEvent) => void) | undefined
            handler?.(event)
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
            void navigate(props.to).catch(() => {})
          }
        },
        undefined
      )
    }
  }
})

/** @since 0.4.0 */
export const Navigate = defineComponent({
  name: "RouterNavigate",
  props: {
    to: { type: Object as PropType<Destination<string>>, required: true as const },
    replace: { type: Boolean, default: false },
    state: { type: null, default: undefined }
  },
  setup(props) {
    const context = useRouterContext()
    const navigate = useNavigate()
    const location = useAtomValue(() => context.atomRouter.location)
    watchEffect(() => {
      const href = Router.href(props.to)
      if (Result.isFailure(href)) return
      const current = Option.getOrUndefined(location.value)
      if (current !== undefined && `${current.pathname}${current.search}${current.hash}` === href.success) return
      void navigate(props.to, {
        replace: props.replace,
        ...(props.state === undefined ? {} : { state: props.state })
      }).catch(() => {})
    })
    return (): null => null
  }
})
