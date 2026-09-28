/**
 * Canonical synchronous destination resolution. Internal module.
 *
 * Navigation helpers resolve an absolute endpoint path template against the
 * nearest active provider's canonical node index. There is no separate runtime
 * identity token: an unbound helper cannot verify that the erased application
 * type it was created from matches the provider, so it resolves against
 * whatever provider is active. Application-bound helpers keep their exact
 * provider-token check.
 *
 * @since 0.4.0
 */
import * as Result from "effect/Result"
import { applicationRuntime } from "./application.ts"
import type { AnyNode, Destination } from "./definition.ts"
import { makeDestination } from "./definition.ts"
import { RouteEncodeError } from "./errors.ts"

/**
 * Resolves an absolute endpoint path template to the canonical selected
 * endpoint and builds its identity destination. Synchronous; reads only the
 * assembled application's node index, never its service, so hrefs are available
 * before service acquisition and when startup fails.
 *
 * @since 0.4.0
 * @category navigation
 */
export const resolvePathDestination = (
  app: unknown,
  path: string,
  input: unknown
): Result.Result<Destination, RouteEncodeError> => {
  const runtime = applicationRuntime(app)
  const node: AnyNode | undefined = runtime?.byPath.get(path)
  if (node === undefined) {
    return Result.fail(
      new RouteEncodeError({
        routeId: path,
        part: "path",
        message: `"${path}" is not a selected endpoint path`
      })
    )
  }
  return Result.succeed(makeDestination(node, input, undefined) as Destination)
}

/** Erased native target shape; public adapters retain correlated path inputs. */
type NavigationTargetInput =
  | Destination
  | string
  | {
      readonly to: Destination | string
      readonly params?: unknown
      readonly search?: unknown
      readonly hash?: unknown
    }

/**
 * Normalizes native targets without encoding or checking destination membership.
 * Identity destinations retain their exact reference and captured defaults;
 * sibling URL input on an identity-target record is ignored.
 *
 * @since 0.4.0
 * @category navigation
 */
export const resolveNavigationTarget = (
  app: unknown,
  target: NavigationTargetInput
): Result.Result<Destination, RouteEncodeError> => {
  if (typeof target === "string") return resolvePathDestination(app, target, {})
  if ("to" in target) {
    return typeof target.to === "string" ? resolvePathDestination(app, target.to, target) : Result.succeed(target.to)
  }
  return Result.succeed(target)
}
