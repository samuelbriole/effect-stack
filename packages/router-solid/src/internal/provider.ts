import type { RouteTree } from "@effect-stack/router"
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-solid"
import { Cause } from "effect"
import { Atom, type AtomRegistry } from "effect/unstable/reactivity"
import { createComponent, type JSX, onCleanup, useContext } from "solid-js"
import { Dynamic } from "solid-js/web"
import { DepthContext, RouterContext, SnapshotContext, useRuntime } from "./context.ts"
import { useRetry } from "./navigation.ts"
import { DefaultError, DefaultPending, Keyed, Outlet } from "./rendering.ts"
import type { Views } from "./route.ts"
import type { ClientRouter, RuntimeRouter } from "./router.ts"

/** Owns a registry by default; caller-supplied registries remain caller-owned. @since 0.1.0 */
export function RouterProvider<T extends RouteTree.Any, E>(props: {
  readonly router: ClientRouter<T, E>
  readonly registry?: AtomRegistry.AtomRegistry
}): JSX.Element {
  const content = () =>
    createComponent(Keyed<ClientRouter<T, E>>, {
      get when() {
        return props.router
      },
      children: (router: ClientRouter<T, E>) =>
        createComponent(RouterContext.Provider, {
          value: router as RuntimeRouter,
          get children() {
            return createComponent(RouterView, {})
          }
        })
    })
  return createComponent(Keyed<AtomRegistry.AtomRegistry>, {
    get when() {
      return props.registry
    },
    get fallback() {
      return createComponent(RegistryProvider, {
        get children() {
          return content()
        }
      })
    },
    children: (registry: AtomRegistry.AtomRegistry) =>
      createComponent(RegistryContext.Provider, {
        value: registry,
        get children() {
          return content()
        }
      })
  })
}

type Startup = { readonly _tag: "Active" | "Pending" } | { readonly _tag: "Failure"; readonly error: unknown }
function RouterView(): JSX.Element {
  const { core } = useRuntime()
  const registry = useContext(RegistryContext)
  onCleanup(registry.mount(core.navigation))
  const retry = useRetry()
  const startup = Atom.map(core.branch, (branch): Startup =>
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
  )
  const status = useAtomValue(() => startup)
  return createComponent(Keyed<string>, {
    get when() {
      return status()._tag
    },
    children: (tag: string) => {
      if (tag === "Active") {
        return createComponent(DepthContext.Provider, {
          value: 0,
          get children() {
            return createComponent(Outlet, {})
          }
        })
      }
      const root = core.routes[0] as RouteTree.Any & Views
      if (tag === "Failure") {
        const ErrorView = root.errorComponent ?? DefaultError
        return createComponent(SnapshotContext.Provider, {
          value: "incoming" as const,
          get children() {
            return createComponent(Dynamic, {
              component: ErrorView,
              get error() {
                const current = status()
                return current._tag === "Failure" ? current.error : undefined
              },
              reset: retry
            })
          }
        })
      }
      const Pending = root.pendingComponent ?? DefaultPending
      return createComponent(Pending, {})
    }
  })
}
