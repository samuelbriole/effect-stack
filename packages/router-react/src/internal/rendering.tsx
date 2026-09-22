import type { RouterState } from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-react"
import { Cause } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Option from "effect/Option"
import * as React from "react"
import { DepthContext, useRouterContext } from "./context.ts"
import { useRetry } from "./navigation.tsx"
import type { ErrorProps, ViewOptions } from "./route.ts"

/** @since 0.4.0 */
export const DefaultPending = (): React.ReactNode => <div role="status">Loading…</div>
/** @since 0.4.0 */
export const DefaultNotFound = (): React.ReactNode => <div role="status">Page not found</div>
/** @since 0.4.0 */
export const DefaultError = ({ reset }: ErrorProps): React.ReactNode => (
  <div role="alert">
    Unable to display this route. <button onClick={reset}>Retry</button>
  </div>
)

interface Display {
  readonly entries: RouterState<unknown>["presentation"] extends Option.Option<infer P>
    ? P extends { readonly entries: infer E }
      ? E
      : never
    : never
  readonly failureOwner?: string
  readonly failureError?: unknown
}

const displayOf = (state: RouterState<unknown>): Display => {
  const presentation = Option.getOrUndefined(state.presentation)
  if (presentation === undefined) return { entries: [] }
  if (presentation._tag === "Pending") {
    const resolved = Option.getOrUndefined(state.resolved)
    return { entries: (resolved?.entries ?? presentation.entries) as Display["entries"] }
  }
  if (presentation._tag === "Resolved") return { entries: presentation.entries as Display["entries"] }
  return {
    entries: presentation.entries as Display["entries"],
    failureOwner: presentation.owner,
    failureError: presentation.error
  }
}

class RenderBoundary extends React.Component<
  {
    readonly children: React.ReactNode
    readonly fallback: React.ComponentType<ErrorProps>
    readonly reset: () => void
    readonly recoveryKey: string
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
    if (this.state.failed) {
      const Fallback = this.props.fallback
      return <Fallback error={this.state.error} reset={this.props.reset} />
    }
    return this.props.children
  }
}

/**
 * Renders the next route in the active branch. Layout components render an
 * `Outlet` to continue the branch.
 *
 * @since 0.4.0
 * @category components
 */
export function Outlet(): React.ReactNode {
  const depth = React.useContext(DepthContext)
  const { atomRouter, views } = useRouterContext()
  const result = useAtomValue(atomRouter.state)
  const reset = useRetry()
  if (!AsyncResult.isSuccess(result)) return null
  const { entries, failureOwner, failureError } = displayOf(result.value)
  if (failureOwner === "<notfound>") return <DefaultNotFound />
  if (failureOwner !== undefined && !entries.some((candidate) => candidate.id === failureOwner)) {
    // A router-level failure (redirect loop, encoding, history) has no owning
    // entry: the root outlet renders it once, descendants defer.
    return depth === 0 ? <DefaultError error={failureError} reset={reset} /> : null
  }
  const entry = entries[depth]
  if (entry === undefined) return null
  const options: ViewOptions = views.get(entry.id) ?? {}
  if (failureOwner === entry.id && !AsyncResult.isSuccess(entry.data)) {
    // Only the outlet that declares the failing node replaces itself and its
    // descendants; ancestors keep rendering their prepared contexts.
    const ErrorView = options.error ?? DefaultError
    const error = AsyncResult.isFailure(entry.data) ? Cause.squash(entry.data.cause) : failureError
    return <ErrorView error={error} reset={reset} />
  }
  if (!AsyncResult.isSuccess(entry.data) && Option.isNone(entry.retained)) {
    const Pending = options.pending ?? DefaultPending
    return <Pending />
  }
  const View = options.component
  const content = (
    <DepthContext.Provider value={depth + 1}>{View === undefined ? null : <View />}</DepthContext.Provider>
  )
  return (
    <RenderBoundary recoveryKey={entry.id} fallback={options.error ?? DefaultError} reset={reset}>
      {content}
    </RenderBoundary>
  )
}
