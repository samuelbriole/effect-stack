/**
 * Renderer-neutral presentation selection shared by every adapter. Internal
 * module.
 *
 * These functions select the displayed branch, keep decoded inputs and
 * input tied to that branch, classify failure ownership, and decide an
 * outlet's disposition. They never create VNodes, call components, or touch
 * framework hooks; adapters interpret the tagged decisions.
 *
 * @since 0.4.0
 */
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type { AnyNode } from "./definition.ts"
import type { EntryState, NavigationStatus, Presentation, ResolvedBranch } from "./coordinator.ts"
import { NotFoundFailureOwner } from "./coordinator.ts"
import type { Location } from "../History.ts"

/**
 * A discriminated failure presented to native error views. Only a pure
 * expected gate failure attributed to its own preparation is `Domain`;
 * decode, encode, history, defect, finalizer, and mixed failures stay `Cause`.
 *
 * @since 0.4.0
 * @category models
 */
export type ViewFailure<E = unknown> =
  | { readonly _tag: "Domain"; readonly error: E }
  | { readonly _tag: "Cause"; readonly cause: Cause.Cause<unknown> }

/** The owner recorded for an unmatched URL. @since 0.4.0 */
export { NotFoundFailureOwner }

/** The renderer-neutral state consumed by presentation selection. @since 0.4.0 */
export interface PresentationState {
  readonly location: Option.Option<Location>
  readonly status: NavigationStatus
  readonly presentation: Option.Option<Presentation>
  readonly resolved: Option.Option<ResolvedBranch>
}

/** A coherent, displayable entry. @since 0.4.0 */
export interface DisplayEntry {
  readonly node: AnyNode
  readonly id: string
  /** Decoded inputs, absent when decoding failed. @since 0.4.0 */
  readonly input: Option.Option<unknown>
  readonly failure: Option.Option<ViewFailure>
}

/** @since 0.4.0 */
export interface ViewShape {
  readonly component?: unknown
  readonly render?: unknown
  readonly error?: unknown
  readonly empty?: boolean
}

/** @since 0.4.0 */
export interface ViewLookup<V extends ViewShape = ViewShape> {
  readonly get: (id: string) => V | undefined
}

/**
 * The outlet disposition for one depth. A transparent group is skipped so its
 * descendant's decision is returned instead; an explicit `empty` view is
 * terminal and renders nothing. `nextDepth` is the index after the rendered
 * entry, so adapters advance to it rather than `depth + 1`.
 *
 * @since 0.4.0
 */
export type OutletDecision<V extends ViewShape = ViewShape> =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "RouterFailure"; readonly failure: ViewFailure<never> }
  | { readonly _tag: "Pending" }
  | {
      readonly _tag: "View"
      readonly nextDepth: number
      readonly entry: DisplayEntry
      readonly view: V
    }
  | {
      readonly _tag: "Failure"
      readonly nextDepth: number
      readonly entry: DisplayEntry
      readonly view: V
      readonly failure: ViewFailure
    }

/** The entries a renderer should display for the current presentation. @since 0.4.0 */
export const displayEntries = (state: PresentationState): ReadonlyArray<EntryState> => {
  const presentation = Option.getOrUndefined(state.presentation)
  if (presentation === undefined) return []
  if (presentation._tag === "Pending") {
    const resolved = Option.getOrUndefined(state.resolved)
    return resolved === undefined ? [] : resolved.entries
  }
  return presentation.entries
}

/** @since 0.4.0 */
const firstFailError = (cause: Cause.Cause<unknown>): unknown => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) return reason.error
  }
  return undefined
}

/**
 * Classifies an entry's failure using the coordinator's provenance. Only a
 * failure the coordinator recorded as the gate's own pure expected failure
 * becomes `Domain`; decode, redirect, and engine-generated failures stay
 * `Cause` even though they are attributed to the same node.
 *
 * @since 0.4.0
 */
export const entryFailure = (entry: EntryState): Option.Option<ViewFailure> => {
  if (Option.isNone(entry.failure)) return Option.none()
  const cause = entry.failure.value
  if (!entry.domain) return Option.some<ViewFailure>({ _tag: "Cause", cause })
  return Option.some<ViewFailure>({ _tag: "Domain", error: firstFailError(cause) })
}

/** Projects one runtime entry into a coherent display entry. @since 0.4.0 */
export const toDisplayEntry = (entry: EntryState): DisplayEntry => {
  const input = Result.isSuccess(entry.input) ? Option.some(entry.input.success as unknown) : Option.none<unknown>()
  const failure = entryFailure(entry)
  return {
    node: entry.node as unknown as AnyNode,
    id: entry.id,
    input,
    failure
  }
}

/**
 * Decides what an outlet at `depth` renders. Transparent groups (no component
 * or render function) are traversed so their descendants render in place, and
 * an explicit `empty` view terminates the branch. Router-level failures without
 * an owning entry are only rendered at the root outlet.
 *
 * @since 0.4.0
 */
export const outletDecision = <V extends ViewShape>(
  state: PresentationState,
  depth: number,
  views: ViewLookup<V>,
  fallback: V
): OutletDecision<V> => {
  const presentation = Option.getOrUndefined(state.presentation)
  if (presentation === undefined) return { _tag: "Empty" }
  const resolved = Option.getOrUndefined(state.resolved)
  if (presentation._tag === "Pending" && resolved === undefined) {
    return depth === 0 ? { _tag: "Pending" } : { _tag: "Empty" }
  }
  const entries = displayEntries(state)
  const owner = presentation._tag === "Failed" ? presentation.owner : undefined
  const cause = presentation._tag === "Failed" ? presentation.cause : undefined
  if (owner === NotFoundFailureOwner) return { _tag: "NotFound" }
  if (owner !== undefined && !entries.some((candidate) => candidate.id === owner)) {
    return depth === 0
      ? { _tag: "RouterFailure", failure: { _tag: "Cause", cause: cause ?? Cause.empty } }
      : { _tag: "Empty" }
  }
  for (let index = depth; index < entries.length; index++) {
    const entry = entries[index]
    if (entry === undefined) return { _tag: "Empty" }
    const view = views.get(entry.id)
    const display = toDisplayEntry(entry)
    if (owner === entry.id && Option.isSome(display.failure)) {
      return {
        _tag: "Failure",
        nextDepth: index + 1,
        entry: display,
        view: view ?? fallback,
        failure: display.failure.value
      }
    }
    if (view !== undefined && view.empty === true) return { _tag: "Empty" }
    const hasRender = view !== undefined && (view.component !== undefined || view.render !== undefined)
    if (!hasRender) {
      // A transparent layout passes through to its descendant.
      continue
    }
    return { _tag: "View", nextDepth: index + 1, entry: display, view }
  }
  return { _tag: "Empty" }
}
