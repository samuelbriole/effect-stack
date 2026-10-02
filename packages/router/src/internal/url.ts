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
import * as UrlParams from "effect/http/UrlParams"
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

/** Only asynchronous evaluation defects become typed URL failures. */
const isAsyncFiberFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const cause = error.cause
  if (!Cause.isCause(cause)) return false
  return cause.reasons.some((reason) => Cause.isDieReason(reason) && Cause.isAsyncFiberError(reason.defect))
}

const codecSync = <A, Err>(
  run: () => Result.Result<A, Schema.SchemaError>,
  failure: (message: string) => Err,
  asyncMessage: string
): Result.Result<A, Err> => {
  try {
    return Result.mapError(run(), (error) => failure(error.message))
  } catch (error) {
    if (isAsyncFiberFailure(error)) return Result.fail(failure(asyncMessage))
    throw error
  }
}

const probeDecode = <Err>(codec: UrlCodec, value: unknown, onAsync: () => Err): Result.Result<boolean, Err> =>
  codecSync(
    () => Result.succeed(Result.isSuccess(Schema.decodeUnknownResult(codec)(value))),
    onAsync,
    asyncDecodeMessage
  )

const rawSearch = (search: string): Readonly<Record<string, unknown>> => {
  const values = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  return UrlParams.toRecord(UrlParams.fromInput(values))
}

const normalizeSearch = (
  routeId: string,
  fields: UrlFields,
  input: Readonly<Record<string, unknown>>
): Result.Result<Readonly<Record<string, unknown>>, RouteDecodeError> =>
  Result.gen(function* () {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(fields)) {
      const value = input[key]
      if (value === undefined) continue
      const codec = fields[key]
      if (codec === undefined) continue
      if (typeof value === "string") {
        const scalar = yield* probeDecode(
          codec,
          value,
          () => new RouteDecodeError({ routeId, part: "search", input: value, message: asyncDecodeMessage })
        )
        output[key] = scalar ? value : [value]
      } else {
        output[key] = value
      }
    }
    return output
  })

/**
 * Matches and decodes one node against a URL. A different path is `None`;
 * malformed values on a structurally matching path are a typed failure.
 *
 * @since 0.4.0
 * @category matching
 */
export const match = (node: UrlCodecs, url: UrlParts): Result.Result<Option.Option<DecodedMatch>, RouteDecodeError> =>
  Result.gen(function* () {
    const expected = pathSegments(node.path)
    const actual = pathSegments(url.pathname)
    if (expected.length !== actual.length) {
      return Option.none()
    }

    const encodedParams: Record<string, string> = {}
    for (let index = 0; index < expected.length; index++) {
      const expectedSegment = expected[index]
      const actualSegment = actual[index]
      if (expectedSegment === undefined || actualSegment === undefined) {
        return Option.none()
      }
      const decoded = yield* decodeUriPart(node.id, "path", actualSegment)
      if (expectedSegment.startsWith(":")) {
        encodedParams[expectedSegment.slice(1)] = decoded
      } else if (expectedSegment !== decoded) {
        return Option.none()
      }
    }

    const params = yield* codecSync(
      () => Schema.decodeUnknownResult(node.paramsSchema)(encodedParams),
      (message) => new RouteDecodeError({ routeId: node.id, part: "path", input: url.pathname, message }),
      asyncDecodeMessage
    )
    const normalizedSearch = yield* normalizeSearch(node.id, node.searchSchema.fields, rawSearch(url.search))
    const search = yield* codecSync(
      () => Schema.decodeUnknownResult(node.searchSchema)(normalizedSearch),
      (message) => new RouteDecodeError({ routeId: node.id, part: "search", input: url.search, message }),
      asyncDecodeMessage
    )
    let hash: unknown = undefined
    const hashSchema = node.hashSchema
    if (hashSchema !== undefined) {
      let raw: unknown = undefined
      if (url.hash.length > 0) {
        const encodedHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
        raw = yield* decodeUriPart(node.id, "hash", encodedHash)
      }
      hash = yield* codecSync(
        () => Schema.decodeUnknownResult(hashSchema)(raw),
        (message) => new RouteDecodeError({ routeId: node.id, part: "hash", input: url.hash, message }),
        asyncDecodeMessage
      )
    }

    return Option.some({ params, search, hash })
  })

const encodeSearch = (routeId: string, fields: UrlFields, value: unknown): Result.Result<string, RouteEncodeError> =>
  Result.gen(function* () {
    if (!Predicate.isObject(value)) {
      return yield* Result.fail(
        new RouteEncodeError({ routeId, part: "search", message: "The encoded search value must be an object" })
      )
    }
    const params: Array<readonly [string, string]> = []
    for (const key of Object.keys(value).sort()) {
      yield* Result.mapError(
        encodeUriPart(routeId, "search", key),
        () => new RouteEncodeError({ routeId, part: "search", message: "Search field name contains invalid Unicode" })
      )
      const item = value[key]
      if (item === undefined) continue
      if (typeof item !== "string" && !(Array.isArray(item) && item.every((entry) => typeof entry === "string"))) {
        return yield* Result.fail(
          new RouteEncodeError({
            routeId,
            part: "search",
            message: `Search field ${key} must encode to a string or an array of strings`
          })
        )
      }
      if (Array.isArray(item)) {
        if (item.length === 0) {
          return yield* Result.fail(
            new RouteEncodeError({
              routeId,
              part: "search",
              message: `Search field ${key} cannot encode an empty array`
            })
          )
        }
        const codec = fields[key]
        if (item.length === 1 && codec !== undefined) {
          const scalar = yield* probeDecode(
            codec,
            item[0],
            () => new RouteEncodeError({ routeId, part: "search", message: asyncDecodeMessage })
          )
          if (scalar) {
            return yield* Result.fail(
              new RouteEncodeError({
                routeId,
                part: "search",
                message: `Search field ${key} cannot distinguish a singleton array from a scalar value`
              })
            )
          }
        }
      }
      for (const entry of typeof item === "string" ? [item] : item) {
        yield* Result.mapError(
          encodeUriPart(routeId, "search", entry),
          () =>
            new RouteEncodeError({ routeId, part: "search", message: `Search field ${key} contains invalid Unicode` })
        )
        params.push([key, entry])
      }
    }
    const encoded = UrlParams.toString(UrlParams.make(params))
    return encoded.length === 0 ? "" : `?${encoded}`
  })

/**
 * Encodes typed node input into a canonical href.
 *
 * @since 0.4.0
 * @category encoding
 */
export const encode = (
  node: UrlCodecs,
  input: { readonly params: unknown; readonly search: unknown; readonly hash: unknown }
): Result.Result<string, RouteEncodeError> =>
  Result.gen(function* () {
    const encodedParams = yield* codecSync(
      () => Schema.encodeUnknownResult(node.paramsSchema)(input.params),
      (message) => new RouteEncodeError({ routeId: node.id, part: "path", message }),
      asyncEncodeMessage
    )
    if (!Predicate.isObject(encodedParams)) {
      return yield* Result.fail(
        new RouteEncodeError({
          routeId: node.id,
          part: "path",
          message: "The encoded path parameters must be an object"
        })
      )
    }
    const pathnameSegments: Array<string> = []
    for (const segment of pathSegments(node.path)) {
      const key = segment.startsWith(":") ? segment.slice(1) : undefined
      const value = key === undefined ? segment : encodedParams[key]
      if (typeof value !== "string") {
        return yield* Result.fail(
          new RouteEncodeError({
            routeId: node.id,
            part: "path",
            message: `Path parameter ${key ?? segment} must encode to a string`
          })
        )
      }
      if (key !== undefined && (value === "." || value === "..")) {
        return yield* Result.fail(
          new RouteEncodeError({
            routeId: node.id,
            part: "path",
            message: `Path parameter ${key} cannot be a dot segment`
          })
        )
      }
      const encoded = yield* encodeUriPart(node.id, "path", value)
      if (key !== undefined && encoded.length === 0) {
        return yield* Result.fail(
          new RouteEncodeError({
            routeId: node.id,
            part: "path",
            message: `Path parameter ${key} cannot encode to an empty segment`
          })
        )
      }
      pathnameSegments.push(encoded)
    }
    const pathname = pathnameSegments.length === 0 ? "/" : `/${pathnameSegments.join("/")}`
    // A protocol-relative href would resolve to an external origin.
    if (pathname !== "/" && (pathname.startsWith("//") || !pathname.startsWith("/"))) {
      return yield* Result.fail(
        new RouteEncodeError({
          routeId: node.id,
          part: "path",
          message: "The encoded path is not a canonical internal path"
        })
      )
    }

    const encodedSearchValue = yield* codecSync(
      () => Schema.encodeUnknownResult(node.searchSchema)(input.search),
      (message) => new RouteEncodeError({ routeId: node.id, part: "search", message }),
      asyncEncodeMessage
    )
    const search = yield* encodeSearch(node.id, node.searchSchema.fields, encodedSearchValue)

    let hash = ""
    const hashSchema = node.hashSchema
    if (hashSchema !== undefined) {
      const encodedHashValue = yield* codecSync(
        () => Schema.encodeUnknownResult(hashSchema)(input.hash),
        (message) => new RouteEncodeError({ routeId: node.id, part: "hash", message }),
        asyncEncodeMessage
      )
      if (encodedHashValue !== undefined) {
        if (typeof encodedHashValue !== "string") {
          return yield* Result.fail(
            new RouteEncodeError({ routeId: node.id, part: "hash", message: "Hash must encode to a string" })
          )
        }
        const encodedHash = yield* encodeUriPart(node.id, "hash", encodedHashValue)
        // Empty fragments cannot be distinguished from absent fragments.
        if (encodedHash.length === 0) {
          return yield* Result.fail(
            new RouteEncodeError({
              routeId: node.id,
              part: "hash",
              message: "A declared hash cannot encode to an empty fragment"
            })
          )
        }
        hash = `#${encodedHash}`
      }
    }
    return `${pathname}${search}${hash}`
  })
