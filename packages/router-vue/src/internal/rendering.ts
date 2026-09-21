import { RenderPolicy, type Route, Router } from "@effect-stack/router"
import { injectRegistry } from "@effect/atom-vue"
import { Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import {
  type Component,
  computed,
  defineComponent,
  h,
  inject,
  onErrorCaptured,
  type PropType,
  provide,
  shallowRef,
  type VNode,
  watch
} from "vue"
import { branchKey, depthKey, snapshotKey, useRuntime } from "./context.ts"
import type { ErrorProps, Views } from "./route.ts"

export const DefaultPending = () => h("div", { role: "status" }, "Loading…")
export const DefaultNotFound = () => h("div", { role: "status" }, "Page not found")
export const DefaultError = (props: ErrorProps) =>
  h("div", { role: "alert" }, ["Unable to display this route. ", h("button", { onClick: props.reset }, "Retry")])

// Fallback views describe the incoming navigation's decoded inputs, while ordinary
// views keep the resolved input paired with the data it loaded.
export const FallbackSnapshot = defineComponent({
  name: "RouteFallbackSnapshot",
  inheritAttrs: false,
  setup(_props, { slots }) {
    provide(snapshotKey, "incoming")
    return () => slots.default?.()
  }
})

// A Vue component is a function or options object; primitives and arrays cannot render.
const isVueView = (value: unknown): value is Component =>
  typeof value === "function" || (typeof value === "object" && value !== null && !Array.isArray(value))
// Selection stays total; the actionable failure surfaces inside the render boundary so the
// nearest errorComponent catches it with the route ID in the message.
const invalidVueView = (routeId: string, value: unknown): Component =>
  function InvalidLazyVueView(): VNode {
    throw new Error(
      `Route "${routeId}" selected a lazy module view that is not a Vue component (received ${
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value
      }). Export the page as the module 'default' or 'component' view.`
    )
  }

const declaresFallback = (route: Route.Any, kind: RenderPolicy.BoundaryKind): boolean =>
  (route as Views)[kind] !== undefined

// `??` would also skip present-but-null exports; only undefined keeps the next fallback.
const selectVueView = (route: Route.Any & Views, module: unknown): unknown => {
  const lazy = module as { readonly component?: Component; readonly default?: Component } | undefined
  if (route.component !== undefined) return route.component
  if (lazy?.component !== undefined) return lazy.component
  if (lazy?.default !== undefined) return lazy.default
  return Outlet
}

const RenderBoundary = defineComponent({
  name: "RouteRenderBoundary",
  inheritAttrs: false,
  props: {
    route: { type: Object as PropType<Route.Any & Views>, required: true },
    refresh: { type: Function as PropType<() => void>, required: true }
  },
  setup(props, { slots }) {
    const branch = inject(branchKey)
    if (branch === undefined) throw new Error("Route render boundaries require an active route branch")
    const failure = shallowRef<{ readonly error: unknown }>()
    onErrorCaptured((error) => {
      failure.value = { error }
      return false
    })
    // A latched render error releases only when a completed successful transition
    // covers this route, never the moment Retry dispatches its refresh.
    const recovery = computed(() => RenderPolicy.recoveryKey(branch.value, props.route.id))
    watch(
      recovery,
      () => {
        failure.value = undefined
      },
      { flush: "sync" }
    )
    const reset = () => props.refresh()
    return () => {
      const latched = failure.value
      if (latched === undefined) return slots.default?.()
      return h(FallbackSnapshot, null, {
        default: () => h(props.route.errorComponent ?? DefaultError, { error: latched.error, reset })
      })
    }
  }
})

/** Renders the next match while preserving same-route Vue component instances. @since 0.1.0 */
export const Outlet = defineComponent({
  name: "RouterOutlet",
  inheritAttrs: false,
  setup() {
    const { core } = useRuntime()
    const registry = injectRegistry()
    const branch = inject(branchKey)
    if (branch === undefined) throw new Error("Outlet requires an active route branch")
    const depth = inject(depthKey, 0)
    provide(depthKey, depth + 1)
    let cached: RenderPolicy.Selection | undefined
    // Selected presentation subscriptions observe their selection, not every branch publication.
    const selection = computed(() => {
      const next = RenderPolicy.select(branch.value, depth, declaresFallback)
      if (cached !== undefined && RenderPolicy.sameSelection(cached, next)) return cached
      cached = next
      return next
    })
    // The boundary reset follows its own invocation through `execute`;
    // failures surface in the branch snapshots like any transition.
    const refresh = () => {
      void Effect.runPromise(
        core.execute(Router.refresh).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
      ).catch(() => {})
    }
    return () => {
      const selected = selection.value
      if (selected._tag === "Empty") return null
      const route = branch.value.matches[depth]?.route as (Route.Any & Views) | undefined
      if (route === undefined) return null
      if (selected._tag === "Boundary") {
        const view =
          selected.kind === "errorComponent"
            ? (route.errorComponent ?? DefaultError)
            : selected.kind === "pendingComponent"
              ? (route.pendingComponent ?? DefaultPending)
              : (route.notFoundComponent ?? DefaultNotFound)
        return h(
          FallbackSnapshot,
          { key: `${route.id}:${selected.kind}` },
          {
            default: () => h(view, selected.kind === "errorComponent" ? { error: selected.error, reset: refresh } : {})
          }
        )
      }
      const entry = branch.value.matches[depth]
      const module = entry?.result._tag === "Success" ? entry.result.value.module : undefined
      const selectedView = selectVueView(route, module)
      const component = isVueView(selectedView) ? selectedView : invalidVueView(route.id, selectedView)
      const view = () => h(component, { key: route.id })
      if (route.errorComponent === undefined && depth !== 0) return view()
      return h(RenderBoundary, { key: route.id, route, refresh }, { default: view })
    }
  }
})
