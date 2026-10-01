import * as Schema from "effect/Schema"
import * as Cause from "effect/Cause"

/** Serializable failure information; never masquerades as a restored raw Cause. @since 0.1.0 */
export const Diagnostic = Schema.Struct({
  operation: Schema.String,
  message: Schema.String,
  reasons: Schema.Array(Schema.Literals(["Failure", "Defect", "Interrupt"]))
})
/** @since 0.1.0 */
export interface Diagnostic extends Schema.Schema.Type<typeof Diagnostic> {}

/** Route codecs encode each section independently, retaining its displayed location. @since 0.1.0 */
export const EncodedInput = Schema.Struct({
  params: Schema.String,
  search: Schema.String,
  hash: Schema.NullOr(Schema.String),
  location: Schema.Struct({ pathname: Schema.String, search: Schema.String, hash: Schema.String })
})
/** @since 0.1.0 */
export interface EncodedInput extends Schema.Schema.Type<typeof EncodedInput> {}

/** @since 0.1.0 */
export const Failure = Schema.Union([
  Schema.TaggedStruct("Domain", { error: Schema.String }),
  Schema.TaggedStruct("Diagnostic", { diagnostic: Diagnostic })
])
/** @since 0.1.0 */
export type Failure = typeof Failure.Type

/** @since 0.1.0 */
export const Entry = Schema.Struct({
  id: Schema.String,
  input: Schema.NullOr(EncodedInput),
  failure: Schema.NullOr(Failure)
})
/** @since 0.1.0 */
export interface Entry extends Schema.Schema.Type<typeof Entry> {}

/** Data-only Model field, independent of application/view inference. History state is deliberately excluded. @since 0.1.0 */
export const State = Schema.Struct({
  version: Schema.Literal(1),
  applicationId: Schema.String,
  connection: Schema.Literals(["Connecting", "Ready", "StartupFailed"]),
  location: Schema.NullOr(
    Schema.Struct({
      pathname: Schema.String,
      search: Schema.String,
      hash: Schema.String,
      key: Schema.String,
      index: Schema.Number
    })
  ),
  status: Schema.Literals(["Idle", "Pending", "Committed", "Cancelled", "Failed"]),
  attempt: Schema.NullOr(Schema.Number),
  display: Schema.Literals(["Empty", "Pending", "NotFound", "RouterFailure", "Entries"]),
  entries: Schema.Array(Entry),
  diagnostic: Schema.NullOr(Diagnostic)
})
/** @since 0.1.0 */
export interface State extends Schema.Schema.Type<typeof State> {}

/** @since 0.1.0 */
export const initialState = (applicationId: string): State => ({
  version: 1,
  applicationId,
  connection: "Connecting",
  location: null,
  status: "Idle",
  attempt: null,
  display: "Pending",
  entries: [],
  diagnostic: null
})

/** JSON-safe navigation intent; runtime definitions and handles never enter Messages. @since 0.1.0 */
export const NavigationRequest = Schema.Struct({
  id: Schema.String,
  input: EncodedInput,
  replace: Schema.Boolean,
  state: Schema.NullOr(Schema.String)
})
/** @since 0.1.0 */
export interface NavigationRequest extends Schema.Schema.Type<typeof NavigationRequest> {}

/** Facts and intents that can be nested in the application's Message union. @since 0.1.0 */
export const RouterMessage = Schema.Union([
  Schema.TaggedStruct("RouterStateChanged", { state: State }),
  Schema.TaggedStruct("RequestedNavigation", { applicationId: Schema.String, request: NavigationRequest }),
  Schema.TaggedStruct("RequestedRouterCommand", {
    applicationId: Schema.String,
    command: Schema.Literals(["Retry", "Refresh", "Back", "Forward", "Go", "Cancel"]),
    value: Schema.Number
  }),
  Schema.TaggedStruct("CompletedRouterCommand", {
    applicationId: Schema.String,
    outcome: Schema.Literals(["Committed", "Superseded", "Cancelled", "Accepted", "Rejected"]),
    diagnostic: Schema.NullOr(Diagnostic)
  })
])
/** @since 0.1.0 */
export type RouterMessage = typeof RouterMessage.Type

export const diagnostic = (operation: string, error: unknown): Diagnostic => ({
  operation,
  message: error instanceof Error ? error.message : typeof error === "string" ? error : "Router operation failed",
  reasons: ["Defect"]
})

export const causeDiagnostic = (operation: string, cause: Cause.Cause<unknown>): Diagnostic => ({
  operation,
  message: Cause.pretty(cause),
  reasons: cause.reasons.map((reason) =>
    Cause.isFailReason(reason) ? "Failure" : Cause.isDieReason(reason) ? "Defect" : "Interrupt"
  )
})
