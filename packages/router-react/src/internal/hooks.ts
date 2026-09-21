import type { Route, Router, RouteTree } from "@effect-stack/router"
import { useAtomValue } from "@effect/atom-react"
import { Equal, Option, Result } from "effect"
import { Atom } from "effect/unstable/reactivity"
import * as React from "react"
import { SnapshotContext, useRuntime } from "./context.ts"
import type { RegisteredRouter } from "./router.ts"

/** @since 0.2.0 */
export interface SelectorOptions<A> {
  readonly equals?: (left: A, right: A) => boolean
}
/** @since 0.2.0 */
export interface RouteHook<A> {
  <B>(select: (value: A) => B, options?: SelectorOptions<B>): B
  (): A
}

/** @since 0.1.0 */
export function useRouterState<A>(
  select: (state: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): A
export function useRouterState(): Atom.Type<RegisteredRouter["core"]["state"]>
export function useRouterState<A = Atom.Type<RegisteredRouter["core"]["state"]>>(
  select?: (state: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): A {
  const { core } = useRuntime()
  const equals = options?.equals ?? Object.is
  const atom = React.useMemo(() =>
    Atom.map(core.state, (value) =>
      select === undefined
        ? value as A :
        select(value as Atom.Type<RegisteredRouter["core"]["state"]>)).pipe(Atom.withEquality<A>(equals)), [
    core,
    select,
    equals
  ])
  return useAtomValue(atom)
}

type RouteValues<R extends Route.Any> = {
  readonly match: Router.ResolvedRoute<R>
  readonly params: Route.Route.Params<R>
  readonly search: Route.Route.Search<R>
  readonly loaderData: Route.Route.LoaderData<R>
}

export function useRouteValue<R extends Route.Any, K extends keyof RouteValues<R>, A = RouteValues<R>[K]>(
  route: R & RouteTree.Any,
  key: K,
  select?: (value: RouteValues<R>[K]) => A,
  options?: SelectorOptions<A>
): A {
  const { core } = useRuntime()
  const mode = React.useContext(SnapshotContext)
  const atoms = core.routeAtoms(route)
  const equals = options?.equals ??
    (select === undefined && (key === "params" || key === "search") ? Equal.equals : Object.is)
  const selected = React.useMemo(() =>
    Atom.make((get) => {
      const resolved = get(atoms.resolved)
      const useIncoming = mode === "incoming" && (key === "params" || key === "search")
      const incoming = useIncoming
        ? get(atoms.incoming)
        : Option.none()
      const snapshot = useIncoming
        ? Option.isSome(incoming) && Result.isSuccess(incoming.value) ? incoming.value.success : undefined
        : Option.isSome(resolved)
        ? resolved.value
        : undefined
      if (snapshot === undefined) return Option.none<A>()
      const value = (key === "match" ? snapshot : snapshot[key as keyof typeof snapshot]) as RouteValues<R>[K]
      return Option.some(select === undefined ? value as A : select(value))
    }).pipe(Atom.withEquality<Option.Option<A>>((left, right) =>
      Option.isSome(left)
        ? Option.isSome(right) && equals(left.value, right.value)
        : Option.isNone(right)
    )), [atoms, mode, key, select, equals])
  const value = useAtomValue(selected)
  if (Option.isNone(value)) {
    throw new Error(
      `Route ${route.id} has no ${key === "params" || key === "search" ? "decoded" : "resolved"} match in this branch`
    )
  }
  return value.value
}
