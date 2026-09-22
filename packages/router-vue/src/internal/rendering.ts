import { useAtomValue } from "@effect/atom-vue"
import { Cause } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Option from "effect/Option"
import {
  computed,
  defineComponent,
  h,
  inject,
  onErrorCaptured,
  provide,
  shallowRef,
  type Component,
  type PropType,
  type VNode
} from "vue"
import { depthKey, useRouterContext } from "./context.ts"
import { useRetry } from "./navigation.ts"
import type { ErrorProps, ViewOptions } from "./route.ts"

/** @since 0.4.0 */
export const DefaultPending = defineComponent({
  name: "RouterDefaultPending",
  setup: () => () => h("div", { role: "status" }, "Loading…")
})
/** @since 0.4.0 */
export const DefaultNotFound = defineComponent({
  name: "RouterDefaultNotFound",
  setup: () => () => h("div", { role: "status" }, "Page not found")
})
/** @since 0.4.0 */
export const DefaultError = defineComponent({
  name: "RouterDefaultError",
  props: {
    error: { type: null, default: undefined },
    reset: { type: Function as PropType<() => void>, required: true }
  },
  setup(props) {
    return () =>
      h("div", { role: "alert" }, ["Unable to display this route. ", h("button", { onClick: props.reset }, "Retry")])
  }
})

const ViewBoundary = defineComponent({
  name: "RouterViewBoundary",
  props: {
    view: { type: Object as PropType<ViewOptions>, required: true },
    depth: { type: Number, required: true }
  },
  setup(props) {
    const error = shallowRef<unknown>(undefined)
    onErrorCaptured((captured) => {
      error.value = captured
      return false
    })
    provide(
      depthKey,
      computed(() => props.depth + 1)
    )
    return (): VNode | null => {
      if (error.value !== undefined) {
        const ErrorView = (props.view.error ?? DefaultError) as Component
        return h(
          ErrorView as never,
          {
            error: error.value,
            reset: () => {
              error.value = undefined
            }
          } as ErrorProps
        )
      }
      return props.view.component === undefined ? null : h(props.view.component as never)
    }
  }
})

/**
 * Renders the next route in the active branch.
 *
 * @since 0.4.0
 * @category components
 */
export const Outlet = defineComponent({
  name: "RouterOutlet",
  setup() {
    const context = useRouterContext()
    const state = useAtomValue(() => context.atomRouter.state)
    const injected = inject(depthKey, null)
    const depth = computed(() => (injected === null ? 0 : injected.value))
    const retry = useRetry()
    return (): VNode | null => {
      const result = state.value
      if (!AsyncResult.isSuccess(result)) return null
      const routerState = result.value
      const presentation = Option.getOrUndefined(routerState.presentation)
      if (presentation === undefined) return null
      const resolved = Option.getOrUndefined(routerState.resolved)
      const entries =
        presentation._tag === "Pending" && resolved !== undefined ? resolved.entries : presentation.entries
      const failureOwner = presentation._tag === "Failed" ? presentation.owner : undefined
      const failureError = presentation._tag === "Failed" ? presentation.error : undefined
      if (failureOwner === "<notfound>") return h(DefaultNotFound)
      if (failureOwner !== undefined && !entries.some((candidate) => candidate.id === failureOwner)) {
        // A router-level failure has no owning entry: the root outlet renders
        // it once, descendants defer.
        return depth.value === 0 ? h(DefaultError as never, { error: failureError, reset: retry } as ErrorProps) : null
      }
      const entry = entries[depth.value]
      if (entry === undefined) return null
      const options = context.views.get(entry.id) ?? {}
      if (failureOwner === entry.id && !AsyncResult.isSuccess(entry.data)) {
        const ErrorView = (options.error ?? DefaultError) as Component
        return h(
          ErrorView as never,
          {
            error: AsyncResult.isFailure(entry.data) ? Cause.squash(entry.data.cause) : failureError,
            reset: retry
          } as ErrorProps
        )
      }
      if (!AsyncResult.isSuccess(entry.data) && Option.isNone(entry.retained)) {
        return h((options.pending ?? DefaultPending) as never)
      }
      return h(ViewBoundary, { view: options, depth: depth.value, key: entry.id })
    }
  }
})
