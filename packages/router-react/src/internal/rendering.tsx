import type { OutletDecision } from "@effect-stack/router/Presentation"
import { outletDecision } from "@effect-stack/router/Presentation"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as React from "react"
import { DepthContext, useRouterContext } from "./context.ts"
import { useRetry } from "./navigation.tsx"
import type { ViewFailureProps, ResolvedViewOptions, ViewComponent } from "./route.ts"

/** @since 0.4.0 */
export const DefaultPending = (): React.ReactNode => <div role="status">Loading…</div>
/** @since 0.4.0 */
export const DefaultNotFound = (): React.ReactNode => <div role="status">Page not found</div>
/** @since 0.4.0 */
export const DefaultError = ({
  retry
}: Omit<ViewFailureProps, "retry"> & { readonly retry?: () => void }): React.ReactNode => (
  <div role="alert">
    Unable to display this route. {retry === undefined ? null : <button onClick={retry}>Retry</button>}
  </div>
)

const fallbackView: ResolvedViewOptions = {}
const renderDecision = (
  decision: OutletDecision<ResolvedViewOptions>,
  depth: number,
  retry: () => void,
  Pending: ViewComponent
): React.ReactNode => {
  switch (decision._tag) {
    case "Empty":
      return null
    case "NotFound":
      return <DefaultNotFound />
    case "RouterFailure":
      return depth === 0 ? <DefaultError failure={decision.failure} retry={retry} /> : null
    case "Pending":
      return <Pending />
    case "Failure": {
      const ErrorView = decision.view.error ?? DefaultError
      return <ErrorView failure={decision.failure} retry={retry} />
    }
    case "View": {
      const View = decision.view.component
      return (
        <DepthContext.Provider value={decision.nextDepth}>{View === undefined ? null : <View />}</DepthContext.Provider>
      )
    }
  }
}

/** Renders the next definition in the displayed branch. @since 0.4.0 */
export function Outlet(): React.ReactNode {
  const depth = React.useContext(DepthContext)
  const { atomRouter, views, pending } = useRouterContext()
  const result = useAtomValue(atomRouter.state)
  const retry = useRetry()
  if (!AsyncResult.isSuccess(result)) return null
  return renderDecision(outletDecision(result.value, depth, views, fallbackView), depth, retry, pending)
}
