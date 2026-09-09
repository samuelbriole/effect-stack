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
import type * as History from "./History.ts"

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
 * Decoded URL values supplied to a navigation-scoped data loader.
 *
 * @since 0.2.0
 * @category models
 */
export interface LoaderInput<Params, Search, Hash> extends RouteInput<Params, Search, Hash> {
  readonly location: History.Location
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
  LoadServices,
  Data = void,
  LoaderError = never,
  LoaderServices = never
> {
  readonly id: Id
  readonly path: Path
  readonly paramsSchema: Schema.Struct<ParamsFields>
  readonly searchSchema: Schema.Struct<SearchFields>
  readonly hashSchema: HashSchema
  /** The lazy code loader supplied at construction, if any. */
  readonly lazy: undefined | (() => Effect.Effect<Module, LoadError, Scope.Scope | LoadServices>)
  readonly loader?: (
    input: LoaderInput<Schema.Struct<ParamsFields>["Type"], Schema.Struct<SearchFields>["Type"], HashSchema["Type"]>
  ) => Effect.Effect<Data, LoaderError, Scope.Scope | LoaderServices>
}

/**
 * Any route definition. Use the `Route.*` type helpers to retain a concrete
 * route's inferred values.
 *
 * @since 0.1.0
 * @category models
 */
export type Any =
  & Omit<
    Route<
      string,
      string,
      UrlFields,
      UrlFields,
      Schema.ConstraintCodec<unknown, string, never, never>,
      unknown,
      unknown,
      unknown
    >,
    "loader"
  >
  & {
    readonly loader?: (input: never) => Effect.Effect<unknown, unknown, unknown>
  }

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
  export type Module<R extends Any> = Effect.Success<ReturnType<NonNullable<R["lazy"]>>>
  /** @since 0.1.0 */
  export type LoadError<R extends Any> = Effect.Error<ReturnType<NonNullable<R["lazy"]>>>
  /** @since 0.1.0 */
  export type LoadServices<R extends Any> = Exclude<
    Effect.Services<ReturnType<NonNullable<R["lazy"]>>>,
    Scope.Scope
  >
  /** @since 0.1.0 */
  export type Input<R extends Any> = RouteInput<Params<R>, Search<R>, Hash<R>>
  /** @since 0.2.0 */
  export type LoaderData<R extends Any> = Effect.Success<ReturnType<NonNullable<R["loader"]>>>
  /** @since 0.2.0 */
  export type LoaderError<R extends Any> = Effect.Error<ReturnType<NonNullable<R["loader"]>>>
  /** @since 0.2.0 */
  export type LoaderServices<R extends Any> = Exclude<
    Effect.Services<ReturnType<NonNullable<R["loader"]>>>,
    Scope.Scope
  >
  /** @since 0.2.0 */
  export type Services<R extends Any> = LoadServices<R> | LoaderServices<R>
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
export class RouteDecodeError extends Schema.TaggedError<RouteDecodeError>()("@effect-stack/router/RouteDecodeError", {
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
export class RouteEncodeError extends Schema.TaggedError<RouteEncodeError>()("@effect-stack/router/RouteEncodeError", {
  routeId: Schema.String,
  part: UrlPart,
  message: Schema.String
}) {}

/**
 * A route definition is invalid at construction time.
 *
 * @since 0.1.0
 * @category errors
 */
export class RouteDefinitionError extends Schema.TaggedError<RouteDefinitionError>()(
  "@effect-stack/router/RouteDefinitionError",
  {
    routeId: Schema.String,
    message: Schema.String
  }
) {}

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

const pathSegments = (path: string): ReadonlyArray<string> => path === "/" ? [] : path.slice(1).split("/")

const describeSchemaError = (error: Schema.SchemaError): string => error.message

/**
 * Defines a route with optional lazy code and navigation-scoped data loading.
 *
 * `lazy` imports route code; `loader` prepares route data.
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
  LoadServices = never,
  Data = void,
  LoaderError = never,
  LoaderServices = never
>(
  options: BaseOptions<Id, Path, ParamsFields, SearchFields, HashSchema> & {
    /** Imports this route's code. @since 0.3.0 */
    readonly lazy?: () => Effect.Effect<Module, LoadError, Scope.Scope | LoadServices>
    readonly loader?: (
      input: LoaderInput<Schema.Struct<ParamsFields>["Type"], Schema.Struct<SearchFields>["Type"], HashSchema["Type"]>
    ) => Effect.Effect<Data, LoaderError, Scope.Scope | LoaderServices>
  }
): Route<
  Id,
  Path,
  ParamsFields,
  SearchFields,
  HashSchema,
  Module,
  LoadError,
  LoadServices,
  Data,
  LoaderError,
  LoaderServices
>

export function make(options: {
  readonly id: string
  readonly path: string
  readonly params: UrlFields
  readonly search: UrlFields
  readonly hash?: Schema.ConstraintCodec<unknown, string, never, never> | undefined
  readonly lazy?: (() => Effect.Effect<unknown, unknown, unknown>) | undefined
  readonly loader?: (input: never) => Effect.Effect<unknown, unknown, unknown>
}): Any {
  if (!options.path.startsWith("/")) {
    throw new RouteDefinitionError({
      routeId: options.id,
      message: "Path must start with /"
    })
  }
  const expectedParameters = [...pathParameterNames(options.path)].sort()
  const actualParameters = Object.keys(options.params).sort()
  if (
    expectedParameters.length !== actualParameters.length ||
    expectedParameters.some((parameter, index) => parameter !== actualParameters[index])
  ) {
    throw new RouteDefinitionError({
      routeId: options.id,
      message: `Path parameters (${expectedParameters.join(", ")}) do not match Schema fields (${
        actualParameters.join(", ")
      })`
    })
  }
  if (pathSegments(options.path).some((segment) => segment === "." || segment === "..")) {
    throw new RouteDefinitionError({
      routeId: options.id,
      message: "Static . and .. path segments are not supported"
    })
  }
  return {
    id: options.id,
    path: options.path,
    paramsSchema: Schema.Struct(options.params),
    searchSchema: Schema.Struct(options.search),
    hashSchema: options.hash ?? Schema.String,
    lazy: options.lazy,
    ...(options.loader === undefined ? {} : { loader: options.loader })
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

const normalizeSearch = (
  fields: UrlFields,
  input: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> => {
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(fields)) {
    const value = input[key]
    if (value === undefined) {
      continue
    }
    if (typeof value === "string" && Result.isFailure(Schema.decodeUnknownResult(fields[key])(value))) {
      output[key] = [value]
    } else {
      output[key] = value
    }
  }
  return output
}

/**
 * Matches and decodes one route. A different path is `None`; malformed values
 * on a structurally matching path are a typed failure.
 *
 * @since 0.1.0
 * @category matching
 */
export const match = <R extends Any>(
  route: R,
  url: UrlParts
): Result.Result<
  Option.Option<Match<R>>,
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

  const search = Schema.decodeUnknownResult(route.searchSchema)(
    normalizeSearch(route.searchSchema.fields, rawSearch(url.search))
  )
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
  fields: UrlFields,
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
    if (Result.isFailure(encodeUriPart(routeId, "search", key))) {
      return Result.fail(
        new RouteEncodeError({
          routeId,
          part: "search",
          message: "Search field name contains invalid Unicode"
        })
      )
    }
    const item = value[key]
    if (item === undefined) {
      continue
    }
    if (typeof item === "string") {
      if (Result.isFailure(encodeUriPart(routeId, "search", item))) {
        return Result.fail(
          new RouteEncodeError({
            routeId,
            part: "search",
            message: `Search field ${key} contains invalid Unicode`
          })
        )
      }
      params.push([key, item])
      continue
    }
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      if (item.length === 0) {
        return Result.fail(
          new RouteEncodeError({
            routeId,
            part: "search",
            message: `Search field ${key} cannot encode an empty array`
          })
        )
      }
      if (item.length === 1 && Result.isSuccess(Schema.decodeUnknownResult(fields[key])(item[0]))) {
        return Result.fail(
          new RouteEncodeError({
            routeId,
            part: "search",
            message: `Search field ${key} cannot distinguish a singleton array from a scalar value`
          })
        )
      }
      for (const entry of item) {
        if (Result.isFailure(encodeUriPart(routeId, "search", entry))) {
          return Result.fail(
            new RouteEncodeError({
              routeId,
              part: "search",
              message: `Search field ${key} contains invalid Unicode`
            })
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

  if (!Predicate.isObject(params.success)) {
    return Result.fail(
      new RouteEncodeError({
        routeId: route.id,
        part: "path",
        message: "The encoded path parameters must be an object"
      })
    )
  }
  const pathnameSegments: Array<string> = []
  for (const segment of pathSegments(route.path)) {
    const key = segment.startsWith(":") ? segment.slice(1) : undefined
    const value = key === undefined ? segment : params.success[key]
    if (typeof value !== "string") {
      return Result.fail(
        new RouteEncodeError({
          routeId: route.id,
          part: "path",
          message: `Path parameter ${key ?? segment} must encode to a string`
        })
      )
    }
    if (key !== undefined && (value === "." || value === "..")) {
      return Result.fail(
        new RouteEncodeError({
          routeId: route.id,
          part: "path",
          message: `Path parameter ${key} cannot be a dot segment`
        })
      )
    }
    const encoded = encodeUriPart(route.id, "path", value)
    if (Result.isFailure(encoded)) {
      return encoded
    }
    pathnameSegments.push(encoded.success)
  }
  const pathname = pathnameSegments.length === 0 ? "/" : `/${pathnameSegments.join("/")}`

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
  const search = encodeSearch(route.id, route.searchSchema.fields, searchValue.success)
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
