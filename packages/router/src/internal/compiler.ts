/**
 * Route compilation: validation, precedence, and branch planning over
 * canonical runtime nodes. Internal module.
 *
 * Assembly passes the trusted nodes of a selection directly; there is no
 * contract lookup or id rebinding here.
 *
 * @since 0.4.0
 */
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type { RuntimeNode } from "./definition.ts"
import { RouteDecodeError, RouteDefinitionError } from "./errors.ts"
import type { DecodedMatch } from "./url.ts"
import { match, pathSegments } from "./url.ts"

/**
 * A decoded navigation input including the observed location.
 *
 * @since 0.4.0
 * @category models
 */
export interface DecodedInput {
  readonly params: unknown
  readonly search: unknown
  readonly hash: unknown
  readonly location: {
    readonly pathname: string
    readonly search: string
    readonly hash: string
    readonly state: unknown
    readonly key: string
    readonly index: number
  }
}

/**
 * One node planned into a branch, with its decoded input or decode failure.
 *
 * @since 0.4.0
 * @category models
 */
export interface PlannedEntry {
  readonly node: RuntimeNode
  readonly input: Result.Result<DecodedInput, RouteDecodeError>
}

/**
 * A planned branch, ancestors first.
 *
 * @since 0.4.0
 * @category models
 */
export interface Plan {
  readonly entries: ReadonlyArray<PlannedEntry>
  readonly notFound: boolean
}

/**
 * A validated selection ready for repeated matching.
 *
 * @since 0.4.0
 * @category models
 */
export interface Compiled {
  readonly nodes: ReadonlyArray<RuntimeNode>
  readonly byId: ReadonlyMap<string, RuntimeNode>
  readonly plan: (location: DecodedInput["location"]) => Plan
}

interface Ranked {
  readonly node: RuntimeNode
  readonly segments: ReadonlyArray<string>
  readonly depth: number
  readonly layout: boolean
}

const validate = (nodes: ReadonlyArray<RuntimeNode>): void => {
  const templates = new Map<string, RuntimeNode>()
  for (const node of nodes) {
    if (node.kind === "layout") continue
    const template = node.path.replace(/:[^/]+/g, ":")
    const other = templates.get(template)
    if (other !== undefined && other !== node) {
      throw new RouteDefinitionError({
        message: `Ambiguous route template: ${node.path} (${other.id} and ${node.id})`
      })
    }
    templates.set(template, node)
  }
}

const structural = (expected: ReadonlyArray<string>, actual: ReadonlyArray<string>): boolean => {
  if (actual.length !== expected.length) return false
  return expected.every((part, index) => {
    if (part.startsWith(":")) return true
    const candidate = actual[index]
    if (candidate === undefined) return false
    try {
      return decodeURIComponent(candidate) === part
    } catch {
      return false
    }
  })
}

const decodePrefix = (
  node: RuntimeNode,
  location: DecodedInput["location"]
): Result.Result<DecodedInput, RouteDecodeError> => {
  const prefix = pathSegments(node.path)
  const actual = pathSegments(location.pathname).slice(0, prefix.length)
  const pathname = actual.length === 0 ? "/" : `/${actual.join("/")}`
  const matched = match(node, { pathname, search: location.search, hash: location.hash })
  if (Result.isFailure(matched)) return Result.fail(matched.failure)
  if (Option.isNone(matched.success)) {
    return Result.fail(
      new RouteDecodeError({
        routeId: node.id,
        part: "path",
        input: location.pathname,
        message: "Invalid route prefix"
      })
    )
  }
  const decoded: DecodedMatch = matched.success.value
  return Result.succeed({ params: decoded.params, search: decoded.search, hash: decoded.hash, location })
}

/**
 * Validates and indexes a selection's canonical nodes.
 *
 * @since 0.4.0
 * @category constructors
 */
export const compile = (nodes: ReadonlyArray<RuntimeNode>): Compiled => {
  validate(nodes)
  const byId = new Map<string, RuntimeNode>()
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node)
  const ranked: Array<Ranked> = nodes.map((node) => ({
    node,
    segments: pathSegments(node.path),
    depth: node.id.split(".").length,
    layout: node.kind === "layout"
  }))
  ranked.sort((a, b) => {
    for (const [i, leftSegment] of a.segments.entries()) {
      const rightSegment = b.segments[i]
      if (rightSegment === undefined) break
      const difference = Number(leftSegment.startsWith(":")) - Number(rightSegment.startsWith(":"))
      if (difference !== 0) return difference
    }
    return b.segments.length - a.segments.length || b.depth - a.depth
  })
  const plan = (location: DecodedInput["location"]): Plan => {
    const actual = pathSegments(location.pathname)
    const leaf = ranked.find((entry) => !entry.layout && structural(entry.segments, actual))
    const chain: Array<Ranked> = []
    let current = leaf
    while (current !== undefined) {
      chain.unshift(current)
      current =
        current.node.parentId === undefined
          ? undefined
          : ranked.find((entry) => entry.node.id === current?.node.parentId)
    }
    return {
      notFound: leaf === undefined,
      entries: chain.map((entry) => ({
        node: entry.node,
        input: decodePrefix(entry.node, location)
      }))
    }
  }
  return { nodes, byId, plan }
}
