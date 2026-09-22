/**
 * Standalone, immutable route declarations. Bind them into a collection with
 * `Router.make(...).add(...)`.
 *
 * @since 0.4.0
 */
import {
  makeRouteDeclaration,
  type ContractOptionsGuard,
  type Fields,
  type OptionsError,
  type OptionsHash,
  type OptionsParams,
  type OptionsSearch,
  type OptionsSuccess,
  type RouteDeclaration,
  type RouteOptions
} from "./internal/contract.ts"

/**
 * The schema sections accepted by `Route.make`.
 *
 * @since 0.4.0
 * @category models
 */
export type Options = RouteOptions

export type { Fields }

/**
 * Declares a reusable, non-callable route.
 *
 * @since 0.4.0
 * @category constructors
 */
export function make<const Id extends string, const Path extends `/${string}`>(
  identifier: Id,
  path: Path
): RouteDeclaration<Id, Path, {}, {}, undefined, undefined, undefined>
export function make<
  const Id extends string,
  const Path extends `/${string}`,
  const Opts extends RouteOptions | undefined
>(
  identifier: Id,
  path: Path,
  options: Opts & ContractOptionsGuard<Opts>
): RouteDeclaration<
  Id,
  Path,
  OptionsParams<Opts>,
  OptionsSearch<Opts>,
  OptionsHash<Opts>,
  OptionsSuccess<Opts>,
  OptionsError<Opts>
>
export function make<
  const Id extends string,
  const Path extends `/${string}`,
  const Opts extends RouteOptions | undefined = undefined
>(
  identifier: Id,
  path: Path,
  options?: Opts & ContractOptionsGuard<Opts>
): RouteDeclaration<
  Id,
  Path,
  OptionsParams<Opts>,
  OptionsSearch<Opts>,
  OptionsHash<Opts>,
  OptionsSuccess<Opts>,
  OptionsError<Opts>
> {
  return makeRouteDeclaration(identifier, path, options) as unknown as RouteDeclaration<
    Id,
    Path,
    OptionsParams<Opts>,
    OptionsSearch<Opts>,
    OptionsHash<Opts>,
    OptionsSuccess<Opts>,
    OptionsError<Opts>
  >
}
