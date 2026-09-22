import type {
  AnyGroupDescriptor,
  AnyNode,
  CollectionIdOf,
  Destination,
  RuntimeGroupNode,
  RuntimeNode
} from "@effect-stack/router/Router"
import type { Component } from "vue"

/** @since 0.4.0 */
export interface ErrorProps {
  readonly error: unknown
  readonly reset: () => void
}

/** @since 0.4.0 */
export interface ViewOptions {
  readonly component?: Component
  readonly pending?: Component
  readonly error?: Component
}

/** @since 0.4.0 */
export type LeafView = Component | ViewOptions
/** @since 0.4.0 */
export type GroupView = ViewOptions & { readonly children: ViewsRecord }
/** @since 0.4.0 */
export interface ViewsRecord {
  readonly [key: string]: LeafView | GroupView
}

type GroupChildrenOf<G> = G extends { readonly "~node": infer I }
  ? I extends { readonly children: infer Children }
    ? Children
    : never
  : never

type RouteKeys<C> = { [K in keyof C as K extends "service" ? never : K]: C[K] }

type ViewsOf<Defs> = {
  readonly [K in keyof Defs]: Defs[K] extends AnyGroupDescriptor
    ? ViewOptions & { readonly children: ViewsOf<GroupChildrenOf<Defs[K]>> }
    : LeafView
}

/** @since 0.4.0 */
export type Views<C> = ViewsOf<RouteKeys<C>>

/** @since 0.4.0 */
export type LinkDestination<C> = Destination<CollectionIdOf<C>>

const isComponent = (value: unknown): value is Component =>
  typeof value === "function"
  || (typeof value === "object" && value !== null && ("render" in value || "setup" in value || "template" in value))

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

/** @since 0.4.0 */
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
