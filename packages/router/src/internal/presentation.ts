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

/** A node-independent display entry for renderer adapters. @since 0.4.0 */
export interface DisplayItem<Input, Failure> {
  readonly id: string
  readonly input: Input
  readonly failure: Failure | null
}

/** A renderer-neutral snapshot with failure required only for router failures. @since 0.4.0 */
export type DisplaySnapshot<Entry, Failure> =
  | { readonly _tag: "Empty" | "Pending" | "NotFound" | "Entries"; readonly entries: ReadonlyArray<Entry> }
  | { readonly _tag: "RouterFailure"; readonly entries: ReadonlyArray<Entry>; readonly failure: Failure }

/** The node-independent decision for an outlet at one depth. @since 0.4.0 */
export type SnapshotOutletDecision<Entry, Failure, V extends ViewShape> =
  | { readonly _tag: "Empty" | "NotFound" | "Pending" }
  | { readonly _tag: "RouterFailure"; readonly failure: Failure }
  | { readonly _tag: "View"; readonly nextDepth: number; readonly entry: Entry; readonly view: V }
  | {
      readonly _tag: "Failure"
      readonly nextDepth: number
      readonly entry: Entry
      readonly view: V
      readonly failure: Failure
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
 * Projects the displayed branch, retaining resolved inputs during pending work.
 * Only the current failure owner receives an entry failure; stale failures on
 * other entries are not presented. Selection does not require nodes downstream.
 *
 * @since 0.4.0
 */
export const projectPresentation = (
  state: PresentationState
): DisplaySnapshot<DisplayItem<Option.Option<unknown>, ViewFailure> & { readonly node: AnyNode }, ViewFailure> => {
  const presentation = Option.getOrUndefined(state.presentation)
  if (presentation === undefined) return { _tag: "Empty", entries: [] }
  const resolved = Option.getOrUndefined(state.resolved)
  if (presentation._tag === "Pending" && resolved === undefined) {
    return { _tag: "Pending", entries: [] }
  }
  const entries = displayEntries(state)
  const owner = presentation._tag === "Failed" ? presentation.owner : undefined
  const cause = presentation._tag === "Failed" ? presentation.cause : undefined
  if (owner === NotFoundFailureOwner) return { _tag: "NotFound", entries: [] }
  if (owner !== undefined && !entries.some((candidate) => candidate.id === owner)) {
    return { _tag: "RouterFailure", entries: [], failure: { _tag: "Cause", cause: cause ?? Cause.empty } }
  }
  return {
    _tag: "Entries",
    entries: entries.map((entry) => {
      const display = toDisplayEntry(entry)
      return {
        node: display.node,
        id: display.id,
        input: display.input,
        failure: owner === entry.id ? Option.getOrNull(display.failure) : null
      }
    })
  }
}

/**
 * Selects an outlet without requiring core nodes or Effect inputs. Transparent
 * layouts are skipped; explicit empty views terminate the branch. Entry errors
 * replace their subtree, and router-level failures render only at the root.
 *
 * @since 0.4.0
 */
export const selectOutlet = <
  Entry extends { readonly id: string; readonly failure: Failure | null },
  Failure,
  V extends ViewShape
>(
  snapshot: DisplaySnapshot<Entry, Failure>,
  depth: number,
  views: ViewLookup<V>,
  fallback: V
): SnapshotOutletDecision<Entry, Failure, V> => {
  switch (snapshot._tag) {
    case "Empty":
      return { _tag: "Empty" }
    case "NotFound":
      return { _tag: "NotFound" }
    case "Pending":
      return depth === 0 ? { _tag: "Pending" } : { _tag: "Empty" }
    case "RouterFailure":
      return depth === 0 ? { _tag: "RouterFailure", failure: snapshot.failure } : { _tag: "Empty" }
  }
  const entries = snapshot.entries
  for (let index = depth; index < entries.length; index++) {
    const entry = entries[index]
    if (entry === undefined) return { _tag: "Empty" }
    const view = views.get(entry.id)
    if (entry.failure !== null) {
      return {
        _tag: "Failure",
        nextDepth: index + 1,
        entry,
        view: view ?? fallback,
        failure: entry.failure
      }
    }
    if (view !== undefined && view.empty === true) return { _tag: "Empty" }
    const hasRender = view !== undefined && (view.component !== undefined || view.render !== undefined)
    if (!hasRender) {
      // A transparent layout passes through to its descendant.
      continue
    }
    return { _tag: "View", nextDepth: index + 1, entry, view }
  }
  return { _tag: "Empty" }
}

/** The compatible core outlet decision with Option-valued display entries. @since 0.4.0 */
export const outletDecision = <V extends ViewShape>(
  state: PresentationState,
  depth: number,
  views: ViewLookup<V>,
  fallback: V
): OutletDecision<V> => {
  const decision = selectOutlet(projectPresentation(state), depth, views, fallback)
  if (decision._tag === "View" || decision._tag === "Failure") {
    const entry = displayEntries(state)[decision.nextDepth - 1]
    if (entry === undefined) return { _tag: "Empty" }
    return { ...decision, entry: toDisplayEntry(entry) }
  }
  if (decision._tag === "RouterFailure") {
    const failure = decision.failure
    // Router-level failures are always causes, never domain gate errors.
    return {
      _tag: "RouterFailure",
      failure: { _tag: "Cause", cause: failure._tag === "Cause" ? failure.cause : Cause.empty }
    }
  }
  return decision
}
