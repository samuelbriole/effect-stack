/**
 * Typed redirect control signals. Internal module.
 *
 * @since 0.4.0
 */
import * as Schema from "effect/Schema"
import type { Destination } from "./definition.ts"

/** @since 0.4.0 */
export const RedirectTypeId: unique symbol = Symbol.for("@effect-stack/router/Redirect")

/** The runtime tag consumed by the navigation coordinator. @since 0.4.0 */
export const RedirectTag = "@effect-stack/router/Redirect" as const

/**
 * A gate's request to navigate to another destination within the same
 * attempt.
 *
 * @since 0.4.0
 * @category errors
 */
export class RedirectSignal extends Schema.TaggedError<RedirectSignal>()(RedirectTag, {
  destination: Schema.Unknown
}) {}

/**
 * The typed redirect control failure for one destination brand.
 *
 * @since 0.4.0
 * @category errors
 */
export type Redirect<Brand = unknown> = RedirectSignal & {
  readonly [RedirectTypeId]?: Brand
}

/** @since 0.4.0 */
export const redirect = <Brand>(destination: Destination<Brand>): Redirect<Brand> =>
  new RedirectSignal({ destination }) as Redirect<Brand>

/** @since 0.4.0 */
export const isRedirect = (value: unknown): value is Redirect =>
  typeof value === "object" && value !== null && (value as { readonly _tag?: unknown })._tag === RedirectTag
