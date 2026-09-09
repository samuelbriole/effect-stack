/**
 * Canonical branch planning and destination resolution, shared by compiled route
 * trees and flat route lists. Internal module: not part of the package interface.
 * @since 0.3.0
 */
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Route from "./Route.ts"

/** The tree role of a route, as the canonical planner uses it. @since 0.3.0 */
export type Kind = "root" | "route" | "index" | "layout"

/** Erased destination input for renderer adapters; URL encoding validates its values. @since 0.3.0 */
export interface DestinationInput {
  readonly to: string
  readonly params?: unknown
  readonly search?: unknown
  readonly hash?: unknown
  readonly replace?: boolean
  readonly state?: unknown
}

/** A planned branch, before asynchronous loading. @since 0.3.0 */
export interface Plan<T extends Route.Any = Route.Any> {
  readonly entries: ReadonlyArray<
    { readonly route: T; readonly match: Result.Result<Route.Match<T>, Route.RouteDecodeError> }
  >
  readonly notFound: boolean
}

interface TreeFields {
  readonly kind: Kind
  readonly parentId: string | undefined
  readonly depth: number
}

interface Ranked<T extends Route.Any = Route.Any> extends TreeFields {
  readonly route: T
  readonly segments: ReadonlyArray<string>
}

// Navigation lookups derived from a flattened route list: ranked routes with
// precomputed segments, parent lookup by ID, and the destination endpoint per
// path template. Flattening guarantees unique IDs, so endpoint selection and
// ancestor walks never revisit a route.
interface Index<T extends Route.Any = Route.Any> {
  readonly ranked: ReadonlyArray<Ranked<T>>
  readonly byId: ReadonlyMap<string, Ranked<T>>
  readonly endpoints: ReadonlyMap<string, T>
}

/** Path segments of a route pattern; `/` has none. @since 0.3.0 */
const segmentsOf = (path: string): ReadonlyArray<string> => path === "/" ? [] : path.slice(1).split("/")

// Flat routes are plain `Route.Any` values without a tree role, so they plan as
// ordinary exact-match endpoints with no ancestors; tree nodes carry metadata.
// ID depth ranks tree siblings within ancestry only: flat route IDs are
// arbitrary strings, so flat lists rely on segment ranking and the stable
// declaration-order tie-break instead.
const shapeOf = <T extends Route.Any>(route: T): TreeFields =>
  "kind" in route && typeof (route as { readonly kind?: unknown }).kind === "string"
    ? {
      ...(route as unknown as { readonly kind: Kind; readonly parentId: string | undefined }),
      depth: route.id.split("/").length
    }
    : { kind: "route", parentId: undefined, depth: 0 }

const buildIndex = <T extends Route.Any>(routes: ReadonlyArray<T>): Index<T> => {
  const ranked: Array<Ranked<T>> = []
  const byId = new Map<string, Ranked<T>>()
  const endpoints = new Map<string, T>()
  for (const route of routes) {
    const entry: Ranked<T> = {
      ...shapeOf(route),
      route,
      segments: segmentsOf(route.path)
    }
    ranked.push(entry)
    if (!byId.has(route.id)) byId.set(route.id, entry)
    // Endpoints replay the original linear selection in array order: the
    // first candidate wins unless a later one replaces a non-index route.
    const current = endpoints.get(route.path)
    if (entry.kind !== "layout" && (current === undefined || shapeOf(current).kind !== "index")) {
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

// Callers hold flattened route arrays, compiled trees, or flat router route
// lists across navigations, and those arrays are treated as immutable, so
// caching by array identity is safe without copying or freezing. A cached
// index was built from this exact array, so re-typing its entries to the
// array's element type is sound.
const indexes = new WeakMap<ReadonlyArray<Route.Any>, Index>()

export const indexFor = <T extends Route.Any>(routes: ReadonlyArray<T>): Index<T> => {
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

export const planFor = <T extends Route.Any>(index: Index<T>, location: Route.UrlParts): Plan<T> => {
  const actual = segmentsOf(location.pathname)
  const find = (accept: (entry: Ranked<T>) => boolean, exact: boolean): Ranked<T> | undefined => {
    for (const entry of index.ranked) {
      if (accept(entry) && structural(entry.segments, actual, exact)) return entry
    }
    return undefined
  }
  const exact = find((entry) => entry.kind !== "layout", true)
  const leaf = exact ?? find((entry) => entry.kind !== "index", false)
  const chain: Array<Ranked<T>> = []
  let current = leaf
  while (current !== undefined) {
    chain.unshift(current)
    current = current.parentId === undefined ? undefined : index.byId.get(current.parentId)
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

export const targetFor = <T extends Route.Any>(
  index: Index<T>,
  destination: DestinationInput
): {
  readonly route: T
  readonly input: Route.Route.Input<T>
} => {
  const route = index.endpoints.get(destination.to)
  if (route === undefined) throw new Error(`Unknown route destination: ${destination.to}`)
  return {
    route,
    input: {
      params: destination.params ?? {},
      search: destination.search ?? {},
      hash: destination.hash ?? ""
    } as Route.Route.Input<T>
  }
}
