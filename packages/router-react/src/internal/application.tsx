import { AtomRouter } from "@effect-stack/router"
import type { RouterRuntimeRequirement } from "@effect-stack/router/AtomRouter"
import { finishApplication, getApplicationViews } from "@effect-stack/router/Adapter"
import * as Router from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-react"
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as React from "react"
import { DepthContext, RouterContext, type RouterContextValue } from "./context.ts"
import { DefaultError, DefaultPending, Outlet } from "./rendering.tsx"
import { engine, type ViewComponent } from "./route.ts"

/** @since 0.4.0 */
export type RouterProviderProps<R, ER> = {
  readonly runtime: RouterRuntimeRequirement<R, ER>
  readonly pending?: ViewComponent | undefined
}

/** Mounts a canonical application with its composed runtime. @since 0.4.0 */
export function RouterProvider<R, ER>(props: RouterProviderProps<R, ER>): React.ReactNode {
  const { runtime } = props
  // The public runtime marker proves that this standard service is present.
  const atom = React.useMemo(
    () =>
      runtime.atom(
        Router.RuntimeApplication as unknown as Effect.Effect<Router.RuntimeApplication["Service"], never, R>
      ),
    [runtime]
  )
  const result = useAtomValue(atom)
  const Pending = props.pending ?? DefaultPending
  if (result._tag === "Initial") return <Pending />
  if (result._tag === "Failure") return <DefaultError failure={{ _tag: "Cause", cause: result.cause }} />
  return <MountedRouter app={result.value.app} runtime={runtime} pending={props.pending} />
}

function MountedRouter<R, ER>(
  props: RouterProviderProps<R, ER> & { readonly app: Router.ApplicationWitness }
): React.ReactNode {
  const { app, runtime } = props
  const views = React.useMemo(() => getApplicationViews(engine, app), [app])
  const atomRouter = React.useMemo(() => AtomRouter.make(runtime, app), [app, runtime])
  const result = useAtomValue(atomRouter.state)
  const Pending = props.pending ?? DefaultPending
  const context = React.useMemo(
    () => ({ atomRouter: atomRouter as unknown as RouterContextValue["atomRouter"], views, pending: Pending }),
    [atomRouter, views, Pending]
  )
  return (
    <RouterContext.Provider value={context}>
      <DepthContext.Provider value={0}>
        {result._tag === "Failure" ? (
          <DefaultError failure={{ _tag: "Cause", cause: result.cause }} />
        ) : result._tag === "Initial" || Option.isNone(result.value.presentation) ? (
          <Pending />
        ) : (
          <Outlet />
        )}
      </DepthContext.Provider>
    </RouterContext.Provider>
  )
}

/** Lazily assembles a fresh application per execution; invalid definitions are defects. @since 0.4.0 */
export function make<
  const AppId extends string,
  const Defs extends readonly [Router.AnyDefinitionShape, ...Array<Router.AnyDefinitionShape>]
>(appId: AppId, definitions: Defs): Effect.Effect<Router.ApplicationOf<AppId, Defs>> {
  return finishApplication(engine, appId, definitions)
}
