import type { Route, RouteTree } from "@effect-stack/router"
import { injectRegistry, registryKey, useAtomValue } from "@effect/atom-vue"
import { Cause, Effect } from "effect"
import { Atom, AtomRegistry } from "effect/unstable/reactivity"
import { defineComponent, h, onScopeDispose, type PropType, provide, type VNode } from "vue"
import { branchKey, depthKey, routerKey, snapshotKey } from "./context.ts"
import { DefaultError, DefaultPending, FallbackSnapshot, Outlet } from "./rendering.ts"
import type { Views } from "./route.ts"
import type { ClientRouter, RuntimeRouter } from "./router.ts"

const routerProps = { router: { type: Object as PropType<RuntimeRouter>, required: true as const } }
const RegistryOwner = defineComponent({
  name: "RouterRegistryOwner",
  inheritAttrs: false,
  props: { ...routerProps, registry: Object as PropType<AtomRegistry.AtomRegistry> },
  setup(props) {
    const registry = props.registry ?? AtomRegistry.make()
    if (props.registry === undefined) onScopeDispose(() => registry.dispose())
    provide(registryKey, registry)
    let current = props.router
    let generation = 0
    return () => {
      if (props.router !== current) {
        current = props.router
        generation++
      }
      return h(RouterView, { router: current, key: generation })
    }
  }
})

/** Owns a registry by default; a supplied registry remains caller-owned. @since 0.1.0 */
export const RouterProvider = defineComponent({
  name: "RouterProvider",
  inheritAttrs: false,
  props: { ...routerProps, registry: Object as PropType<AtomRegistry.AtomRegistry> },
  setup(props) {
    let current = props.registry
    let generation = 0
    return () => {
      if (props.registry !== current) {
        current = props.registry
        generation++
      }
      return h(RegistryOwner, {
        router: props.router,
        ...(current === undefined ? {} : { registry: current }),
        key: generation
      })
    }
  }
}) as unknown as <T extends RouteTree.Any, E>(props: {
  readonly router: ClientRouter<T, E>
  readonly registry?: AtomRegistry.AtomRegistry
}) => VNode

const RouterView = defineComponent({
  name: "RouterView",
  inheritAttrs: false,
  props: routerProps,
  setup(props) {
    const { core } = props.router
    provide(routerKey, props.router)
    provide(snapshotKey, "resolved")
    const registry = injectRegistry()
    onScopeDispose(registry.mount(core.navigation))
    const branch = useAtomValue(() => core.branch)
    provide(branchKey, branch)
    provide(depthKey, 0)
    const root = core.routes[0] as Route.Any & Views
    // The provider's core and registry are already resolved; a hook would re-inject
    // from this same component, where Vue only walks the parent chain.
    const retry = () => {
      void Effect.runPromise(core.retry.pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))).catch(
        () => {}
      )
    }
    const startup = Atom.map(core.branch, (value) =>
      value.matches.length > 0 ? undefined : value.result._tag === "Failure" ? Cause.squash(value.result.cause) : null
    )
    const startupError = useAtomValue(() => startup)
    return () => {
      const error = startupError.value
      if (error === undefined) return h(Outlet)
      if (error !== null) {
        return h(FallbackSnapshot, null, {
          default: () => h(root.errorComponent ?? DefaultError, { error, reset: retry })
        })
      }
      return h(root.pendingComponent ?? DefaultPending)
    }
  }
})
