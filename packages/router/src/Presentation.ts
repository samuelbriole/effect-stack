/**
 * Renderer-neutral presentation selection shared by first-party adapters.
 *
 * @since 0.4.0
 */
export type {
  DisplayEntry,
  DisplayItem,
  DisplaySnapshot,
  OutletDecision,
  PresentationState,
  SnapshotOutletDecision,
  ViewFailure,
  ViewLookup,
  ViewShape
} from "./internal/presentation.ts"
export {
  displayEntries,
  entryFailure,
  NotFoundFailureOwner,
  outletDecision,
  projectPresentation,
  selectOutlet,
  toDisplayEntry
} from "./internal/presentation.ts"
