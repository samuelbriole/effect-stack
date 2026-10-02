import { AtomRouter } from "@effect-stack/router"
import type { RouterRuntimeRequirement } from "@effect-stack/router/AtomRouter"
import { finishApplication, getApplicationViews } from "@effect-stack/router/Adapter"
import * as Router from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-vue"
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { computed, defineComponent, h, provide, toRaw, type Component, type PropType, type VNodeChild } from "vue"
import { depthKey, routerKey, type RouterContextValue } from "./context.ts"
import { DefaultError, DefaultPending, Outlet } from "./rendering.ts"
import { engine } from "./route.ts"

/** Props for the standalone provider. @since 0.4.0 */
export interface RouterProviderProps<R, ER> {
  readonly runtime: RouterRuntimeRequirement<R, ER>
  readonly pending?: Component
}

const MountedRouter = defineComponent({
  name: "RouterMountedApplication",
  inheritAttrs: false,
  props: {
    app: { type: Object as PropType<Router.ApplicationWitness>, required: true as const },
    runtime: {
      type: Object as PropType<RouterRuntimeRequirement<Router.RuntimeApplication, unknown>>,
      required: true as const
    },
    pending: { type: [Object, Function] as PropType<Component>, default: DefaultPending }
  },
  setup(props) {
    // Vue may proxy an application selected through ref/reactive. Unwrap only
    // the framework proxy; core still validates the exact registered witness.
    const views = computed(() => getApplicationViews(engine, toRaw(props.app)))
    const atomRouter = computed(() => {
      void views.value
      return AtomRouter.make(toRaw(props.runtime), toRaw(props.app))
    })
    const value: RouterContextValue = {
      get atomRouter() {
        return atomRouter.value as unknown as RouterContextValue["atomRouter"]
      },
      get views() {
        return views.value
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
    const state = useAtomValue(() => atomRouter.value.state)
    return () => {
      const result = state.value
      if (result._tag === "Failure") {
        return h(DefaultError as never, { failure: { _tag: "Cause", cause: result.cause } } as never)
      }
      if (result._tag === "Initial" || Option.isNone(result.value.presentation)) return h(props.pending)
      return h(Outlet)
    }
  }
})

const RouterProviderImpl = defineComponent({
  name: "RouterProvider",
  inheritAttrs: false,
  props: {
    runtime: {
      type: Object as PropType<RouterRuntimeRequirement<Router.RuntimeApplication, unknown>>,
      required: true as const
    },
    pending: { type: [Object, Function] as PropType<Component>, default: DefaultPending }
  },
  setup(props) {
    const selected = computed(() => toRaw(props.runtime).atom(Router.RuntimeApplication))
    const result = useAtomValue(() => selected.value)
    return (): VNodeChild => {
      const current = result.value
      if (current._tag === "Initial") return h(props.pending)
      if (current._tag === "Failure") {
        return h(DefaultError as never, { failure: { _tag: "Cause", cause: current.cause } } as never)
      }
      return h(MountedRouter, { app: current.value.app, runtime: props.runtime, pending: props.pending })
    }
  }
})

/** Renders the single application acquired by the supplied runtime. @since 0.4.0 */
export function RouterProvider<R = Router.RuntimeApplication, ER = unknown>(
  props: RouterProviderProps<R, ER>
): VNodeChild
export function RouterProvider(props: RouterProviderProps<Router.RuntimeApplication, unknown>): VNodeChild
export function RouterProvider<R, ER>(props: RouterProviderProps<R, ER>): VNodeChild {
  // The public requirement proves the standard selection tag is present. Vue's
  // private component erases only the runtime's additional services and errors.
  return h(RouterProviderImpl, {
    ...props,
    runtime: props.runtime as unknown as RouterRuntimeRequirement<Router.RuntimeApplication, unknown>
  })
}

/** Lazily assembles a fresh application per execution; invalid definitions are defects. @since 0.4.0 */
export function make<
  const AppId extends string,
  const Defs extends readonly [Router.AnyDefinitionShape, ...Array<Router.AnyDefinitionShape>]
>(appId: AppId, definitions: Defs): Effect.Effect<Router.ApplicationOf<AppId, Defs>> {
  return finishApplication(engine, appId, definitions)
}
