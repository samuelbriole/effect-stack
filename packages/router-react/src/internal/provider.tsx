import type { RouteTree } from "@effect-stack/router"
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-react"
import { Cause } from "effect"
import { Atom, type AtomRegistry } from "effect/unstable/reactivity"
import * as React from "react"
import { DepthContext, RouterContext, SnapshotContext, useRuntime } from "./context.ts"
import { useRetry } from "./navigation.tsx"
import { DefaultError, DefaultPending, Outlet } from "./rendering.tsx"
import type { Views } from "./route.ts"
import type { ClientRouter, RuntimeRouter } from "./router.ts"

/** Owns an Atom registry by default; supplied registries remain caller-owned. @since 0.1.0 */
export function RouterProvider<T extends RouteTree.Any, E>({
  router,
  registry
}: {
  readonly router: ClientRouter<T, E>
  readonly registry?: AtomRegistry.AtomRegistry
}) {
  const content = (
    <RouterContext.Provider value={router as RuntimeRouter}>
      <RouterView />
    </RouterContext.Provider>
  )
  return registry === undefined ? (
    <RegistryProvider>{content}</RegistryProvider>
  ) : (
    <RegistryContext.Provider value={registry}>{content}</RegistryContext.Provider>
  )
}

type Startup = { readonly _tag: "Active" | "Pending" } | { readonly _tag: "Failure"; readonly error: unknown }
function RouterView() {
  const { core } = useRuntime()
  const registry = React.useContext(RegistryContext)
  React.useEffect(() => registry.mount(core.navigation), [registry, core])
  const retry = useRetry()
  const startup = React.useMemo(
    () =>
      Atom.map(core.branch, (branch): Startup =>
        branch.matches.length > 0
          ? { _tag: "Active" }
          : branch.result._tag === "Failure"
            ? { _tag: "Failure", error: Cause.squash(branch.result.cause) }
            : { _tag: "Pending" }
      ).pipe(
        Atom.withEquality<Startup>(
          (left, right) =>
            left._tag === right._tag
            && (left._tag !== "Failure" || (right._tag === "Failure" && Object.is(left.error, right.error)))
        )
      ),
    [core]
  )
  const state = useAtomValue(startup)
  if (state._tag !== "Active") {
    const root = core.routes[0] as RouteTree.Any & Views
    if (state._tag === "Failure") {
      const ErrorView = root.errorComponent ?? DefaultError
      return (
        <SnapshotContext.Provider value="incoming">
          <ErrorView error={state.error} reset={retry} />
        </SnapshotContext.Provider>
      )
    }
    const Pending = root.pendingComponent ?? DefaultPending
    return <Pending />
  }
  return (
    <DepthContext.Provider value={0}>
      <Outlet />
    </DepthContext.Provider>
  )
}
