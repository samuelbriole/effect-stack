/**
 * Standalone, immutable route group declarations. Groups carry their own
 * schema sections, an ordered set of child declarations, and a persistent
 * mount prefix that is applied once when the group is bound.
 *
 * @since 0.4.0
 */
import {
  makeGroupDeclaration,
  type ContractOptionsGuard,
  type Fields,
  type OptionsError,
  type OptionsHash,
  type OptionsParams,
  type OptionsSearch,
  type OptionsSuccess,
  type RouteGroupDeclaration,
  type RouteOptions
} from "./internal/contract.ts"

/**
 * The schema sections accepted by `RouteGroup.make`.
 *
 * @since 0.4.0
 * @category models
 */
export type Options = RouteOptions

export type { Fields }

/**
 * Declares a reusable, non-callable group. Groups are pathless until a
 * `.prefix(...)` is applied; `.prefix` prepends so the latest mount surrounds
 * the earlier ones.
 *
 * @since 0.4.0
 * @category constructors
 */
export function make<const Id extends string>(
  identifier: Id
): RouteGroupDeclaration<Id, "", {}, {}, undefined, undefined, undefined, {}>
export function make<const Id extends string, const Opts extends RouteOptions | undefined>(
  identifier: Id,
  options: Opts & ContractOptionsGuard<Opts>
): RouteGroupDeclaration<
  Id,
  "",
  OptionsParams<Opts>,
  OptionsSearch<Opts>,
  OptionsHash<Opts>,
  OptionsSuccess<Opts>,
  OptionsError<Opts>,
  {}
>
export function make<const Id extends string, const Opts extends RouteOptions | undefined = undefined>(
  identifier: Id,
  options?: Opts & ContractOptionsGuard<Opts>
): RouteGroupDeclaration<
  Id,
  "",
  OptionsParams<Opts>,
  OptionsSearch<Opts>,
  OptionsHash<Opts>,
  OptionsSuccess<Opts>,
  OptionsError<Opts>,
  {}
> {
  return makeGroupDeclaration(identifier, options) as unknown as RouteGroupDeclaration<
    Id,
    "",
    OptionsParams<Opts>,
    OptionsSearch<Opts>,
    OptionsHash<Opts>,
    OptionsSuccess<Opts>,
    OptionsError<Opts>,
    {}
  >
}
