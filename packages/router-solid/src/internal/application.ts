import { AtomRouter } from "@effect-stack/router"
import type { AtomRuntimeRequirement } from "@effect-stack/router/AtomRouter"
import { finishApplication, getApplicationViews } from "@effect-stack/router/Adapter"
import type * as Router from "@effect-stack/router/Router"
import { useAtomMount, useAtomValue } from "@effect/atom-solid"
import type { Key } from "effect/Context"
import * as Option from "effect/Option"
import { createComponent, createMemo, type Component, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { DepthContext, RouterContext, useRouterContextAccessor, type RouterContextValue } from "./context.ts"
import { DefaultError, DefaultPending, Outlet } from "./rendering.ts"
import { engine, type ViewComponent } from "./route.ts"

/** The structural application witness accepted by a provider. @since 0.4.0 */
export interface ApplicationWitness {
  readonly appId: string
  readonly routes: unknown
  readonly token: object
  readonly service: Key<string, unknown>
}

/** @since 0.4.0 */
export interface ProviderProps<App extends ApplicationWitness, R, ER> {
  readonly app: App
  readonly runtime: AtomRuntimeRequirement<NoInfer<App>, R, ER>
  readonly pending?: ViewComponent
}

const RouterView = (): JSX.Element => {
  const context = useRouterContextAccessor()
  const result = useAtomValue(() => context().atomRouter.state)
  const view = createMemo<Component>(() => {
    const value = result()
    if (value._tag === "Initial") return context().pending
    if (value._tag === "Failure") {
      return () => DefaultError({ failure: { _tag: "Cause", cause: value.cause } })
    }
    if (Option.isNone(value.value.presentation)) return context().pending
    return Outlet
  })
  return createComponent(Dynamic, {
    get component() {
      return view()
    }
  })
}

/** Supplies the canonical application and its caller-owned runtime. @since 0.4.0 */
export function Provider<App extends ApplicationWitness, R, ER>(props: ProviderProps<App, R, ER>): JSX.Element {
  const atomRouter = createMemo(() => AtomRouter.make(props.runtime, props.app))
  const views = createMemo(() => getApplicationViews(engine, props.app))
  const context: () => RouterContextValue = () => ({
    atomRouter: atomRouter() as unknown as RouterContextValue["atomRouter"],
    views: views(),
    pending: props.pending ?? DefaultPending
  })
  useAtomMount(() => atomRouter().state)
  useAtomMount(() => atomRouter().service)
  return createComponent(RouterContext.Provider, {
    value: context,
    get children() {
      return createComponent(DepthContext.Provider, {
        value: () => 0,
        get children() {
          return createComponent(RouterView, {})
        }
      })
    }
  })
}

/** Selects native definitions and their ancestors. @since 0.4.0 */
export function make<
  const AppId extends string,
  const Defs extends readonly [Router.AnyDefinitionShape, ...Array<Router.AnyDefinitionShape>]
>(appId: AppId, definitions: Defs): Router.ApplicationOf<AppId, Defs> {
  return finishApplication(engine, appId, definitions)
}
