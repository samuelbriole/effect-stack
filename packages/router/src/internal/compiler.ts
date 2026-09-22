/**
 * Contract compilation: validation, precedence, and branch planning over
 * runtime nodes. Internal module.
 *
 * @since 0.4.0
 */
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { collectNodes } from "./contract.ts"
import type { RuntimeGroupNode, RuntimeNode } from "./contract.ts"
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
 * A validated contract ready for repeated matching.
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

const structural = (expected: ReadonlyArray<string>, actual: ReadonlyArray<string>, exact: boolean): boolean => {
  if (exact ? actual.length !== expected.length : actual.length < expected.length) return false
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
 * Validates and indexes a contract's runtime nodes.
 *
 * @since 0.4.0
 * @category constructors
 */
export const compile = (routes: Record<string, RuntimeNode>): Compiled => {
  const nodes = collectNodes(routes)
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
    const find = (accept: (entry: Ranked) => boolean, exact: boolean): Ranked | undefined => {
      for (const entry of ranked) {
        if (accept(entry) && structural(entry.segments, actual, exact)) return entry
      }
      return undefined
    }
    const exact = find((entry) => !entry.layout, true)
    const leaf = exact ?? find((entry) => entry.node.kind !== "index", false)
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
      notFound: exact === undefined,
      entries: chain.map((entry) => ({
        node: entry.node,
        input: decodePrefix(entry.node, location)
      }))
    }
  }
  return { nodes, byId, plan }
}

/** @since 0.4.0 */
export const isGroup = (node: RuntimeNode): node is RuntimeGroupNode => node._tag === "GroupDescriptor"
