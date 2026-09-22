import { useAtomValue } from "@effect/atom-solid"
import { Cause } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Option from "effect/Option"
import { createComponent, createMemo, ErrorBoundary, type JSX, Show, useContext } from "solid-js"
import { Dynamic } from "solid-js/web"
import { DepthContext, useRouterContextAccessor } from "./context.ts"
import { useRetry } from "./navigation.ts"
import type { ErrorProps, ViewOptions } from "./route.ts"

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
/** @since 0.4.0 */
export const DefaultError = (props: ErrorProps): JSX.Element =>
  createComponent(Dynamic, {
    component: "div",
    role: "alert",
    children: [
      "Unable to display this route. ",
      createComponent(Dynamic, { component: "button", onClick: () => props.reset(), children: "Retry" })
    ]
  })

type OutletState =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "RouterError"; readonly error: unknown }
  | { readonly _tag: "Pending"; readonly options: ViewOptions }
  | { readonly _tag: "Error"; readonly options: ViewOptions; readonly error: unknown }
  | { readonly _tag: "View"; readonly id: string; readonly options: ViewOptions }

/** @since 0.4.0 */
export function Outlet(): JSX.Element {
  const depthAccessor = useContext(DepthContext)
  const context = useRouterContextAccessor()
  const result = useAtomValue(() => context().atomRouter.state)
  const reset = useRetry()
  const selected = createMemo<OutletState>(() => {
    const value = result()
    if (!AsyncResult.isSuccess(value)) return { _tag: "Empty" }
    const state = value.value
    const presentation = Option.getOrUndefined(state.presentation)
    if (presentation === undefined) return { _tag: "Empty" }
    const resolved = Option.getOrUndefined(state.resolved)
    const entries = presentation._tag === "Pending" && resolved !== undefined ? resolved.entries : presentation.entries
    const failureOwner = presentation._tag === "Failed" ? presentation.owner : undefined
    const failureError = presentation._tag === "Failed" ? presentation.error : undefined
    const depth = depthAccessor === undefined ? 0 : depthAccessor()
    if (failureOwner === "<notfound>") return { _tag: "NotFound" }
    if (failureOwner !== undefined && !entries.some((candidate) => candidate.id === failureOwner)) {
      return depth === 0 ? { _tag: "RouterError", error: failureError } : { _tag: "Empty" }
    }
    const entry = entries[depth]
    if (entry === undefined) return { _tag: "Empty" }
    const options = context().views.get(entry.id) ?? {}
    if (failureOwner === entry.id && !AsyncResult.isSuccess(entry.data)) {
      return {
        _tag: "Error",
        options,
        error: AsyncResult.isFailure(entry.data) ? Cause.squash(entry.data.cause) : failureError
      }
    }
    if (!AsyncResult.isSuccess(entry.data) && Option.isNone(entry.retained)) {
      return { _tag: "Pending", options }
    }
    return { _tag: "View", id: entry.id, options }
  })
  return Keyed({
    get when() {
      return selected()
    },
    children: (state) => {
      if (state._tag === "NotFound") return createComponent(DefaultNotFound, {})
      if (state._tag === "RouterError") return createComponent(DefaultError, { error: state.error, reset })
      if (state._tag === "Empty") return null
      if (state._tag === "Pending") return createComponent(state.options.pending ?? DefaultPending, {})
      if (state._tag === "Error") {
        const ErrorView = state.options.error ?? DefaultError
        return createComponent(ErrorView, { error: state.error, reset })
      }
      if (state._tag === "View") {
        const View = state.options.component
        return createComponent(ErrorBoundary, {
          fallback: (error: unknown, boundaryReset: () => void) =>
            createComponent(state.options.error ?? DefaultError, {
              error,
              reset: () => {
                boundaryReset()
                reset()
              }
            }),
          get children() {
            return createComponent(DepthContext.Provider, {
              value: () => (depthAccessor === undefined ? 1 : depthAccessor() + 1),
              get children() {
                return View === undefined ? null : createComponent(View, {})
              }
            })
          }
        })
      }
      return null
    }
  })
}
