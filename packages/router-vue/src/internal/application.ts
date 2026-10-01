import { AtomRouter } from "@effect-stack/router"
import type { AtomRuntimeRequirement, ApplicationServiceIdOf } from "@effect-stack/router/AtomRouter"
import { finishApplication, getApplicationViews } from "@effect-stack/router/Adapter"
import type * as Router from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-vue"
import type { Key } from "effect/Context"
import * as Option from "effect/Option"
import { computed, defineComponent, h, provide, toRaw, type Component, type PropType, type VNodeChild } from "vue"
import { depthKey, routerKey, useRouterContext, type RouterContextValue } from "./context.ts"
import { DefaultError, DefaultPending, Outlet } from "./rendering.ts"
import { engine } from "./route.ts"

/** Structural application evidence, without widening its invariant service. @since 0.4.0 */
export interface ApplicationShape {
  readonly appId: string
  readonly routes: unknown
  readonly token: object
  readonly service: Key<string, unknown>
}

/** Props for the standalone provider. @since 0.4.0 */
export interface ProviderProps<App extends ApplicationShape, R, ER> {
  readonly app: App
  readonly runtime: AtomRuntimeRequirement<NoInfer<App>, R, ER>
  readonly pending?: Component
}

const RouterView = defineComponent({
  name: "RouterView",
  setup() {
    const context = useRouterContext()
    const state = useAtomValue(() => context.atomRouter.state)
    return () => {
      const result = state.value
      if (result._tag === "Initial") return h(context.pending)
      if (result._tag === "Failure") {
        return h(DefaultError as never, { failure: { _tag: "Cause", cause: result.cause } } as never)
      }
      if (Option.isNone(result.value.presentation)) return h(context.pending)
      return h(Outlet)
    }
  }
})

const ProviderImpl = defineComponent({
  name: "RouterProvider",
  inheritAttrs: false,
  props: {
    app: { type: Object as PropType<ApplicationShape>, required: true as const },
    runtime: { type: Object, required: true as const },
    pending: { type: [Object, Function] as PropType<Component>, default: DefaultPending }
  },
  setup(props) {
    // Vue may proxy an application selected through ref/reactive. Unwrap only
    // the framework proxy; core still validates the exact registered witness.
    const atomRouter = computed(() => AtomRouter.make(props.runtime as never, toRaw(props.app)))
    const value: RouterContextValue = {
      get atomRouter() {
        return atomRouter.value as unknown as RouterContextValue["atomRouter"]
      },
      get views() {
        return getApplicationViews(engine, toRaw(props.app))
      },
      get pending() {
        return props.pending
      }
    }
    provide(routerKey, value)
    provide(
      depthKey,
      computed(() => 0)
    )
    return () => h(RouterView)
  }
})

/**
 * Use `h(Provider<typeof App>, { app: App, runtime })`: Vue's h overload cannot
 * infer application evidence. This form erases runtime construction errors, but
 * retains service checks. Direct calls infer the supplied runtime's E/R.
 * @since 0.4.0
 */
// oxlint-disable typescript/no-explicit-any -- Vue component calls erase the runtime's construction error channel.
export function Provider<App extends ApplicationShape, R = ApplicationServiceIdOf<NoInfer<App>>, ER = any>(
  props: ProviderProps<App, R, ER>
): VNodeChild {
  return h(ProviderImpl, props)
}
// oxlint-enable typescript/no-explicit-any

/** Creates the canonical application, including the selected ancestor closure. @since 0.4.0 */
export function make<
  const AppId extends string,
  const Defs extends readonly [Router.AnyDefinitionShape, ...Array<Router.AnyDefinitionShape>]
>(appId: AppId, definitions: Defs): Router.ApplicationOf<AppId, Defs> {
  return finishApplication(engine, appId, definitions)
}
