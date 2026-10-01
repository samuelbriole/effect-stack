import type { OutletDecision } from "@effect-stack/router/Presentation"
import { outletDecision } from "@effect-stack/router/Presentation"
import { useAtomValue } from "@effect/atom-solid"
import * as Cause from "effect/Cause"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { createComponent, createMemo, Show, useContext, type Component, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { DepthContext, useRouterContextAccessor } from "./context.ts"
import { useRetry } from "./navigation.ts"
import type { ViewFailureProps, ResolvedViewOptions } from "./route.ts"

/**
 * `Show` with `keyed` children narrows the value for us while preserving the
 * reactive `when` getter.
 */
function Keyed<T>(props: { readonly when: T; readonly children: (value: T) => JSX.Element }): JSX.Element {
  return Show({
    get when() {
      return props.when
    },
    keyed: true,
    children: (value: T) => props.children(value)
  }) as unknown as JSX.Element
}

/** @since 0.4.0 */
export const DefaultPending = (): JSX.Element =>
  createComponent(Dynamic, { component: "div", role: "status", children: "Loading…" })
/** @since 0.4.0 */
export const DefaultNotFound = (): JSX.Element =>
  createComponent(Dynamic, { component: "div", role: "status", children: "Page not found" })

const failureText = (failure: ViewFailureProps["failure"]): string => {
  if (failure._tag === "Domain") return String(failure.error)
  for (const reason of failure.cause.reasons) {
    if (Cause.isFailReason(reason)) return String(reason.error)
  }
  return "cause"
}

/** @since 0.4.0 */
export const DefaultError = (props: Omit<ViewFailureProps, "retry"> & { readonly retry?: () => void }): JSX.Element =>
  createComponent(Dynamic, {
    component: "div",
    role: "alert",
    // Reactive: a router-level failure that changes cause updates this attribute
    // without remounting the boundary.
    get "data-router-failure"() {
      return failureText(props.failure)
    },
    get children() {
      return [
        "Unable to display this route. ",
        props.retry === undefined
          ? null
          : createComponent(Dynamic, { component: "button", onClick: () => props.retry?.(), children: "Retry" })
      ]
    }
  })

const fallbackView: ResolvedViewOptions = {}

const componentIds = new WeakMap<object, number>()
let nextComponentId = 0
const componentKey = (view: ResolvedViewOptions): string => {
  const target = view.component as object | undefined
  if (target === undefined) return "none"
  const existing = componentIds.get(target)
  if (existing !== undefined) return String(existing)
  const id = nextComponentId++
  componentIds.set(target, id)
  return String(id)
}

const renderDecision = (
  selected: () => OutletDecision<ResolvedViewOptions>,
  depthAccessor: (() => number) | undefined,
  reset: () => void
): JSX.Element => {
  const decision = selected()
  switch (decision._tag) {
    case "Empty":
      return null as unknown as JSX.Element
    case "NotFound":
      return createComponent(DefaultNotFound, {})
    case "RouterFailure": {
      const depth = depthAccessor === undefined ? 0 : depthAccessor()
      return depth === 0
        ? createComponent(DefaultError as unknown as Component<ViewFailureProps>, {
            get failure() {
              const current = selected()
              return current._tag === "RouterFailure"
                ? current.failure
                : ({ _tag: "Cause", cause: Cause.empty } as const)
            },
            retry: reset
          })
        : (null as unknown as JSX.Element)
    }
    case "Pending": {
      const context = useRouterContextAccessor()
      return createComponent(Dynamic, {
        get component() {
          return context().pending
        }
      })
    }
    case "Failure": {
      const ErrorView = (decision.view.error ?? DefaultError) as unknown as Component<ViewFailureProps>
      return createComponent(ErrorView, {
        get failure() {
          const current = selected()
          return current._tag === "Failure" ? current.failure : ({ _tag: "Cause", cause: Cause.empty } as const)
        },
        retry: reset
      })
    }
    case "View": {
      const View = decision.view.component as unknown as Component<Record<string, unknown>> | undefined
      return createComponent(DepthContext.Provider, {
        value: () => {
          const current = selected()
          return current._tag === "View" ? current.nextDepth : 0
        },
        get children() {
          return View === undefined ? (null as unknown as JSX.Element) : createComponent(View, {})
        }
      })
    }
  }
}

/** @since 0.4.0 */
export function Outlet(): JSX.Element {
  const depthAccessor = useContext(DepthContext)
  const context = useRouterContextAccessor()
  const result = useAtomValue(() => context().atomRouter.state)
  const reset = useRetry()
  const selected = createMemo<OutletDecision<ResolvedViewOptions>>(() => {
    const value = result()
    if (!AsyncResult.isSuccess(value)) return { _tag: "Empty" }
    const depth = depthAccessor === undefined ? 0 : depthAccessor()
    return outletDecision(value.value, depth, context().views, fallbackView)
  })
  // Mount identity is stable across same-route data updates: the key changes
  // only when the route, component, or transition changes, so component local
  // state and effects survive a data refresh.
  const mountKey = createMemo(() => {
    const decision = selected()
    switch (decision._tag) {
      case "View":
        return `view:${decision.entry.id}:${componentKey(decision.view)}`
      case "Pending":
        return "pending"
      case "Failure":
        return `failure:${decision.entry.id}`
      case "RouterFailure":
        return "router-failure"
      case "NotFound":
        return "not-found"
      default:
        return "empty"
    }
  })
  return Keyed({
    get when() {
      return mountKey()
    },
    children: () => renderDecision(selected, depthAccessor, reset)
  })
}
