/**
 * Renderer-neutral presentation selection shared by first-party adapters.
 *
 * @since 0.4.0
 */
export type {
  DisplayEntry,
  OutletDecision,
  PresentationState,
  ViewFailure,
  ViewLookup,
  ViewShape
} from "./internal/presentation.ts"
export {
  displayEntries,
  entryFailure,
  NotFoundFailureOwner,
  outletDecision,
  toDisplayEntry
} from "./internal/presentation.ts"
