import * as BrowserHistory from "@effect-web/router/BrowserHistory"
import * as Route from "@effect-web/router/Route"
import * as Router from "@effect-web/router/Router"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

export interface PageMetadata {
  readonly title: string
  readonly message: string
  readonly renderKey: string
}

export class ModuleLoadError extends Schema.TaggedError<ModuleLoadError>()("ModuleLoadError", {
  routeId: Schema.String,
  message: Schema.String,
  cause: Schema.Defect()
}) {}

export const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
export type ProjectId = typeof ProjectId.Type

export const projectId42 = Schema.decodeUnknownSync(ProjectId)("42")

export const homeRoute = Route.make({
  id: "home",
  path: "/",
  params: {},
  search: {}
})

export const projectRoute = Route.make({
  id: "project",
  path: "/projects/:projectId",
  params: { projectId: ProjectId },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  hash: Schema.Literals(["", "details"])
})

const importModule = Effect.fn("RouterExample.importModule")(function*<A extends PageMetadata>(
  routeId: string,
  load: () => Promise<{ readonly page: A }>
) {
  const module = yield* Effect.tryPromise({
    try: load,
    catch: (cause) => new ModuleLoadError({ routeId, message: `Could not load ${routeId}`, cause })
  })
  return module.page
})

export const lazyRoute = Route.make({
  id: "lazy",
  path: "/lazy",
  params: {},
  search: {},
  load: () => importModule("lazy", () => import("./pages/lazy.ts"))
})

export type SlowLoaderEvent = "started" | "finalized"

const slowLoaderListeners = new Set<(event: SlowLoaderEvent) => void>()

const publishSlowLoaderEvent = (event: SlowLoaderEvent): void => {
  for (const listener of slowLoaderListeners) {
    listener(event)
  }
}

export const subscribeToSlowLoader = (listener: (event: SlowLoaderEvent) => void): () => void => {
  slowLoaderListeners.add(listener)
  return () => slowLoaderListeners.delete(listener)
}

const loadSlowRoute = Effect.fn("RouterExample.loadSlowRoute")(function*() {
  yield* Effect.acquireRelease(
    Effect.sync(() => publishSlowLoaderEvent("started")),
    () => Effect.sync(() => publishSlowLoaderEvent("finalized"))
  )
  yield* Effect.sleep("3 seconds")
  return yield* importModule("slow", () => import("./pages/slow.ts"))
})

export const slowRoute = Route.make({
  id: "slow",
  path: "/slow",
  params: {},
  search: {},
  load: loadSlowRoute
})

export const routes = [homeRoute, projectRoute, lazyRoute, slowRoute] as const

export const router = Router.make({
  routes,
  layer: BrowserHistory.layer
})

export const href = <R extends (typeof routes)[number]>(route: R, input: Route.Route.Input<R>): string =>
  Result.getOrElse(router.href(route, input), (error) => `#encode-error-${error.part}`)

export const destinations = {
  home: href(homeRoute, { params: {}, search: {}, hash: "" }),
  project: href(projectRoute, {
    params: { projectId: projectId42 },
    search: { tab: "activity" },
    hash: "details"
  }),
  lazy: href(lazyRoute, { params: {}, search: {}, hash: "" }),
  slow: href(slowRoute, { params: {}, search: {}, hash: "" }),
  malformed: "/projects/not-a-number?tab=unknown#wrong"
} as const
