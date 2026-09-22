/**
 * Typed failures shared by contract construction, URL codecs, matching, and
 * navigation. Internal module.
 *
 * @since 0.4.0
 */
import * as Schema from "effect/Schema"

/**
 * A route contract is invalid at construction time.
 *
 * @since 0.4.0
 * @category errors
 */
export class RouteDefinitionError extends Schema.TaggedError<RouteDefinitionError>()(
  "@effect-stack/router/RouteDefinitionError",
  {
    message: Schema.String
  }
) {}

/**
 * The URL portion that failed decoding or encoding.
 *
 * @since 0.4.0
 * @category models
 */
export const UrlPart = Schema.Literals(["path", "search", "hash"])

/** @since 0.4.0 */
export type UrlPart = typeof UrlPart.Type

/**
 * A structurally matching URL contained an invalid encoded value.
 *
 * @since 0.4.0
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
 * @since 0.4.0
 * @category errors
 */
export class RouteEncodeError extends Schema.TaggedError<RouteEncodeError>()("@effect-stack/router/RouteEncodeError", {
  routeId: Schema.String,
  part: UrlPart,
  message: Schema.String
}) {}

/**
 * No configured route matched a location.
 *
 * @since 0.4.0
 * @category errors
 */
export class RouteNotFound extends Schema.TaggedError<RouteNotFound>()("@effect-stack/router/RouteNotFound", {
  pathname: Schema.String,
  search: Schema.String,
  hash: Schema.String
}) {}
