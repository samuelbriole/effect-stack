/**
 * Code-based route trees with inherited URL schemas.
 * @since 0.2.0
 */
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
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
}

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
  addChildren: (next) => node(route, parentId, kind, next)
})

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

const segments = (path: string) => path === "/" ? [] : path.slice(1).split("/")
const structural = (route: Any, pathname: string, exact: boolean) => {
  const expected = segments(route.path)
  const actual = segments(pathname)
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

/** Plans a static-before-dynamic branch and preserves ancestors for not-found handling. @since 0.2.0 */
export const plan = (routes: ReadonlyArray<Any>, location: Route.UrlParts): Plan => {
  const ranked = [...routes].sort((a, b) => {
    const left = segments(a.path)
    const right = segments(b.path)
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const difference = Number(left[i].startsWith(":")) - Number(right[i].startsWith(":"))
      if (difference !== 0) return difference
    }
    return right.length - left.length || b.id.split("/").length - a.id.split("/").length
  })
  const exact = ranked.find((route) => route.kind !== "layout" && structural(route, location.pathname, true))
  const leaf = exact ?? ranked.find((route) => route.kind !== "index" && structural(route, location.pathname, false))
  const chain: Array<Any> = []
  let current = leaf
  while (current !== undefined) {
    chain.unshift(current)
    const parentId = current.parentId
    current = routes.find((route) => route.id === parentId)
  }
  return {
    notFound: exact === undefined,
    entries: chain.map((route) => {
      const prefix = segments(location.pathname).slice(0, segments(route.path).length)
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
