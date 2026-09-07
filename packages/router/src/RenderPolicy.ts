/** Renderer-neutral route presentation and declarative navigation policy. @since 0.2.0 */
import * as Cause from "effect/Cause"
import * as Equal from "effect/Equal"
import * as Option from "effect/Option"
import type * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as History from "./History.ts"
import type * as Route from "./Route.ts"
import type * as Router from "./Router.ts"

/** @since 0.2.0 */
export type BoundaryKind = "errorComponent" | "pendingComponent" | "notFoundComponent"
/** @since 0.2.0 */
export type Selection =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "View"; readonly routeId: string }
  | { readonly _tag: "Boundary"; readonly routeId: string; readonly kind: BoundaryKind; readonly error: unknown }

/** Equality for selected presentation subscriptions. @since 0.2.0 */
export const sameSelection = (left: Selection, right: Selection): boolean => {
  if (left._tag === "Empty") return right._tag === "Empty"
  if (left._tag === "View") return right._tag === "View" && left.routeId === right.routeId
  return right._tag === "Boundary" && left.routeId === right.routeId && left.kind === right.kind &&
    Object.is(left.error, right.error)
}

/** Minimal projection needed to select a presentation. @since 0.2.0 */
export interface PresentationState {
  readonly matches: ReadonlyArray<
    { readonly route: Route.Any; readonly result: AsyncResult.AsyncResult<unknown, unknown> }
  >
  readonly notFound: boolean
  readonly result?: AsyncResult.AsyncResult<void, unknown>
}

/** Failure, pending, and not-found precedence, with nearest declaring ancestor. @since 0.2.0 */
export const select = (
  branch: PresentationState,
  depth: number,
  declares: (route: Route.Any, kind: BoundaryKind) => boolean
): Selection => {
  const entries = branch.matches
  let problem = entries.findIndex((entry) => entry.result._tag === "Failure")
  const globalFailure = problem < 0 && !branch.notFound && branch.result?._tag === "Failure" && !branch.result.waiting
    ? branch.result :
    undefined
  if (globalFailure !== undefined && entries.length > 0) problem = 0
  let kind: BoundaryKind = "errorComponent"
  if (problem < 0) {
    problem = entries.findIndex((entry) => entry.result._tag === "Initial")
    kind = "pendingComponent"
  }
  if (problem < 0 && branch.notFound) {
    problem = entries.length - 1
    kind = "notFoundComponent"
  }
  if (problem >= 0) {
    let boundary = problem
    while (boundary > 0 && !declares(entries[boundary].route, kind)) boundary--
    if (depth > boundary) return { _tag: "Empty" }
    if (boundary === depth) {
      const failure = globalFailure ?? entries[problem].result
      return {
        _tag: "Boundary",
        routeId: entries[boundary].route.id,
        kind,
        error: failure._tag === "Failure" ? Cause.squash(failure.cause) : undefined
      }
    }
  }
  const entry = entries[depth]
  return entry?.result._tag === "Success" ? { _tag: "View", routeId: entry.route.id } : { _tag: "Empty" }
}

/** @since 0.2.0 */
export interface NavigationIntent {
  readonly href: string
  readonly replace: boolean
  readonly state: unknown
}

/** State follows Effect structural equality; supply immutable state values. @since 0.2.0 */
export const sameIntent = (left: NavigationIntent | undefined, right: NavigationIntent): boolean =>
  left !== undefined && left.href === right.href && left.replace === right.replace &&
  Equal.equals(left.state, right.state)

/** Includes explicit history state, avoiding duplicate pushes on pending remounts. @since 0.2.0 */
export const isSatisfied = (intent: NavigationIntent, location: Option.Option<History.Location>): boolean =>
  Option.isSome(location) &&
  `${location.value.pathname}${location.value.search}${location.value.hash}` === intent.href &&
  (intent.state === undefined || Equal.equals(location.value.state, intent.state))

/** Stable until a completed successful branch includes the boundary route. @since 0.2.0 */
export const recoveryKey = (branch: Router.Branch, routeId: string): object | undefined => {
  const completed = branch.lastSuccess
  return Option.isSome(completed) && completed.value.matches.some((match) => match.id === routeId)
    ? completed.value.transitionId
    : undefined
}
