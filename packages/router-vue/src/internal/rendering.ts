import type { OutletDecision } from "@effect-stack/router/Presentation"
import { outletDecision } from "@effect-stack/router/Presentation"
import { useAtomValue } from "@effect/atom-vue"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import {
  computed,
  defineComponent,
  h,
  inject,
  provide,
  type Component,
  type PropType,
  type VNode,
  type VNodeChild
} from "vue"
import { depthKey, useRouterContext } from "./context.ts"
import { useRetry } from "./navigation.ts"
import type { ResolvedViewOptions } from "./route.ts"

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
    failure: { type: null, default: undefined },
    retry: { type: Function as PropType<() => void>, default: undefined }
  },
  setup(props) {
    return () =>
      h("div", { role: "alert" }, [
        "Unable to display this route. ",
        props.retry === undefined ? null : h("button", { onClick: props.retry }, "Retry")
      ])
  }
})

const ViewRenderer = defineComponent({
  name: "RouterViewRenderer",
  props: {
    view: { type: Object as PropType<ResolvedViewOptions>, required: true }
  },
  setup(props) {
    return (): VNodeChild => (props.view.render === undefined ? null : props.view.render())
  }
})

const ViewScope = defineComponent({
  name: "RouterViewScope",
  props: {
    view: { type: Object as PropType<ResolvedViewOptions>, required: true },
    nextDepth: { type: Number, required: true }
  },
  setup(props) {
    provide(
      depthKey,
      computed(() => props.nextDepth)
    )
    return (): VNode | VNodeChild => {
      if (props.view.render !== undefined) {
        return h(ViewRenderer, { view: props.view })
      }
      return props.view.component === undefined ? null : h(props.view.component)
    }
  }
})

const fallbackView: ResolvedViewOptions = {}

const renderDecision = (
  decision: OutletDecision<ResolvedViewOptions>,
  depth: number,
  retry: () => void,
  pending: Component
): VNode | VNodeChild => {
  switch (decision._tag) {
    case "Empty":
      return null
    case "NotFound":
      return h(DefaultNotFound)
    case "RouterFailure":
      return depth === 0 ? h(DefaultError as never, { failure: decision.failure, retry } as never) : null
    case "Pending":
      return h(pending)
    case "Failure": {
      const ErrorView = (decision.view.error ?? DefaultError) as Component
      return h(ErrorView as never, { failure: decision.failure, retry } as never)
    }
    case "View":
      return h(ViewScope as unknown as Component, {
        key: decision.entry.id,
        view: decision.view,
        nextDepth: decision.nextDepth
      })
  }
}

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
    return (): VNode | VNodeChild => {
      const result = state.value
      if (!AsyncResult.isSuccess(result)) return null
      const decision = outletDecision(result.value, depth.value, context.views, fallbackView)
      return renderDecision(decision, depth.value, retry, context.pending)
    }
  }
})
