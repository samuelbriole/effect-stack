/**
 * Code-based route trees with inherited URL schemas.
 * @since 0.2.0
 */
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Pipeable from "effect/Pipeable"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Route from "./Route.ts"

/** @since 0.2.0 */
export type Fields = Route.Any["searchSchema"]["fields"]
/** @since 0.2.0 */
export type HashCodec = Route.Any["hashSchema"]
/** @since 0.2.0 */
export type Kind = "root" | "route" | "index" | "layout"
/** @since 0.2.0 */
export type Any = Route.Any & {
  readonly parentId: string | undefined
  readonly kind: Kind
  readonly children: ReadonlyArray<Any>
  readonly to: string
}

/**
 * Stable identity of native `RouteTree` nodes. It is an enumerable own
 * property, so renderer adapter spreads that decorate nodes preserve it and
 * `isNode` keeps recognizing the result.
 * @since 0.2.0
 */
export const NodeId: unique symbol = Symbol.for("@effect-stack/router/RouteTree/Node")

/** @since 0.2.0 */
export type Node<
  R extends Route.Any,
  Children extends ReadonlyArray<Any> = readonly [],
  K extends Kind = Kind
> = R & {
  readonly parentId: string | undefined
  readonly kind: K
  readonly to: R["path"]
  readonly children: Children
  readonly addChildren: <const C extends ReadonlyArray<Any>>(children: C) => Node<R, C, K>
  readonly [NodeId]: true
} & Pipeable.Pipeable

/** @since 0.2.0 */
export type All<T extends Any> = [T] extends [never] ? never : T | (Any extends T ? never : All<T["children"][number]>)
/** @since 0.2.0 */
export type Join<Parent extends string, Path extends string> = Path extends "/" | "" ? Parent
  : Parent extends "/" ? `/${Path}`
  : `${Parent}/${Path}`

type ParametersOption<Path extends string, P extends Fields> = [Route.PathParameters<Path>] extends [never]
  ? { readonly params?: P & { readonly [K in keyof P]: never } }
  : {
    readonly params:
      & P
      & { readonly [K in Route.PathParameters<Path>]: Schema.ConstraintCodec<unknown, string, never, never> }
      & { readonly [K in Exclude<keyof P, Route.PathParameters<Path>>]: never }
  }

/** @since 0.2.0 */
export interface Loading<P extends Fields, S extends Fields, H extends HashCodec, M, ME, MR, D, E, R> {
  readonly load?: () => Effect.Effect<M, ME, Scope.Scope | MR>
  readonly loader?: (
    input: Route.LoaderInput<Schema.Struct<P>["Type"], Schema.Struct<S>["Type"], H["Type"]>
  ) => Effect.Effect<D, E, Scope.Scope | R>
}

/** @since 0.2.0 */
export type Options<
  Parent extends Any,
  Path extends string,
  P extends Fields,
  S extends Fields,
  H extends HashCodec,
  M,
  ME,
  MR,
  D,
  E,
  R
> =
  & { readonly getParentRoute: () => Parent; readonly search?: S; readonly hash?: H }
  & { readonly path: Path; readonly id?: never }
  & ParametersOption<Path, P>
  & Loading<Parent["paramsSchema"]["fields"] & P, Parent["searchSchema"]["fields"] & S, H, M, ME, MR, D, E, R>

/** @since 0.2.0 */
export type Child<
  Parent extends Any,
  Path extends string,
  P extends Fields,
  S extends Fields,
  H extends HashCodec,
  M,
  ME,
  MR,
  D,
  E,
  R
> = Route.Route<
  `${Parent["id"]}/${Path}`,
  Join<Parent["path"], Path>,
  Parent["paramsSchema"]["fields"] & P,
  Parent["searchSchema"]["fields"] & S,
  H,
  M,
  ME,
  MR,
  D,
  E,
  R
>

const node = <R extends Route.Any, const C extends ReadonlyArray<Any>, const K extends Kind>(
  route: R,
  parentId: string | undefined,
  kind: K,
  children: C
): Node<R, C, K> => ({
  ...route,
  parentId,
  kind,
  to: route.path,
  children,
  addChildren: (next) => node(route, parentId, kind, next),
  // `pipe` is an own property, so adapter decoration spreads carry the
  // `this`-bound composition from Pipeable.Prototype onto decorated nodes.
  pipe: Pipeable.Prototype.pipe,
  [NodeId]: true
})

/**
 * True when a value is a native node or an adapter decoration that spread one.
 * @since 0.2.0
 */
export const isNode = (value: unknown): value is Node<Route.Any> =>
  typeof value === "object" && value !== null && NodeId in value

/** Defines the root layout. @since 0.2.0 */
export function root<
  const S extends Fields = {},
  H extends HashCodec = Schema.String,
  M = void,
  ME = never,
  MR = never,
  D = void,
  E = never,
  R = never
>(
  options?: { readonly search?: S; readonly hash?: H } & Loading<{}, S, H, M, ME, MR, D, E, R>
): Node<Route.Route<"__root__", "/", {}, S, H, M, ME, MR, D, E, R>, readonly [], "root">
export function root(options: RuntimeOptions = {}): Any {
  return node(
    makeRoute("__root__", "/", {}, options.search ?? {}, options.hash ?? Schema.String, options),
    undefined,
    "root",
    []
  )
}

/** Defines a child. `/` is an index; an ID without a path is a pathless layout. @since 0.2.0 */
export function make<
  Parent extends Any,
  const Id extends string,
  const S extends Fields = {},
  H extends HashCodec = Parent["hashSchema"],
  M = void,
  ME = never,
  MR = never,
  D = void,
  E = never,
  R = never
>(
  options: {
    readonly getParentRoute: () => Parent
    readonly id: Id
    readonly path?: never
    readonly search?: S
    readonly hash?: H
  } & Loading<Parent["paramsSchema"]["fields"], Parent["searchSchema"]["fields"] & S, H, M, ME, MR, D, E, R>
): Node<
  Route.Route<
    `${Parent["id"]}/${Id}`,
    Parent["path"],
    Parent["paramsSchema"]["fields"],
    Parent["searchSchema"]["fields"] & S,
    H,
    M,
    ME,
    MR,
    D,
    E,
    R
  >,
  readonly [],
  "layout"
>
export function make<
  Parent extends Any,
  const Path extends string,
  const P extends Fields = {},
  const S extends Fields = {},
  H extends HashCodec = Parent["hashSchema"],
  M = void,
  ME = never,
  MR = never,
  D = void,
  E = never,
  R = never
>(
  options: Options<Parent, Path, P, S, H, M, ME, MR, D, E, R>
): Node<Child<Parent, Path, P, S, H, M, ME, MR, D, E, R>, readonly [], Path extends "/" ? "index" : "route">
export function make(
  options: RuntimeOptions & {
    readonly getParentRoute: () => Any
    readonly path?: string
    readonly id?: string
    readonly params?: Fields
  }
): Any {
  const parent = options.getParentRoute()
  const segment = options.path ?? options.id ?? ""
  const id = `${parent.id}/${segment}`
  if (
    segment === "" ||
    (options.path !== undefined && options.path !== "/" &&
      (segment.startsWith("/") || segment.endsWith("/") || segment.includes("//")))
  ) {
    throw new Route.RouteDefinitionError({
      routeId: id,
      message: "Use a relative child path, / for an index, or an ID for a pathless layout"
    })
  }
  if (options.id !== undefined && (options.path !== undefined || segment.includes("/") || segment.includes(":"))) {
    throw new Route.RouteDefinitionError({
      routeId: id,
      message: "A pathless layout ID must be a single static segment"
    })
  }
  for (
    const [inherited, own] of [[parent.paramsSchema.fields, options.params], [
      parent.searchSchema.fields,
      options.search
    ]] as const
  ) {
    for (const key of Object.keys(own ?? {})) {
      if (key in inherited) {
        throw new Route.RouteDefinitionError({
          routeId: id,
          message: `Inherited Schema field cannot be redefined: ${key}`
        })
      }
    }
  }
  const kind = options.path === undefined ? "layout" : options.path === "/" ? "index" : "route"
  const path = kind === "route" ? `${parent.path === "/" ? "" : parent.path}/${segment}` : parent.path
  return node(
    makeRoute(
      id,
      path,
      { ...parent.paramsSchema.fields, ...options.params },
      { ...parent.searchSchema.fields, ...options.search },
      options.hash ?? parent.hashSchema,
      options
    ),
    parent.id,
    kind,
    []
  )
}

interface RuntimeOptions {
  readonly search?: Fields
  readonly hash?: HashCodec
  readonly load?: () => Effect.Effect<unknown, unknown, unknown>
  readonly loader?: (input: never) => Effect.Effect<unknown, unknown, unknown>
}

const makeRoute = (
  id: string,
  path: string,
  params: Fields,
  search: Fields,
  hash: HashCodec,
  options: RuntimeOptions
): Route.Any => {
  // Route.make validates exact parameter fields at runtime for the composed path.
  const construct = Route.make as (
    options: {
      readonly id: string
      readonly path: `/${string}`
      readonly params: Fields
      readonly search: Fields
      readonly hash: HashCodec
      readonly load?: () => Effect.Effect<unknown, unknown, unknown>
    }
  ) => Route.Any
  const base = construct({
    id,
    path: path as `/${string}`,
    params,
    search,
    hash,
    ...(options.load === undefined ? {} : { load: options.load })
  })
  return { ...base, ...(options.loader === undefined ? {} : { loader: options.loader }) }
}

type OptionalInput<K extends string, A> = {} extends A ? { readonly [P in K]?: A } : { readonly [P in K]: A }
type IndexNode = { readonly kind: "index" }
type LayoutNode = { readonly kind: "layout" }

// Flattening rejects competing indexes, so an exact URL has at most one index
// reached through any intervening pathless layouts.
type SameUrlIndex<N extends Any> =
  | Extract<N["children"][number], IndexNode>
  | (Extract<N["children"][number], LayoutNode> extends infer L ? L extends Any ? SameUrlIndex<L> : never : never)
type RankedLeaf<N extends Any> = N extends LayoutNode ? never
  : SameUrlIndex<N> extends infer I ? [I] extends [never] ? N : I
  : never

/** A typed URL destination using the ranked endpoint's inherited Schema inputs. @since 0.2.0 */
export type Destination<T extends Any> = All<T> extends infer R
  ? R extends Any ? RankedLeaf<R> extends infer L ? L extends Any ?
          & { readonly to: L["path"]; readonly replace?: boolean; readonly state?: unknown }
          & OptionalInput<"params", Route.Route.Params<L>>
          & OptionalInput<"search", Route.Route.Search<L>>
          & ("" extends Route.Route.Hash<L> ? { readonly hash?: Route.Route.Hash<L> }
            : { readonly hash: Route.Route.Hash<L> })
      : never :
    never :
  never :
  never

/** Erased destination input for renderer adapters; URL encoding validates its values. @since 0.2.0 */
export interface DestinationInput {
  readonly to: string
  readonly params?: unknown
  readonly search?: unknown
  readonly hash?: unknown
  readonly replace?: boolean
  readonly state?: unknown
}

/**
 * Selects the same endpoint as exact route matching and supplies omitted empty inputs.
 * Pass the result to Route.href for Schema validation and encoding before navigation.
 * Endpoint selection is cached per route array identity, and arrays are treated as immutable.
 * @since 0.2.0
 */
export const target = (routes: ReadonlyArray<Any>, destination: DestinationInput): {
  readonly route: Any
  readonly input: Route.Route.Input<Route.Any>
} => targetFor(indexFor(routes), destination)

/** Validates and flattens a tree in preorder. @since 0.2.0 */
export const flatten = <T extends Any>(tree: T): ReadonlyArray<All<T>> => {
  const output: Array<Any> = []
  const ids = new Set<string>()
  const templates = new Map<string, Any>()
  const visit = (route: Any, parent: Any | undefined, pathParent: Any | undefined) => {
    const invalid = (message: string): never => {
      throw new Route.RouteDefinitionError({ routeId: route.id, message })
    }
    if (ids.has(route.id)) invalid("Duplicate route ID or cycle")
    if (route.parentId !== parent?.id) invalid("Child belongs to a different parent")
    if ((parent === undefined) !== (route.kind === "root")) invalid("The tree must have exactly one root")
    if (route.kind === "index" && route.children.length > 0) invalid("Index routes cannot have children")
    ids.add(route.id)
    if (route.kind === "route" || route.kind === "index") {
      const template = route.path.replace(/:[^/]+/g, ":")
      const other = templates.get(template)
      if (other !== undefined && !(route.kind === "index" && other.kind === "route" && other.id === pathParent?.id)) {
        invalid(`Ambiguous route template: ${route.path}`)
      }
      templates.set(template, route)
    }
    output.push(route)
    for (const child of route.children) visit(child, route, route.kind === "layout" ? pathParent : route)
  }
  visit(tree, undefined, undefined)
  // Preorder traversal only emits the tree and its recursively declared children.
  return output as unknown as ReadonlyArray<All<T>>
}

/** A planned branch, before asynchronous loading. @since 0.2.0 */
export interface Plan {
  readonly entries: ReadonlyArray<
    { readonly route: Any; readonly match: Result.Result<Route.Match<Any>, Route.RouteDecodeError> }
  >
  readonly notFound: boolean
}

/** A ranked route with its path segments and ID depth precomputed. @since 0.2.0 */
export interface Ranked<T extends Any = Any> {
  readonly route: T
  readonly segments: ReadonlyArray<string>
  readonly depth: number
}

const segments = (path: string) => path === "/" ? [] : path.slice(1).split("/")

// Navigation lookups derived from a flattened route list: ranked routes with
// precomputed segments, parent lookup by ID, and the destination endpoint per
// path template. Flattening guarantees unique IDs, so endpoint selection and
// ancestor walks never revisit a route.
interface Index<T extends Any = Any> {
  readonly ranked: ReadonlyArray<Ranked<T>>
  readonly byId: ReadonlyMap<string, Ranked<T>>
  readonly endpoints: ReadonlyMap<string, T>
}

const buildIndex = <T extends Any>(routes: ReadonlyArray<T>): Index<T> => {
  const ranked: Array<Ranked<T>> = []
  const byId = new Map<string, Ranked<T>>()
  const endpoints = new Map<string, T>()
  for (const route of routes) {
    const entry: Ranked<T> = {
      depth: route.id.split("/").length,
      route,
      segments: segments(route.path)
    }
    ranked.push(entry)
    if (!byId.has(route.id)) byId.set(route.id, entry)
    // Endpoints replay the original linear selection in array order: the
    // first candidate wins unless a later one replaces a non-index route.
    const current = endpoints.get(route.path)
    if (route.kind !== "layout" && (current === undefined || current.kind !== "index")) {
      endpoints.set(route.path, route)
    }
  }
  ranked.sort((a, b) => {
    const left = a.segments
    const right = b.segments
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const difference = Number(left[i].startsWith(":")) - Number(right[i].startsWith(":"))
      if (difference !== 0) return difference
    }
    return right.length - left.length || b.depth - a.depth
  })
  return { byId, endpoints, ranked }
}

// Callers hold flattened route arrays or compiled trees across navigations,
// and those arrays are treated as immutable, so caching by array identity is
// safe without copying or freezing. A cached index was built from this exact
// array, so re-typing its entries to the array's element type is sound.
const indexes = new WeakMap<ReadonlyArray<Any>, Index>()

const indexFor = <T extends Any>(routes: ReadonlyArray<T>): Index<T> => {
  const cached = indexes.get(routes)
  if (cached !== undefined) return cached as Index<T>
  const built = buildIndex(routes)
  indexes.set(routes, built)
  return built
}

const structural = (expected: ReadonlyArray<string>, actual: ReadonlyArray<string>, exact: boolean) => {
  if (exact ? actual.length !== expected.length : actual.length < expected.length) return false
  return expected.every((part, index) => {
    if (part.startsWith(":")) return true
    try {
      return decodeURIComponent(actual[index]) === part
    } catch {
      return false
    }
  })
}

const planFor = (index: Index, location: Route.UrlParts): Plan => {
  const actual = segments(location.pathname)
  const find = (accept: (route: Any) => boolean, exact: boolean) => {
    for (const entry of index.ranked) {
      if (accept(entry.route) && structural(entry.segments, actual, exact)) return entry
    }
    return undefined
  }
  const exact = find((route) => route.kind !== "layout", true)
  const leaf = exact ?? find((route) => route.kind !== "index", false)
  const chain: Array<Ranked> = []
  let current = leaf
  while (current !== undefined) {
    chain.unshift(current)
    const parentId = current.route.parentId
    current = parentId === undefined ? undefined : index.byId.get(parentId)
  }
  return {
    notFound: exact === undefined,
    entries: chain.map(({ route, segments: expected }) => {
      const prefix = actual.slice(0, expected.length)
      const matched = Route.match(route, { ...location, pathname: prefix.length === 0 ? "/" : `/${prefix.join("/")}` })
      return {
        route,
        match: Result.flatMap(matched, (value) =>
          Option.isSome(value)
            ? Result.succeed(value.value)
            : Result.fail(
              new Route.RouteDecodeError({
                routeId: route.id,
                part: "path",
                input: location.pathname,
                message: "Invalid route prefix"
              })
            ))
      }
    })
  }
}

const targetFor = (index: Index, destination: DestinationInput): {
  readonly route: Any
  readonly input: Route.Route.Input<Route.Any>
} => {
  const route = index.endpoints.get(destination.to)
  if (route === undefined) throw new Error(`Unknown route destination: ${destination.to}`)
  return {
    route,
    input: {
      params: destination.params ?? {},
      search: destination.search ?? {},
      hash: destination.hash ?? ""
    } as Route.Route.Input<Route.Any>
  }
}

/** Plans a static-before-dynamic branch and preserves ancestors for not-found handling.
 * Rankings are cached per flattened route array identity, so repeated navigation does not re-sort.
 * @since 0.2.0
 */
export const plan = (routes: ReadonlyArray<Any>, location: Route.UrlParts): Plan => planFor(indexFor(routes), location)

/**
 * A route tree validated once, with ranked routes, precomputed segments, parent lookup, and
 * destination endpoint selection ready for repeated navigation. `compile` instantiates the
 * route parameter with the tree's `All<T>` union; the default erases to `Any` so adapters
 * can share compiled values without naming the source tree type.
 * @since 0.2.0
 */
export interface Compiled<T extends Any = Any> {
  readonly routes: ReadonlyArray<T>
  readonly ranked: ReadonlyArray<Ranked<T>>
  readonly byId: ReadonlyMap<string, Ranked<T>>
  readonly endpoints: ReadonlyMap<string, T>
  readonly plan: (location: Route.UrlParts) => Plan
  readonly target: (destination: DestinationInput) => {
    readonly route: Any
    readonly input: Route.Route.Input<Route.Any>
  }
}

const compiledTrees = new WeakMap<Any, Compiled>()

/**
 * Validates a static route tree once and returns its compiled navigation structures,
 * typed with the tree's `All<T>` route union. Ranking, path segments, parent lookup, and
 * endpoint selection are precomputed during setup: `target` is an indexed lookup, and
 * `plan` walks the already-ranked routes without re-sorting per navigation.
 * `Router.fromTree` calls this once; adapters can consume the compiled value directly.
 * Results are cached by root node identity, and nodes are immutable because
 * `addChildren` returns a new node.
 * @since 0.2.0
 */
export const compile = <T extends Any>(tree: T): Compiled<All<T>> => {
  const cached = compiledTrees.get(tree) as Compiled<All<T>> | undefined
  if (cached !== undefined) return cached
  const routes: ReadonlyArray<All<T>> = flatten(tree)
  const index = indexFor(routes)
  const value: Compiled<All<T>> = {
    ...index,
    routes,
    plan: (location) => planFor(index, location),
    target: (destination) => targetFor(index, destination)
  }
  compiledTrees.set(tree, value)
  return value
}
