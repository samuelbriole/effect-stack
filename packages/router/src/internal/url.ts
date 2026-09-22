/**
 * Shared URL representation and codecs. Internal module.
 *
 * @since 0.4.0
 */
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as UrlParams from "effect/unstable/http/UrlParams"
import { RouteDecodeError, RouteEncodeError } from "./errors.ts"

/**
 * The URL portions owned by matching.
 *
 * @since 0.4.0
 * @category models
 */
export interface UrlParts {
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

/**
 * A structurally matching URL decoded through a node's codecs.
 *
 * @since 0.4.0
 * @category models
 */
export interface DecodedMatch {
  readonly params: unknown
  readonly search: unknown
  readonly hash: unknown
}

/**
 * The erased codec surface a node exposes to the URL layer.
 *
 * @since 0.4.0
 * @category models
 */
export type UrlCodec = Schema.ConstraintCodec<unknown, unknown, never, never>

/**
 * A full schema constrained to a context-free synchronous codec. Used for URL
 * sections so that service-requiring schemas are rejected statically.
 *
 * @since 0.4.0
 */
export type UrlSchema = Schema.Top & UrlCodec

/** @since 0.4.0 */
export type UrlSchemaFields = { readonly [x: string]: UrlSchema }

/** @since 0.4.0 */
export type UrlFields = { readonly [x: string]: UrlCodec }

/**
 * The erased codec surface a node exposes to the URL layer.
 *
 * @since 0.4.0
 * @category models
 */
export interface UrlCodecs {
  readonly id: string
  readonly path: string
  readonly paramsSchema: Schema.Struct<UrlFields>
  readonly searchSchema: Schema.Struct<UrlFields>
  readonly hashSchema: UrlCodec | undefined
}

/** Splits a path into raw, still-encoded segments. `/` has none. @since 0.4.0 */
export const pathSegments = (path: string): ReadonlyArray<string> => (path === "/" ? [] : path.slice(1).split("/"))

const decodeUriPart = (
  routeId: string,
  part: "path" | "search" | "hash",
  input: string
): Result.Result<string, RouteDecodeError> => {
  try {
    return Result.succeed(decodeURIComponent(input))
  } catch {
    return Result.fail(new RouteDecodeError({ routeId, part, input, message: "Invalid percent encoding" }))
  }
}

const encodeUriPart = (
  routeId: string,
  part: "path" | "search" | "hash",
  input: string
): Result.Result<string, RouteEncodeError> => {
  try {
    return Result.succeed(encodeURIComponent(input))
  } catch {
    return Result.fail(new RouteEncodeError({ routeId, part, message: "Value contains invalid Unicode" }))
  }
}

const asyncDecodeMessage = "Schema codecs must decode synchronously; this codec requires asynchronous decoding"
const asyncEncodeMessage = "Schema codecs must encode synchronously; this codec requires asynchronous encoding"

/**
 * Effect's synchronous schema adapters throw a plain `Error` whose `cause` is
 * the underlying `Cause` when the schema cannot be evaluated synchronously
 * (for example an asynchronous transformation). Detecting that specific defect
 * lets the URL layer convert it into a typed failure while preserving every
 * unrelated defect.
 */
const isAsyncFiberFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const cause = error.cause
  if (!Cause.isCause(cause)) return false
  return cause.reasons.some((reason) => Cause.isDieReason(reason) && Cause.isAsyncFiberError(reason.defect))
}

const decodeSync = <A, Err>(
  run: () => Result.Result<A, Schema.SchemaError>,
  failure: (message: string) => Err,
  asyncMessage: string
): Result.Result<A, Err> => {
  try {
    const decoded = run()
    return Result.isFailure(decoded) ? Result.fail(failure(decoded.failure.message)) : Result.succeed(decoded.success)
  } catch (error) {
    if (isAsyncFiberFailure(error)) return Result.fail(failure(asyncMessage))
    throw error
  }
}

const encodeSync = <A, Err>(
  run: () => Result.Result<A, Schema.SchemaError>,
  failure: (message: string) => Err,
  asyncMessage: string
): Result.Result<A, Err> => {
  try {
    const encoded = run()
    return Result.isFailure(encoded) ? Result.fail(failure(encoded.failure.message)) : Result.succeed(encoded.success)
  } catch (error) {
    if (isAsyncFiberFailure(error)) return Result.fail(failure(asyncMessage))
    throw error
  }
}

/**
 * Whether a value decodes as a scalar. A synchronous decode failure is a plain
 * `false`; an asynchronous defect is surfaced as the caller's typed failure.
 */
const probeDecode = <Err>(codec: UrlCodec, value: unknown, onAsync: () => Err): Result.Result<boolean, Err> => {
  try {
    return Result.succeed(Result.isSuccess(Schema.decodeUnknownResult(codec)(value)))
  } catch (error) {
    if (isAsyncFiberFailure(error)) return Result.fail(onAsync())
    throw error
  }
}

const rawSearch = (search: string): Readonly<Record<string, unknown>> => {
  const values = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  return UrlParams.toRecord(UrlParams.fromInput(values))
}

const normalizeSearch = (
  routeId: string,
  fields: UrlFields,
  input: Readonly<Record<string, unknown>>
): Result.Result<Readonly<Record<string, unknown>>, RouteDecodeError> => {
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(fields)) {
    const value = input[key]
    if (value === undefined) continue
    const codec = fields[key]
    if (codec === undefined) continue
    if (typeof value === "string") {
      const scalar = probeDecode(
        codec,
        value,
        () => new RouteDecodeError({ routeId, part: "search", input: value, message: asyncDecodeMessage })
      )
      if (Result.isFailure(scalar)) return Result.fail(scalar.failure)
      output[key] = scalar.success ? value : [value]
    } else {
      output[key] = value
    }
  }
  return Result.succeed(output)
}

/**
 * Matches and decodes one node against a URL. A different path is `None`;
 * malformed values on a structurally matching path are a typed failure.
 *
 * @since 0.4.0
 * @category matching
 */
export const match = (node: UrlCodecs, url: UrlParts): Result.Result<Option.Option<DecodedMatch>, RouteDecodeError> => {
  const expected = pathSegments(node.path)
  const actual = pathSegments(url.pathname)
  if (expected.length !== actual.length) {
    return Result.succeed(Option.none())
  }

  const encodedParams: Record<string, string> = {}
  for (let index = 0; index < expected.length; index++) {
    const expectedSegment = expected[index]
    const actualSegment = actual[index]
    if (expectedSegment === undefined || actualSegment === undefined) {
      return Result.succeed(Option.none())
    }
    const decoded = decodeUriPart(node.id, "path", actualSegment)
    if (Result.isFailure(decoded)) return Result.fail(decoded.failure)
    if (expectedSegment.startsWith(":")) {
      encodedParams[expectedSegment.slice(1)] = decoded.success
    } else if (expectedSegment !== decoded.success) {
      return Result.succeed(Option.none())
    }
  }

  const params = decodeSync(
    () => Schema.decodeUnknownResult(node.paramsSchema)(encodedParams),
    (message) => new RouteDecodeError({ routeId: node.id, part: "path", input: url.pathname, message }),
    asyncDecodeMessage
  )
  if (Result.isFailure(params)) {
    return Result.fail(params.failure)
  }

  const normalizedSearch = normalizeSearch(node.id, node.searchSchema.fields, rawSearch(url.search))
  if (Result.isFailure(normalizedSearch)) {
    return Result.fail(normalizedSearch.failure)
  }
  const search = decodeSync(
    () => Schema.decodeUnknownResult(node.searchSchema)(normalizedSearch.success),
    (message) => new RouteDecodeError({ routeId: node.id, part: "search", input: url.search, message }),
    asyncDecodeMessage
  )
  if (Result.isFailure(search)) {
    return Result.fail(search.failure)
  }

  let hash: unknown = undefined
  const hashSchema = node.hashSchema
  if (hashSchema !== undefined) {
    const encodedHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
    const decodedHash = decodeUriPart(node.id, "hash", encodedHash)
    if (Result.isFailure(decodedHash)) return Result.fail(decodedHash.failure)
    const decoded = decodeSync(
      () => Schema.decodeUnknownResult(hashSchema)(decodedHash.success),
      (message) => new RouteDecodeError({ routeId: node.id, part: "hash", input: url.hash, message }),
      asyncDecodeMessage
    )
    if (Result.isFailure(decoded)) {
      return Result.fail(decoded.failure)
    }
    hash = decoded.success
  }

  return Result.succeed(Option.some({ params: params.success, search: search.success, hash }))
}

const encodeSearch = (routeId: string, fields: UrlFields, value: unknown): Result.Result<string, RouteEncodeError> => {
  if (!Predicate.isObject(value)) {
    return Result.fail(
      new RouteEncodeError({ routeId, part: "search", message: "The encoded search value must be an object" })
    )
  }
  const params: Array<readonly [string, string]> = []
  for (const key of Object.keys(value).sort()) {
    if (Result.isFailure(encodeUriPart(routeId, "search", key))) {
      return Result.fail(
        new RouteEncodeError({ routeId, part: "search", message: "Search field name contains invalid Unicode" })
      )
    }
    const item = value[key]
    if (item === undefined) continue
    if (typeof item === "string") {
      if (Result.isFailure(encodeUriPart(routeId, "search", item))) {
        return Result.fail(
          new RouteEncodeError({ routeId, part: "search", message: `Search field ${key} contains invalid Unicode` })
        )
      }
      params.push([key, item])
      continue
    }
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      if (item.length === 0) {
        return Result.fail(
          new RouteEncodeError({ routeId, part: "search", message: `Search field ${key} cannot encode an empty array` })
        )
      }
      const codec = fields[key]
      if (item.length === 1 && codec !== undefined) {
        const scalar = probeDecode(
          codec,
          item[0],
          () => new RouteEncodeError({ routeId, part: "search", message: asyncDecodeMessage })
        )
        if (Result.isFailure(scalar)) return Result.fail(scalar.failure)
        if (scalar.success) {
          return Result.fail(
            new RouteEncodeError({
              routeId,
              part: "search",
              message: `Search field ${key} cannot distinguish a singleton array from a scalar value`
            })
          )
        }
      }
      for (const entry of item) {
        if (Result.isFailure(encodeUriPart(routeId, "search", entry))) {
          return Result.fail(
            new RouteEncodeError({ routeId, part: "search", message: `Search field ${key} contains invalid Unicode` })
          )
        }
        params.push([key, entry])
      }
      continue
    }
    return Result.fail(
      new RouteEncodeError({
        routeId,
        part: "search",
        message: `Search field ${key} must encode to a string or an array of strings`
      })
    )
  }
  const encoded = UrlParams.toString(UrlParams.make(params))
  return Result.succeed(encoded.length === 0 ? "" : `?${encoded}`)
}

/**
 * Encodes typed node input into a canonical href.
 *
 * @since 0.4.0
 * @category encoding
 */
export const encode = (
  node: UrlCodecs,
  input: { readonly params: unknown; readonly search: unknown; readonly hash: unknown }
): Result.Result<string, RouteEncodeError> => {
  const encodedParams = encodeSync(
    () => Schema.encodeResult(node.paramsSchema)(input.params as Record<string, unknown>),
    (message) => new RouteEncodeError({ routeId: node.id, part: "path", message }),
    asyncEncodeMessage
  )
  if (Result.isFailure(encodedParams)) {
    return Result.fail(encodedParams.failure)
  }
  if (!Predicate.isObject(encodedParams.success)) {
    return Result.fail(
      new RouteEncodeError({ routeId: node.id, part: "path", message: "The encoded path parameters must be an object" })
    )
  }
  const pathnameSegments: Array<string> = []
  for (const segment of pathSegments(node.path)) {
    const key = segment.startsWith(":") ? segment.slice(1) : undefined
    const value = key === undefined ? segment : encodedParams.success[key]
    if (typeof value !== "string") {
      return Result.fail(
        new RouteEncodeError({
          routeId: node.id,
          part: "path",
          message: `Path parameter ${key ?? segment} must encode to a string`
        })
      )
    }
    if (key !== undefined && (value === "." || value === "..")) {
      return Result.fail(
        new RouteEncodeError({
          routeId: node.id,
          part: "path",
          message: `Path parameter ${key} cannot be a dot segment`
        })
      )
    }
    const encoded = encodeUriPart(node.id, "path", value)
    if (Result.isFailure(encoded)) return encoded
    pathnameSegments.push(encoded.success)
  }
  const pathname = pathnameSegments.length === 0 ? "/" : `/${pathnameSegments.join("/")}`

  const encodedSearchValue = encodeSync(
    () => Schema.encodeResult(node.searchSchema)(input.search as Record<string, unknown>),
    (message) => new RouteEncodeError({ routeId: node.id, part: "search", message }),
    asyncEncodeMessage
  )
  if (Result.isFailure(encodedSearchValue)) {
    return Result.fail(encodedSearchValue.failure)
  }
  const search = encodeSearch(node.id, node.searchSchema.fields, encodedSearchValue.success)
  if (Result.isFailure(search)) return search

  let hash = ""
  const hashSchema = node.hashSchema
  if (hashSchema !== undefined && input.hash !== undefined) {
    const encodedHashValue = encodeSync(
      () => Schema.encodeResult(hashSchema)(input.hash),
      (message) => new RouteEncodeError({ routeId: node.id, part: "hash", message }),
      asyncEncodeMessage
    )
    if (Result.isFailure(encodedHashValue)) {
      return Result.fail(encodedHashValue.failure)
    }
    if (typeof encodedHashValue.success !== "string") {
      return Result.fail(
        new RouteEncodeError({ routeId: node.id, part: "hash", message: "Hash must encode to a string" })
      )
    }
    const encodedHash = encodeUriPart(node.id, "hash", encodedHashValue.success)
    if (Result.isFailure(encodedHash)) return encodedHash
    hash = encodedHash.success.length === 0 ? "" : `#${encodedHash.success}`
  }
  return Result.succeed(`${pathname}${search.success}${hash}`)
}
