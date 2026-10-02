import { AtomRouter } from "@effect-stack/router"
import type { RouterRuntimeRequirement } from "@effect-stack/router/AtomRouter"
import { finishApplication, getApplicationViews } from "@effect-stack/router/Adapter"
import * as Router from "@effect-stack/router/Router"
import { useAtomValue } from "@effect/atom-solid"
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { createComponent, createMemo, type Component, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { DepthContext, RouterContext, type RouterContextValue } from "./context.ts"
import { DefaultError, DefaultPending, Outlet } from "./rendering.ts"
import { engine, type ViewComponent } from "./route.ts"

/** @since 0.4.0 */
export interface RouterProviderProps<R, ER> {
  readonly runtime: RouterRuntimeRequirement<R, ER>
  readonly pending?: ViewComponent
}

const MountedRouter = <R, ER>(
  props: RouterProviderProps<R, ER> & { readonly app: Router.ApplicationWitness }
): JSX.Element => {
  const atomRouter = createMemo(() => AtomRouter.make(props.runtime, props.app))
  const views = createMemo(() => getApplicationViews(engine, props.app))
  const result = useAtomValue(() => atomRouter().state)
  const view = createMemo<Component>(() => {
    const value = result()
    if (value._tag === "Failure") return () => DefaultError({ failure: { _tag: "Cause", cause: value.cause } })
    if (value._tag === "Initial" || Option.isNone(value.value.presentation)) return props.pending ?? DefaultPending
    return Outlet
  })
  const context: () => RouterContextValue = () => ({
    atomRouter: atomRouter() as unknown as RouterContextValue["atomRouter"],
    views: views(),
    pending: props.pending ?? DefaultPending
  })
  return createComponent(RouterContext.Provider, {
    value: context,
    get children() {
      return createComponent(DepthContext.Provider, {
        value: () => 0,
        get children() {
          return createComponent(Dynamic, {
            get component() {
              return view()
            }
          })
        }
      })
    }
  })
}

/** Mounts the application acquired by the caller-owned runtime. @since 0.4.0 */
export function RouterProvider<R, ER>(props: RouterProviderProps<R, ER>): JSX.Element {
  const startup = createMemo(() => {
    // The public requirement proves this fixed standard service is in R.
    const selected = Router.RuntimeApplication as unknown as Effect.Effect<
      Router.RuntimeApplication["Service"],
      never,
      R
    >
    return props.runtime.atom(selected)
  })
  const result = useAtomValue(startup)
  const view = createMemo<Component>(() => {
    const value = result()
    if (value._tag === "Initial") return props.pending ?? DefaultPending
    if (value._tag === "Failure") {
      return () => DefaultError({ failure: { _tag: "Cause", cause: value.cause } })
    }
    const runtime = props.runtime
    return () =>
      createComponent(MountedRouter, {
        runtime,
        app: value.value.app,
        get pending() {
          return props.pending ?? DefaultPending
        }
      })
  })
  return createComponent(Dynamic, {
    get component() {
      return view()
    }
  })
}

/** Lazily assembles a fresh application per execution; invalid definitions are defects. @since 0.4.0 */
export function make<
  const AppId extends string,
  const Defs extends readonly [Router.AnyDefinitionShape, ...Array<Router.AnyDefinitionShape>]
>(appId: AppId, definitions: Defs): Effect.Effect<Router.ApplicationOf<AppId, Defs>> {
  return finishApplication(engine, appId, definitions)
}
