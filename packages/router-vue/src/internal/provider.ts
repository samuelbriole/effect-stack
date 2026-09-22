import type { AtomRouter, AtomRuntimeRequirement } from "@effect-stack/router/AtomRouter"
import type { RuntimeNode } from "@effect-stack/router/Router"
import { AtomRouter as AtomRouterModule, Router } from "@effect-stack/router"
import { useAtomValue } from "@effect/atom-vue"
import { Cause, Effect } from "effect"
import type * as Context from "effect/Context"
import * as Option from "effect/Option"
import { computed, defineComponent, h, provide, type Component, type PropType, type VNode } from "vue"
import { routerKey, useRouterContext, useRouterService, type RouterContextValue } from "./context.ts"
import { DefaultError, DefaultPending, Outlet } from "./rendering.ts"
import { flattenViews, type ErrorProps, type Views } from "./route.ts"

const RouterView = defineComponent({
  name: "RouterView",
  props: {
    pending: { type: Object as PropType<Component>, default: undefined },
    error: { type: Object as PropType<Component>, default: undefined }
  },
  setup(props) {
    const context = useRouterContext()
    const state = useAtomValue(() => context.atomRouter.state)
    const service = useRouterService()
    return (): VNode => {
      const result = state.value
      if (result._tag === "Initial") return h((props.pending ?? DefaultPending) as never)
      if (result._tag === "Failure") {
        const ErrorView = (props.error ?? DefaultError) as Component
        return h(
          ErrorView as never,
          {
            error: Cause.squash(result.cause),
            reset: () => {
              void Effect.runPromise(service().retry).catch(() => {})
            }
          } as ErrorProps
        )
      }
      if (Option.isNone(result.value.presentation)) return h((props.pending ?? DefaultPending) as never)
      return h(Outlet)
    }
  }
})

/** @since 0.4.0 */
export interface RouterProviderProps<C extends { readonly service: Context.Key<string, unknown> }, R, ER> {
  readonly routes: C
  readonly runtime: AtomRuntimeRequirement<C, R, ER>
  readonly views: Views<C>
  readonly pending?: Component
  readonly error?: Component<ErrorProps>
}

const RouterProviderImpl = defineComponent({
  name: "RouterProvider",
  inheritAttrs: false,
  props: {
    routes: { type: Object, required: true as const },
    runtime: { type: Object, required: true as const },
    views: { type: Object, required: true as const },
    pending: { type: Object as PropType<Component>, default: undefined },
    error: { type: Object as PropType<Component>, default: undefined }
  },
  setup(props) {
    const atomRouter = computed(
      () => AtomRouterModule.make(props.runtime as never, props.routes as never) as AtomRouter<unknown>
    )
    const views = computed(() =>
      flattenViews(Router.nodes(props.routes) as Record<string, RuntimeNode>, props.views as Views<never>)
    )
    const value: RouterContextValue = {
      get atomRouter() {
        return atomRouter.value
      },
      get views() {
        return views.value
      }
    }
    provide(routerKey, value)
    return () =>
      h(RouterView, {
        ...(props.pending === undefined ? {} : { pending: props.pending }),
        ...(props.error === undefined ? {} : { error: props.error })
      })
  }
})

/**
 * Provides a contract's router atoms and views over a caller-supplied runtime.
 * Use the exported `RouterProviderProps` type to require that the runtime
 * supplies the contract's service identifier.
 *
 * @since 0.4.0
 * @category components
 */
export const RouterProvider = RouterProviderImpl
