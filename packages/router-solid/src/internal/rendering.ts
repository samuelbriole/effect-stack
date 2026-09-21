import { RenderPolicy, type Route } from "@effect-stack/router"
import { useAtomValue } from "@effect/atom-solid"
import { Atom } from "effect/unstable/reactivity"
import {
  type Component,
  createComponent,
  createEffect,
  createMemo,
  ErrorBoundary,
  type JSX,
  Show,
  untrack,
  useContext
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { DepthContext, SnapshotContext, useRuntime } from "./context.ts"
import { useRetry } from "./navigation.ts"
import type { ErrorProps, Views } from "./route.ts"

export function Keyed<T>(
  props: {
    readonly when: T | undefined
    readonly children: (value: NonNullable<T>) => JSX.Element
    readonly fallback?: JSX.Element
  }
): JSX.Element {
  // Show uses callback arity to distinguish render functions from JSX accessors.
  // Always supply a one-argument callback, even when a caller ignores the value.
  return Show({
    get when() {
      return props.when
    },
    keyed: true,
    get fallback() {
      return props.fallback
    },
    children: (value: NonNullable<T>) => props.children(value)
  })
}

export const DefaultPending: Component = () =>
  createComponent(Dynamic, { component: "div", role: "status", children: "Loading…" })
export const DefaultNotFound: Component = () =>
  createComponent(Dynamic, { component: "div", role: "status", children: "Page not found" })
export const DefaultError: Component<ErrorProps> = (props) =>
  createComponent(Dynamic, {
    component: "div",
    role: "alert",
    get children() {
      return [
        "Unable to display this route. ",
        createComponent(Dynamic, { component: "button", onClick: () => props.reset(), children: "Retry" })
      ]
    }
  })

const isSolidView = (value: unknown): value is Component => typeof value === "function"
// Selection stays total; the actionable failure surfaces inside the render boundary so the
// nearest errorComponent catches it with the route ID in the message.
const invalidSolidView = (routeId: string, value: unknown): Component =>
  function InvalidLazySolidView(): JSX.Element {
    throw new Error(
      `Route "${routeId}" selected a lazy module view that is not a Solid component (received ${
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value
      }). Export the page as the module 'default' or 'component' view.`
    )
  }

const declaresView = (route: Route.Any, kind: RenderPolicy.BoundaryKind): boolean =>
  (route as Views)[kind] !== undefined

interface Presentation {
  readonly selection: RenderPolicy.Selection
  readonly route: (Route.Any & Views) | undefined
  readonly module: unknown
  readonly recoveryKey: object | undefined
}

/** Renders the next match with stable route owners and native Solid boundaries. @since 0.1.0 */
export function Outlet(): JSX.Element {
  const depth = useContext(DepthContext)
  const { core } = useRuntime()
  const reset = useRetry()
  const presentation = Atom.map(core.branch, (branch): Presentation => {
    const selection = RenderPolicy.select(branch, depth, declaresView)
    const entry = branch.matches[depth]
    return {
      selection,
      route: entry?.route as (Route.Any & Views) | undefined,
      module: entry?.result._tag === "Success" ? entry.result.value.module : undefined,
      recoveryKey: entry === undefined ? undefined : RenderPolicy.recoveryKey(branch, entry.route.id)
    }
  }).pipe(
    Atom.withEquality<Presentation>((left, right) =>
      RenderPolicy.sameSelection(left.selection, right.selection) &&
      left.route === right.route && left.module === right.module && left.recoveryKey === right.recoveryKey
    )
  )
  const current = useAtomValue(() => presentation)
  const ownerKey = createMemo((): string | undefined => {
    const selection = current().selection
    if (selection._tag === "Empty") return undefined
    return selection._tag === "View" ? `${selection.routeId}:view` : `${selection.routeId}:boundary:${selection.kind}`
  })
  return createComponent(Keyed<string>, {
    get when() {
      return ownerKey()
    },
    children: (_key: string) => {
      const initial = untrack(current)
      const route = initial.route as Route.Any & Views
      const provideDepth = (children: () => JSX.Element) =>
        createComponent(DepthContext.Provider, {
          value: depth + 1,
          get children() {
            return children()
          }
        })
      // Loader, pending, and not-found boundaries render their fallback directly,
      // bypassing latched render errors through the shared presentation policy.
      if (initial.selection._tag === "Boundary") {
        const kind = initial.selection.kind
        if (kind === "errorComponent") {
          const ErrorView = route.errorComponent ?? DefaultError
          return provideDepth(() =>
            createComponent(SnapshotContext.Provider, {
              value: "incoming" as const,
              get children() {
                return createComponent(Dynamic, {
                  component: ErrorView,
                  get error() {
                    const selection = current().selection
                    return selection._tag === "Boundary" ? selection.error : undefined
                  },
                  reset
                })
              }
            })
          )
        }
        const Fallback = kind === "pendingComponent"
          ? route.pendingComponent ?? DefaultPending
          : route.notFoundComponent ?? DefaultNotFound
        return provideDepth(() =>
          createComponent(SnapshotContext.Provider, {
            value: "incoming" as const,
            get children() {
              return createComponent(Fallback, {})
            }
          })
        )
      }
      const view = createMemo((): Component => {
        const snapshot = current()
        const lazy = snapshot.module as { readonly default?: unknown; readonly component?: unknown } | undefined
        const selected: unknown = snapshot.route?.component !== undefined ?
          snapshot.route.component
          : lazy?.component !== undefined ?
          lazy.component
          : lazy?.default !== undefined ?
          lazy.default
          : Outlet
        return isSolidView(selected) ? selected : invalidSolidView(snapshot.route?.id ?? "unknown", selected)
      })
      const contentView = () =>
        createComponent(Dynamic, {
          get component() {
            return view()
          }
        })
      const viewContent = () =>
        createComponent(SnapshotContext.Provider, {
          value: "resolved" as const,
          get children() {
            return contentView()
          }
        })
      // Branch boundaries replace a latched render error and bubble their own
      // rendering failures to an ancestor, just like ordinary route components.
      if (route.errorComponent === undefined && depth !== 0) return provideDepth(viewContent)
      let clearLatch: (() => void) | undefined
      let recovery = untrack(() => current().recoveryKey)
      createEffect(() => {
        const next = current().recoveryKey
        if (next === recovery) return
        recovery = next
        // A latched render error clears only after a successful completed transition
        // includes this boundary's route, never from the reset callback directly.
        untrack(() => clearLatch?.())
      })
      return provideDepth(() =>
        createComponent(ErrorBoundary, {
          fallback: (error: unknown, clear: () => void) => {
            clearLatch = clear
            return createComponent(SnapshotContext.Provider, {
              value: "incoming" as const,
              get children() {
                return createComponent(route.errorComponent ?? DefaultError, { error, reset })
              }
            })
          },
          get children() {
            return viewContent()
          }
        })
      )
    }
  })
}
