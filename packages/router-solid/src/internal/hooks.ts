import type { Route, Router, RouteTree } from "@effect-stack/router"
import { useAtomValue } from "@effect/atom-solid"
import { Equal, Option, Result } from "effect"
import { Atom } from "effect/unstable/reactivity"
import { type Accessor, useContext } from "solid-js"
import { SnapshotContext, useRuntime } from "./context.ts"
import type { RegisteredRouter } from "./router.ts"

/** @since 0.2.0 */
export interface SelectorOptions<A> {
  readonly equals?: (left: A, right: A) => boolean
}
/** A reactive subscription with an optional projection. @since 0.2.0 */
export interface RouteHook<A> {
  <B>(select: (value: A) => B, options?: SelectorOptions<B>): Accessor<B>
  (): Accessor<A>
}

/** The selected navigation status, or a projection of it. @since 0.1.0 */
export function useRouterState<A>(
  select: (state: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): Accessor<A>
export function useRouterState(): Accessor<Atom.Type<RegisteredRouter["core"]["state"]>>
export function useRouterState<A = Atom.Type<RegisteredRouter["core"]["state"]>>(
  select?: (state: Atom.Type<RegisteredRouter["core"]["state"]>) => A,
  options?: SelectorOptions<A>
): Accessor<A> {
  const { core } = useRuntime()
  const equals = options?.equals ?? Object.is
  const atom = Atom.map(
    core.state,
    (value) => select === undefined ? value as A : select(value as Atom.Type<RegisteredRouter["core"]["state"]>)
  ).pipe(Atom.withEquality<A>(equals))
  return useAtomValue(() => atom) as Accessor<A>
}
type RouteValues<R extends RouteTree.Any> = {
  readonly match: Router.ResolvedRoute<R>
  readonly params: Route.Route.Params<R>
  readonly search: Route.Route.Search<R>
  readonly loaderData: Route.Route.LoaderData<R>
}
export function useRouteValue<R extends RouteTree.Any, K extends keyof RouteValues<R>, A = RouteValues<R>[K]>(
  route: R,
  key: K,
  select?: (value: RouteValues<R>[K]) => A,
  options?: SelectorOptions<A>
): Accessor<A> {
  const { core } = useRuntime()
  const mode = useContext(SnapshotContext)
  const atoms = core.routeAtoms(route)
  const equals = options?.equals ??
    (select === undefined && (key === "params" || key === "search") ? Equal.equals : Object.is)
  const selected = Atom.make((get) => {
    const resolved = get(atoms.resolved)
    const incoming = mode === "incoming" && (key === "params" || key === "search")
      ? get(atoms.incoming)
      : Option.none()
    // A failed incoming decode has no decoded input; it must not silently
    // present retained data. Only ordinary resolved-mode owners keep the
    // last snapshot (through the hold-last accessor below).
    const snapshot = Option.isSome(incoming)
      ? Result.isSuccess(incoming.value)
        ? incoming.value.success
        : undefined
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
  ))
  const value = useAtomValue(() => selected)
  let latest: A | undefined
  let settled = false
  return () => {
    const current = value()
    if (Option.isSome(current)) {
      latest = current.value
      settled = true
      return current.value
    }
    // Retain the last selected input while an exiting owner is being disposed, or
    // while this route refreshes. A newly mounted inactive route still fails on read.
    if (settled) return latest as A
    throw new Error(
      `Route ${route.id} has no ${key === "params" || key === "search" ? "decoded" : "resolved"} match in this branch`
    )
  }
}
