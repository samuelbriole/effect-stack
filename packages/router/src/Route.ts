/**
 * Typed, bidirectional URL route definitions.
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as UrlParams from "effect/unstable/http/UrlParams"

/**
 * The URL portions owned by route matching.
 *
 * @since 0.1.0
 * @category models
 */
export interface UrlParts {
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

/**
 * The route value supplied when constructing an href.
 *
 * @since 0.1.0
 * @category models
 */
export interface RouteInput<Params, Search, Hash> {
  readonly params: Params
  readonly search: Search
  readonly hash: Hash
}

/**
 * A successfully decoded route match.
 *
 * @since 0.1.0
 * @category models
 */
export interface Match<R extends Any> {
  readonly id: R["id"]
  readonly route: R
  readonly params: Route.Params<R>
  readonly search: Route.Search<R>
  readonly hash: Route.Hash<R>
}

/**
 * A route whose URL shape and lazy module are fully typed.
 *
 * @since 0.1.0
 * @category models
 */
export interface Route<
  Id extends string,
  Path extends string,
  ParamsFields extends UrlFields,
  SearchFields extends UrlFields,
  HashSchema extends Schema.ConstraintCodec<unknown, string, never, never>,
  Module,
  LoadError,
  LoadServices
> {
  readonly id: Id
  readonly path: Path
  readonly paramsSchema: Schema.Struct<ParamsFields>
  readonly searchSchema: Schema.Struct<SearchFields>
  readonly hashSchema: HashSchema
  readonly load: undefined | (() => Effect.Effect<Module, LoadError, Scope.Scope | LoadServices>)
}

/**
 * Any route definition. Use the `Route.*` type helpers to retain a concrete
 * route's inferred values.
 *
 * @since 0.1.0
 * @category models
 */
export type Any = Route<
  string,
  string,
  UrlFields,
  UrlFields,
  Schema.ConstraintCodec<unknown, string, never, never>,
  unknown,
  unknown,
  unknown
>

/**
 * Type helpers for route definitions.
 *
 * @since 0.1.0
 */
export declare namespace Route {
  /** @since 0.1.0 */
  export type Id<R extends Any> = R["id"]
  /** @since 0.1.0 */
  export type Params<R extends Any> = R["paramsSchema"]["Type"]
  /** @since 0.1.0 */
  export type Search<R extends Any> = R["searchSchema"]["Type"]
  /** @since 0.1.0 */
  export type Hash<R extends Any> = R["hashSchema"]["Type"]
  /** @since 0.1.0 */
  export type Module<R extends Any> = R extends
    Route<string, string, infer _P, infer _S, infer _H, infer M, infer _E, infer _R> ? M
    : never
  /** @since 0.1.0 */
  export type LoadError<R extends Any> = R extends Route<
    string,
    string,
    infer _P,
    infer _S,
    infer _H,
    infer _M,
    infer E,
    infer _R
  > ? E
    : never
  /** @since 0.1.0 */
  export type LoadServices<R extends Any> = Exclude<
    R extends Route<
      string,
      string,
      infer _P,
      infer _S,
      infer _H,
      infer _M,
      infer _E,
      infer Services
    > ? Services
      : never,
    Scope.Scope
  >
  /** @since 0.1.0 */
  export type Input<R extends Any> = RouteInput<Params<R>, Search<R>, Hash<R>>
}

/**
 * The URL portion that failed Schema decoding.
 *
 * @since 0.1.0
 * @category models
 */
export const UrlPart = Schema.Literals(["path", "search", "hash"])

/** @since 0.1.0 */
export type UrlPart = typeof UrlPart.Type

/**
 * A structurally matching URL contained an invalid encoded value.
 *
 * @since 0.1.0
 * @category errors
 */
export class RouteDecodeError extends Schema.TaggedError<RouteDecodeError>()("@effect-web/router/RouteDecodeError", {
  routeId: Schema.String,
  part: UrlPart,
  input: Schema.String,
  message: Schema.String
}) {}

/**
 * A typed route value could not be encoded as a URL.
 *
 * @since 0.1.0
 * @category errors
 */
export class RouteEncodeError extends Schema.TaggedError<RouteEncodeError>()("@effect-web/router/RouteEncodeError", {
  routeId: Schema.String,
  part: UrlPart,
  message: Schema.String
}) {}

type PathParameter<Segment extends string> = Segment extends `:${infer Name}` ? Name : never

/**
 * Extracts named parameter keys from a route path.
 *
 * @since 0.1.0
 * @category type utilities
 */
export type PathParameters<Path extends string> = Path extends `${infer Head}/${infer Tail}`
  ? PathParameter<Head> | PathParameters<Tail>
  : PathParameter<Path>

type UrlFields = {
  readonly [x: PropertyKey]: Schema.ConstraintCodec<unknown, string | ReadonlyArray<string>, never, never>
}

type PathCodec = Schema.ConstraintCodec<unknown, string, never, never>

type ExactPathFields<Path extends string, Fields extends UrlFields> =
  & Fields
  & { readonly [K in PathParameters<Path>]: PathCodec }
  & { readonly [K in Exclude<keyof Fields, PathParameters<Path>>]: never }

interface BaseOptions<
  Id extends string,
  Path extends string,
  ParamsFields extends UrlFields,
  SearchFields extends UrlFields,
  HashSchema extends Schema.ConstraintCodec<unknown, string, never, never>
> {
  readonly id: Id
  readonly path: Path
  readonly params: ExactPathFields<Path, ParamsFields>
  readonly search: SearchFields
  readonly hash?: HashSchema | undefined
}

interface LazyOptions<
  Id extends string,
  Path extends string,
  ParamsFields extends UrlFields,
  SearchFields extends UrlFields,
  HashSchema extends Schema.ConstraintCodec<unknown, string, never, never>,
  Module,
  LoadError,
  LoadServices
> extends BaseOptions<Id, Path, ParamsFields, SearchFields, HashSchema> {
  readonly load: () => Effect.Effect<Module, LoadError, Scope.Scope | LoadServices>
}

const pathSegments = (path: string): ReadonlyArray<string> => path === "/" ? [] : path.slice(1).split("/")

const describeSchemaError = (error: Schema.SchemaError): string => error.message

/**
 * Defines an eager route.
 *
 * @since 0.1.0
 * @category constructors
 */
export function make<
  const Id extends string,
  const Path extends `/${string}`,
  const ParamsFields extends UrlFields,
  const SearchFields extends UrlFields,
  HashSchema extends Schema.ConstraintCodec<unknown, string, never, never> = Schema.String
>(options: BaseOptions<Id, Path, ParamsFields, SearchFields, HashSchema>): Route<
  Id,
  Path,
  ParamsFields,
  SearchFields,
  HashSchema,
  void,
  never,
  never
>

/**
 * Defines a route with a lazy module effect.
 *
 * @since 0.1.0
 * @category constructors
 */
export function make<
  const Id extends string,
  const Path extends `/${string}`,
  const ParamsFields extends UrlFields,
  const SearchFields extends UrlFields,
  HashSchema extends Schema.ConstraintCodec<unknown, string, never, never> = Schema.String,
  Module = void,
  LoadError = never,
  LoadServices = never
>(options: LazyOptions<Id, Path, ParamsFields, SearchFields, HashSchema, Module, LoadError, LoadServices>): Route<
  Id,
  Path,
  ParamsFields,
  SearchFields,
  HashSchema,
  Module,
  LoadError,
  LoadServices
>

export function make(options: {
  readonly id: string
  readonly path: string
  readonly params: UrlFields
  readonly search: UrlFields
  readonly hash?: Schema.ConstraintCodec<unknown, string, never, never> | undefined
  readonly load?: (() => Effect.Effect<unknown, unknown, unknown>) | undefined
}): Route<
  string,
  string,
  UrlFields,
  UrlFields,
  Schema.ConstraintCodec<unknown, string, never, never>,
  unknown,
  unknown,
  unknown
> {
  return {
    id: options.id,
    path: options.path,
    paramsSchema: Schema.Struct(options.params),
    searchSchema: Schema.Struct(options.search),
    hashSchema: options.hash ?? Schema.String,
    load: options.load
  }
}

const decodeUriPart = (
  routeId: string,
  part: UrlPart,
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
  part: UrlPart,
  input: string
): Result.Result<string, RouteEncodeError> => {
  try {
    return Result.succeed(encodeURIComponent(input))
  } catch {
    return Result.fail(new RouteEncodeError({ routeId, part, message: "Value contains invalid Unicode" }))
  }
}

const rawSearch = (search: string): Readonly<Record<string, unknown>> => {
  const values = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  return UrlParams.toRecord(UrlParams.fromInput(values))
}

/**
 * Matches and decodes one route. A different path is `None`; malformed values
 * on a structurally matching path are a typed failure.
 *
 * @since 0.1.0
 * @category matching
 */
export const match = <
  Id extends string,
  Path extends string,
  ParamsFields extends UrlFields,
  SearchFields extends UrlFields,
  HashSchema extends Schema.ConstraintCodec<unknown, string, never, never>,
  Module,
  LoadError,
  LoadServices
>(
  route: Route<Id, Path, ParamsFields, SearchFields, HashSchema, Module, LoadError, LoadServices>,
  url: UrlParts
): Result.Result<
  Option.Option<Match<Route<Id, Path, ParamsFields, SearchFields, HashSchema, Module, LoadError, LoadServices>>>,
  RouteDecodeError
> => {
  const expected = pathSegments(route.path)
  const actual = pathSegments(url.pathname)
  if (expected.length !== actual.length) {
    return Result.succeed(Option.none())
  }

  const encodedParams: Record<string, string> = {}
  for (let index = 0; index < expected.length; index++) {
    const expectedSegment = expected[index]
    const actualSegment = actual[index]
    const decoded = decodeUriPart(route.id, "path", actualSegment)
    if (Result.isFailure(decoded)) {
      return Result.fail(decoded.failure)
    }
    if (expectedSegment.startsWith(":")) {
      encodedParams[expectedSegment.slice(1)] = decoded.success
    } else if (expectedSegment !== decoded.success) {
      return Result.succeed(Option.none())
    }
  }

  const params = Schema.decodeUnknownResult(route.paramsSchema)(encodedParams)
  if (Result.isFailure(params)) {
    return Result.fail(
      new RouteDecodeError({
        routeId: route.id,
        part: "path",
        input: url.pathname,
        message: describeSchemaError(params.failure)
      })
    )
  }

  const search = Schema.decodeUnknownResult(route.searchSchema)(rawSearch(url.search))
  if (Result.isFailure(search)) {
    return Result.fail(
      new RouteDecodeError({
        routeId: route.id,
        part: "search",
        input: url.search,
        message: describeSchemaError(search.failure)
      })
    )
  }

  const encodedHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  const decodedHash = decodeUriPart(route.id, "hash", encodedHash)
  if (Result.isFailure(decodedHash)) {
    return Result.fail(decodedHash.failure)
  }
  const hash = Schema.decodeUnknownResult(route.hashSchema)(decodedHash.success)
  if (Result.isFailure(hash)) {
    return Result.fail(
      new RouteDecodeError({
        routeId: route.id,
        part: "hash",
        input: url.hash,
        message: describeSchemaError(hash.failure)
      })
    )
  }

  return Result.succeed(Option.some({
    id: route.id,
    route,
    params: params.success,
    search: search.success,
    hash: hash.success
  }))
}

const encodeSearch = (
  routeId: string,
  value: unknown
): Result.Result<string, RouteEncodeError> => {
  if (!Predicate.isObject(value)) {
    return Result.fail(
      new RouteEncodeError({
        routeId,
        part: "search",
        message: "The encoded search value must be an object"
      })
    )
  }
  const params: Array<readonly [string, string]> = []
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (item === undefined) {
      continue
    }
    if (typeof item === "string") {
      params.push([key, item])
      continue
    }
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      for (const entry of item) {
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
 * Encodes a typed route input into a canonical href.
 *
 * @since 0.1.0
 * @category encoding
 */
export const href = <R extends Any>(
  route: R,
  input: Route.Input<R>
): Result.Result<string, RouteEncodeError> => {
  const params = Schema.encodeResult(route.paramsSchema)(input.params)
  if (Result.isFailure(params)) {
    return Result.fail(
      new RouteEncodeError({
        routeId: route.id,
        part: "path",
        message: describeSchemaError(params.failure)
      })
    )
  }

  let pathname = route.path
  if (!Predicate.isObject(params.success)) {
    return Result.fail(
      new RouteEncodeError({
        routeId: route.id,
        part: "path",
        message: "The encoded path parameters must be an object"
      })
    )
  }
  for (const [key, value] of Object.entries(params.success)) {
    if (typeof value !== "string") {
      return Result.fail(
        new RouteEncodeError({
          routeId: route.id,
          part: "path",
          message: `Path parameter ${key} must encode to a string`
        })
      )
    }
    const encoded = encodeUriPart(route.id, "path", value)
    if (Result.isFailure(encoded)) {
      return encoded
    }
    pathname = pathname.replace(`:${key}`, encoded.success)
  }

  const searchValue = Schema.encodeResult(route.searchSchema)(input.search)
  if (Result.isFailure(searchValue)) {
    return Result.fail(
      new RouteEncodeError({
        routeId: route.id,
        part: "search",
        message: describeSchemaError(searchValue.failure)
      })
    )
  }
  const search = encodeSearch(route.id, searchValue.success)
  if (Result.isFailure(search)) {
    return search
  }

  const hashValue = Schema.encodeResult(route.hashSchema)(input.hash)
  if (Result.isFailure(hashValue)) {
    return Result.fail(
      new RouteEncodeError({
        routeId: route.id,
        part: "hash",
        message: describeSchemaError(hashValue.failure)
      })
    )
  }
  const encodedHash = encodeUriPart(route.id, "hash", hashValue.success)
  if (Result.isFailure(encodedHash)) {
    return encodedHash
  }
  const hash = encodedHash.success.length === 0 ? "" : `#${encodedHash.success}`
  return Result.succeed(`${pathname}${search.success}${hash}`)
}

/**
 * Returns the named path parameters in declaration order.
 *
 * @since 0.1.0
 * @category utilities
 */
export const pathParameterNames = (path: string): ReadonlyArray<string> =>
  pathSegments(path).filter((segment) => segment.startsWith(":")).map((segment) => segment.slice(1))
