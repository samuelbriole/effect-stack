import type {
  AnyBoundGroup,
  AnyNode,
  ChildKeys,
  ChildrenOf,
  CollectionIdOf,
  Destination,
  RuntimeGroupNode,
  RuntimeNode
} from "@effect-stack/router/Router"
import type * as React from "react"

/** Props passed to route error boundaries. @since 0.4.0 */
export interface ErrorProps {
  readonly error: unknown
  readonly reset: () => void
}

/** The renderer-facing options for one route or group. @since 0.4.0 */
export interface ViewOptions {
  readonly component?: React.ComponentType
  readonly pending?: React.ComponentType
  readonly error?: React.ComponentType<ErrorProps>
}

/** A leaf view may be a component shorthand or explicit options. @since 0.4.0 */
export type LeafView = React.ComponentType | ViewOptions

/** A group view mirrors the contract grouping. @since 0.4.0 */
export type GroupView = ViewOptions & { readonly children: ViewsRecord }

/** @since 0.4.0 */
export interface ViewsRecord {
  readonly [key: string]: LeafView | GroupView
}

type ViewsOf<Defs> = {
  readonly [K in keyof Defs]: Defs[K] extends AnyBoundGroup
    ? ViewOptions & { readonly children: ViewsOf<ChildrenOf<Defs[K]>> }
    : LeafView
}

/**
 * A view record mirroring a contract's grouping.
 *
 * @since 0.4.0
 * @category models
 */
export type Views<C> = ViewsOf<ChildKeys<C>>

/** The destination accepted by `Link` and `Navigate`. @since 0.4.0 */
export type LinkDestination<C> = Destination<CollectionIdOf<C>>

const isComponent = (value: unknown): value is React.ComponentType =>
  typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value)

const pickOptions = (entry: unknown): ViewOptions => {
  if (entry === undefined || entry === null) return {}
  if (isComponent(entry)) return { component: entry }
  const options = entry as ViewOptions
  return {
    ...(options.component === undefined ? {} : { component: options.component }),
    ...(options.pending === undefined ? {} : { pending: options.pending }),
    ...(options.error === undefined ? {} : { error: options.error })
  }
}

/**
 * Flattens a nested view record into a map keyed by qualified node id.
 *
 * @since 0.4.0
 * @category utilities
 */
export const flattenViews = (
  nodes: Record<string, RuntimeNode>,
  views: unknown,
  output: Map<string, ViewOptions> = new Map()
): Map<string, ViewOptions> => {
  const record = (views ?? {}) as Record<string, unknown>
  for (const key of Object.keys(nodes)) {
    const node = nodes[key]
    if (node === undefined) continue
    const entry = record[key]
    if (node._tag === "GroupDescriptor") {
      output.set(node.id, pickOptions(entry))
      const childViews = (entry as { readonly children?: unknown } | undefined)?.children
      flattenViews((node as RuntimeGroupNode).children, childViews, output)
    } else {
      output.set(node.id, pickOptions(entry))
    }
  }
  return output
}

/** @since 0.4.0 */
export type { AnyNode }
