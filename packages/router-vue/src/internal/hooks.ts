import type { Route, Router, RouteTree } from "@effect-stack/router"
import { useAtomValue } from "@effect/atom-vue"
import { Equal, Option, Result } from "effect"
import { Atom } from "effect/unstable/reactivity"
import { computed, type ComputedRef, inject, type Ref } from "vue"
import { snapshotKey, useRuntime } from "./context.ts"
import type { RegisteredRouter } from "./router.ts"

/** @since 0.2.0 */
export interface SelectorOptions<A> {
  readonly equals?: (left: A, right: A) => boolean
}
/** @since 0.2.0 */
export interface VueRouteHook<A> {
  <B>(select: (value: A) => B, options?: SelectorOptions<B>): ComputedRef<B>
  (): ComputedRef<A>
}

type RouteValues<R extends Route.Any> = {
  readonly match: Router.ResolvedRoute<R>
  readonly params: Route.Route.Params<R>
  readonly search: Route.Route.Search<R>
  readonly loaderData: Route.Route.LoaderData<R>
}

/** @since 0.1.0 */
export function useRouterState<A>(
  select: (value: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): ComputedRef<A>
export function useRouterState(): Readonly<Ref<Atom.Type<RegisteredRouter["core"]["state"]>>>
export function useRouterState<A>(
  select?: (value: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): Readonly<Ref<Atom.Type<RegisteredRouter["core"]["state"]>>> | ComputedRef<A> {
  const { core } = useRuntime()
  if (select === undefined) {
    return useAtomValue(() => core.state) as Readonly<Ref<Atom.Type<RegisteredRouter["core"]["state"]>>>
  }
  const selected = Atom.map(core.state, select).pipe(Atom.withEquality(options?.equals ?? Object.is))
  return useAtomValue(() => selected) as ComputedRef<A>
}

function useRouteValue<R extends Route.Any, K extends keyof RouteValues<R>, A = RouteValues<R>[K]>(
  route: R,
  key: K,
  select?: (value: RouteValues<R>[K]) => A,
  options?: SelectorOptions<A>
): ComputedRef<A> {
  const { core } = useRuntime()
  const mode = inject(snapshotKey, "resolved")
  // Decorated route nodes carry the compiled tree's identity fields; the erased
  // runtime router types routes structurally.
  const atoms = core.routeAtoms(route as unknown as RouteTree.Any)
  const equals =
    options?.equals ?? (select === undefined && (key === "params" || key === "search") ? Equal.equals : Object.is)
  const selected = Atom.make((get: Atom.AtomContext) => {
    const resolved = get(atoms.resolved)
    const incoming = mode === "incoming" && (key === "params" || key === "search") ? get(atoms.incoming) : Option.none()
    // A failed incoming decode means no decoded input exists; falling back to retained
    // data would pair fresh views with stale params. Ordinary views keep resolved snapshots.
    const snapshot = Option.isSome(incoming)
      ? Result.isSuccess(incoming.value)
        ? incoming.value.success
        : undefined
      : Option.isSome(resolved)
        ? resolved.value
        : undefined
    if (snapshot === undefined) return Option.none<A>()
    const value = (key === "match" ? snapshot : (snapshot as unknown as RouteValues<R>)[key]) as RouteValues<R>[K]
    return Option.some(select === undefined ? (value as A) : select(value))
  }).pipe(
    Atom.withEquality((left: Option.Option<A>, right: Option.Option<A>) =>
      Option.isSome(left) ? Option.isSome(right) && equals(left.value, right.value) : Option.isNone(right)
    )
  )
  const value = useAtomValue(() => selected)
  let retained: A | undefined
  let settled = false
  return computed(() => {
    const current = value.value
    if (Option.isSome(current)) {
      retained = current.value
      settled = true
    }
    // Exiting components can read their last snapshot until Vue finishes their unmount.
    if (settled) return retained as A
    throw new Error(
      `Route ${route.id} has no ${key === "params" || key === "search" ? "decoded" : "resolved"} match in this branch`
    )
  })
}

export const routeHook =
  <R extends Route.Any, K extends keyof RouteValues<R>>(route: R, key: K) =>
  (select?: (value: RouteValues<R>[K]) => unknown, options?: SelectorOptions<unknown>): ComputedRef<unknown> =>
    useRouteValue(route, key, select, options)
