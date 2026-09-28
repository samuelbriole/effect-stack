import { AtomRouter } from "@effect-stack/router"
import type { AtomRuntimeRequirement } from "@effect-stack/router/AtomRouter"
import { finishApplication, getApplicationViews } from "@effect-stack/router/Adapter"
import type * as Router from "@effect-stack/router/Router"
import { useAtomMount, useAtomValue } from "@effect/atom-react"
import type { Key } from "effect/Context"
import * as Option from "effect/Option"
import * as React from "react"
import { DepthContext, RouterContext, useRouterContext, type RouterContextValue } from "./context.ts"
import { DefaultError, DefaultPending, Outlet } from "./rendering.tsx"
import { engine, type ViewComponent } from "./route.ts"

interface ApplicationShape {
  readonly appId: string
  readonly routes: unknown
  readonly token: object
  readonly service: Key<string, unknown>
}

/** @since 0.4.0 */
export interface ProviderProps<App extends ApplicationShape, R, ER> {
  readonly app: App
  readonly runtime: AtomRuntimeRequirement<NoInfer<App>, R, ER>
  readonly pending?: ViewComponent
}

const RouterView = (): React.ReactNode => {
  const { atomRouter, pending: Pending } = useRouterContext()
  const result = useAtomValue(atomRouter.state)
  if (result._tag === "Initial") return <Pending />
  if (result._tag === "Failure") {
    return <DefaultError failure={{ _tag: "Cause", cause: result.cause }} />
  }
  if (Option.isNone(result.value.presentation)) return <Pending />
  return <Outlet />
}

/** Mounts a canonical application with its composed runtime. @since 0.4.0 */
export function Provider<App extends ApplicationShape, R, ER>(props: ProviderProps<App, R, ER>): React.ReactNode {
  const { app, runtime } = props
  const views = React.useMemo(() => getApplicationViews(engine, app), [app])
  const atomRouter = React.useMemo(() => AtomRouter.make(runtime, app), [app, runtime])
  useAtomMount(atomRouter.state)
  useAtomMount(atomRouter.service)
  const pending = props.pending ?? DefaultPending
  const context = React.useMemo(
    () => ({ atomRouter: atomRouter as unknown as RouterContextValue["atomRouter"], views, pending }),
    [atomRouter, views, pending]
  )
  return (
    <RouterContext.Provider value={context}>
      <DepthContext.Provider value={0}>
        <RouterView />
      </DepthContext.Provider>
    </RouterContext.Provider>
  )
}

/** Creates an application without acquiring runtime resources. @since 0.4.0 */
export function make<
  const AppId extends string,
  const Defs extends readonly [Router.AnyDefinitionShape, ...Array<Router.AnyDefinitionShape>]
>(appId: AppId, definitions: Defs): Router.ApplicationOf<AppId, Defs> {
  return finishApplication(engine, appId, definitions)
}
