import type { Router } from "@effect-stack/router"
import * as Presentation from "@effect-stack/router/Presentation"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { ErrorCodec, ViewFailure } from "./route.ts"
import { causeDiagnostic, diagnostic, EncodedInput, type Failure, type State } from "./state.ts"

const JsonString = Schema.fromJsonString(Schema.Json)
const Input = Schema.Struct({
  params: Schema.Unknown,
  search: Schema.Unknown,
  hash: Schema.Unknown,
  location: EncodedInput.fields.location
})

/** Encode original URL codecs, not JSON-derived codecs which may change URL representations. */
export const encodeInput = (node: Router.AnyNode, input: unknown): EncodedInput => {
  const decoded = Schema.decodeUnknownSync(Input)(input)
  const hash = node.hashSchema === undefined ? undefined : Schema.encodeUnknownSync(node.hashSchema)(decoded.hash)
  return {
    params: Schema.encodeUnknownSync(JsonString)(Schema.encodeUnknownSync(node.paramsSchema)(decoded.params)),
    search: Schema.encodeUnknownSync(JsonString)(Schema.encodeUnknownSync(node.searchSchema)(decoded.search)),
    hash: hash === undefined ? null : Schema.encodeUnknownSync(JsonString)(hash),
    location: decoded.location
  }
}

export const decodeInput = (
  node: Router.AnyNode,
  encoded: EncodedInput
): Router.DecodedRouteInput<Router.Fields, Router.Fields, Schema.Top | undefined> => {
  const input = Schema.decodeUnknownSync(EncodedInput)(encoded)
  return {
    params: Schema.decodeUnknownSync(node.paramsSchema)(Schema.decodeUnknownSync(JsonString)(input.params)),
    search: Schema.decodeUnknownSync(node.searchSchema)(Schema.decodeUnknownSync(JsonString)(input.search)),
    hash:
      node.hashSchema === undefined
        ? undefined
        : Schema.decodeUnknownSync(node.hashSchema)(
            input.hash === null ? undefined : Schema.decodeUnknownSync(JsonString)(input.hash)
          ),
    location: input.location
  }
}

const domainDiagnostic = (operation: string, error: unknown): Extract<Failure, { readonly _tag: "Diagnostic" }> => ({
  _tag: "Diagnostic",
  diagnostic: { operation, message: diagnostic(operation, error).message, reasons: ["Failure"] }
})

const encodeFailure = (failure: Presentation.ViewFailure, errorSchema?: ErrorCodec<unknown>): Failure => {
  if (failure._tag === "Cause") {
    return { _tag: "Diagnostic", diagnostic: causeDiagnostic("Router.presentation", failure.cause) }
  }
  if (errorSchema === undefined) {
    return domainDiagnostic("Router.encodeFailure", "Domain failure has no error codec")
  }
  try {
    const codec = Schema.toCodecJson(errorSchema)
    const encoded = Schema.encodeUnknownSync(codec)(failure.error)
    // Verify the persisted representation can be restored before claiming it is a Domain failure.
    Schema.decodeUnknownSync(codec)(encoded)
    return { _tag: "Domain", error: Schema.encodeUnknownSync(JsonString)(encoded) }
  } catch (error) {
    return domainDiagnostic("Router.encodeFailure", error)
  }
}

export const decodeFailure = (failure: Failure, errorSchema?: ErrorCodec<unknown>): ViewFailure<unknown> => {
  if (failure._tag === "Diagnostic") return failure
  if (errorSchema === undefined) {
    return domainDiagnostic("Router.decodeFailure", "Domain failure has no error codec")
  }
  try {
    return {
      _tag: "Domain",
      error: Schema.decodeUnknownSync(Schema.toCodecJson(errorSchema))(
        Schema.decodeUnknownSync(JsonString)(failure.error)
      )
    }
  } catch (error) {
    return domainDiagnostic("Router.decodeFailure", error)
  }
}

/** Project accepted navigation facts independently from the retained displayed branch. */
export const toState = (
  applicationId: string,
  state: Router.RouterState<unknown>,
  views: ReadonlyMap<string, { readonly errorSchema?: ErrorCodec<unknown> }>
): State => {
  const location = Option.getOrNull(state.location)
  const base = {
    version: 1 as const,
    applicationId,
    connection: "Ready" as const,
    location:
      location === null
        ? null
        : {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
            key: location.key,
            index: location.index
          },
    status: state.status._tag,
    attempt: state.status._tag === "Idle" ? null : state.status.attempt
  }
  try {
    const snapshot = Presentation.projectPresentation(state)
    return {
      ...base,
      display: snapshot._tag,
      entries: snapshot.entries.map((entry) => ({
        id: entry.id,
        input: Option.isSome(entry.input) ? encodeInput(entry.node, entry.input.value) : null,
        failure: entry.failure === null ? null : encodeFailure(entry.failure, views.get(entry.id)?.errorSchema)
      })),
      diagnostic:
        snapshot._tag === "RouterFailure"
          ? snapshot.failure._tag === "Cause"
            ? causeDiagnostic("Router.presentation", snapshot.failure.cause)
            : { operation: "Router.presentation", message: "Unowned domain failure", reasons: ["Failure"] }
          : null
    }
  } catch (error) {
    return { ...base, display: "RouterFailure", entries: [], diagnostic: diagnostic("Router.snapshot", error) }
  }
}
