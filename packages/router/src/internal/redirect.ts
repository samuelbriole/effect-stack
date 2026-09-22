/**
 * Typed redirect control signals. Internal module.
 *
 * @since 0.4.0
 */
import * as Schema from "effect/Schema"
import type { Destination } from "./contract.ts"

/** @since 0.4.0 */
export const RedirectTypeId: unique symbol = Symbol.for("@effect-stack/router/Redirect")

/** The runtime tag consumed by the navigation coordinator. @since 0.4.0 */
export const RedirectTag = "@effect-stack/router/Redirect" as const

/**
 * A handler's request to navigate to another destination within the same
 * attempt.
 *
 * @since 0.4.0
 * @category errors
 */
export class RedirectSignal extends Schema.TaggedError<RedirectSignal>()(RedirectTag, {
  destination: Schema.Unknown
}) {}

/**
 * The typed redirect control failure for one collection.
 *
 * @since 0.4.0
 * @category errors
 */
export type Redirect<CollectionId extends string = string> = RedirectSignal & {
  readonly [RedirectTypeId]?: CollectionId
}

/** @since 0.4.0 */
export const redirect = <CollectionId extends string>(destination: Destination<CollectionId>): Redirect<CollectionId> =>
  new RedirectSignal({ destination }) as Redirect<CollectionId>

/** @since 0.4.0 */
export const isRedirect = (value: unknown): value is Redirect =>
  typeof value === "object" && value !== null && (value as { readonly _tag?: unknown })._tag === RedirectTag
