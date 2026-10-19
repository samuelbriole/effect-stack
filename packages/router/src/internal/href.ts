/** Canonical destination membership and encoding. Internal module. @since 0.4.0 */
import * as Result from "effect/Result"
import type { Destination, RuntimeNode } from "./definition.ts"
import { RouteEncodeError } from "./errors.ts"
import { encode } from "./url.ts"

/** Membership requires the exact selected node, not merely its id. @since 0.4.0 */
export const ownsNode = (byId: ReadonlyMap<string, RuntimeNode>, node: { readonly id: string }): boolean =>
  byId.get(node.id) === node

/** Shared failure for foreign destinations, including redirects. @since 0.4.0 */
export const foreignDestinationError = (node: { readonly id: string }): RouteEncodeError =>
  new RouteEncodeError({
    routeId: node.id,
    part: "path",
    message: "Destination does not belong to this router selection"
  })

/** Encode decoded input, checking membership first when a selection is supplied. @since 0.4.0 */
export const encodeDestination = (
  destination: Destination,
  byId?: ReadonlyMap<string, RuntimeNode>
): Result.Result<string, RouteEncodeError> => {
  if (byId !== undefined && !ownsNode(byId, destination.node)) {
    return Result.fail(foreignDestinationError(destination.node))
  }
  return encode(
    destination.node,
    destination.input as { readonly params: unknown; readonly search: unknown; readonly hash: unknown }
  )
}
