import { RenderPolicy, type Route } from "@effect-stack/router"
import { useAtomValue } from "@effect/atom-react"
import { Atom } from "effect/unstable/reactivity"
import * as React from "react"
import { DepthContext, SnapshotContext, useRuntime } from "./context.ts"
import { useRetry } from "./navigation.tsx"
import type { ErrorProps, Views } from "./route.ts"

export const DefaultPending = () => <div role="status">Loading…</div>
export const DefaultNotFound = () => <div role="status">Page not found</div>
export const DefaultError = ({ reset }: ErrorProps) => (
  <div role="alert">
    Unable to display this route. <button onClick={reset}>Retry</button>
  </div>
)

class RenderBoundary extends React.Component<
  {
    readonly children: React.ReactNode
    readonly fallback: React.ComponentType<ErrorProps>
    readonly reset: () => void
    readonly recoveryKey: object | undefined
  },
  { readonly failed: boolean; readonly error: unknown }
> {
  override state = { failed: false, error: undefined as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error }
  }
  override componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.failed && previous.recoveryKey !== this.props.recoveryKey) {
      this.setState({ failed: false, error: undefined })
    }
  }
  override render() {
    const Fallback = this.props.fallback
    return this.state.failed ? (
      <SnapshotContext.Provider value="incoming">
        <Fallback error={this.state.error} reset={this.props.reset} />
      </SnapshotContext.Provider>
    ) : (
      this.props.children
    )
  }
}

const ReactMemoType = Symbol.for("react.memo")
const ReactLazyType = Symbol.for("react.lazy")
const ReactForwardRefType = Symbol.for("react.forward_ref")
const ReactBuiltinViews = new Set([
  Symbol.for("react.fragment"),
  Symbol.for("react.strict_mode"),
  Symbol.for("react.profiler"),
  Symbol.for("react.suspense"),
  Symbol.for("react.activity")
])
const isReactView = (value: unknown): value is React.ComponentType => {
  if (typeof value === "function") return true
  if (typeof value === "symbol") return ReactBuiltinViews.has(value)
  const exotic =
    typeof value === "object" && value !== null ? (value as { readonly $$typeof?: symbol }).$$typeof : undefined
  return exotic === ReactMemoType || exotic === ReactLazyType || exotic === ReactForwardRefType
}
// Selection stays total; the actionable failure surfaces inside the render boundary so the
// nearest errorComponent catches it with the route ID in the message.
const invalidReactView = (routeId: string, value: unknown): React.ComponentType =>
  function InvalidLazyReactView(): React.ReactNode {
    throw new Error(
      `Route "${routeId}" selected a lazy module view that is not a React component (received ${
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value
      }). Export the page as the module 'default' or 'component' view.`
    )
  }

interface Presentation {
  readonly selection: RenderPolicy.Selection
  readonly route: Route.Any | undefined
  readonly module: unknown
  readonly recoveryKey: object | undefined
}

/** Renders the next route in the active branch. @since 0.1.0 */
export function Outlet(): React.ReactNode {
  const depth = React.useContext(DepthContext)
  const { core } = useRuntime()
  const reset = useRetry()
  const presentation = React.useMemo(
    () =>
      Atom.map(core.branch, (branch) => {
        const selection = RenderPolicy.select(branch, depth, (route, kind) => (route as Views)[kind] !== undefined)
        const entry = branch.matches[depth]
        return {
          selection,
          route: entry?.route,
          module: entry?.result._tag === "Success" ? entry.result.value.module : undefined,
          recoveryKey: entry === undefined ? undefined : RenderPolicy.recoveryKey(branch, entry.route.id)
        }
      }).pipe(
        Atom.withEquality<Presentation>(
          (a, b) =>
            RenderPolicy.sameSelection(a.selection, b.selection)
            && a.route === b.route
            && a.module === b.module
            && a.recoveryKey === b.recoveryKey
        )
      ),
    [core, depth]
  )
  const { selection, route, module, recoveryKey } = useAtomValue(presentation)
  const views = (route ?? {}) as Views
  const View = React.useMemo(() => {
    const lazy = module as { readonly default?: unknown; readonly component?: unknown } | undefined
    const selected: unknown =
      views.component !== undefined
        ? views.component
        : lazy?.component !== undefined
          ? lazy.component
          : lazy?.default !== undefined
            ? lazy.default
            : Outlet
    return isReactView(selected) ? selected : invalidReactView(route?.id ?? "unknown", selected)
  }, [views.component, module, route?.id])
  const content = React.useMemo(
    () => (
      <SnapshotContext.Provider value="resolved">
        <DepthContext.Provider value={depth + 1}>
          <View />
        </DepthContext.Provider>
      </SnapshotContext.Provider>
    ),
    [depth, View, route?.id]
  )
  if (selection._tag === "Empty") return null
  if (selection._tag === "Boundary") {
    if (selection.kind === "errorComponent") {
      const ErrorView = views.errorComponent ?? DefaultError
      return (
        <SnapshotContext.Provider value="incoming">
          <ErrorView error={selection.error} reset={reset} />
        </SnapshotContext.Provider>
      )
    }
    const Fallback =
      selection.kind === "pendingComponent"
        ? (views.pendingComponent ?? DefaultPending)
        : (views.notFoundComponent ?? DefaultNotFound)
    return (
      <SnapshotContext.Provider value="incoming">
        <Fallback />
      </SnapshotContext.Provider>
    )
  }
  return views.errorComponent !== undefined || depth === 0 ? (
    <RenderBoundary
      key={selection.routeId}
      recoveryKey={recoveryKey}
      fallback={views.errorComponent ?? DefaultError}
      reset={reset}
    >
      {content}
    </RenderBoundary>
  ) : (
    <React.Fragment key={selection.routeId}>{content}</React.Fragment>
  )
}
