import { type History, MemoryHistory, Route, Router } from "@effect-stack/router"
import { Context, Effect, Layer, Schema } from "effect"
import { describe, expect, test } from "tstyche"

class Projects extends Context.Service<Projects, { readonly title: string }>()("test/Projects") {}
class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}
const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
const home = Route.make({ id: "home", path: "/", params: {}, search: {} })
const project = Route.make({
  id: "project",
  path: "/projects/:id",
  params: { id: ProjectId },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  hash: Schema.Literals(["", "details"]),
  lazy: () => Effect.succeed({ view: "Project" as const }),
  loader: ({ params, search, hash, location }) => {
    expect(params.id).type.toBe<typeof ProjectId.Type>()
    expect(search.tab).type.toBe<"overview" | "activity" | undefined>()
    expect(hash).type.toBe<"" | "details">()
    expect(location).type.toBe<History.Location>()
    return Projects.use((service) => Effect.succeed({ id: params.id, title: service.title })).pipe(
      Effect.andThen((data) => data.title === "" ? Effect.fail(new Missing({})) : Effect.succeed(data))
    )
  }
})

declare const resolved: Router.Resolved<readonly [typeof home, typeof project]>

describe("data loader inference", () => {
  test("keeps code, data, errors, and requirements distinct", () => {
    expect<Route.Route.Module<typeof project>>().type.toBe<{ view: "Project" }>()
    expect<Route.Route.LoaderData<typeof project>>().type.toBe<{ id: typeof ProjectId.Type; title: string }>()
    expect<Route.Route.LoaderError<typeof project>>().type.toBe<Missing>()
    expect<Route.Route.LoadError<typeof project>>().type.toBe<never>()
    expect<Route.Route.Services<typeof project>>().type.toBe<Projects>()
    expect<Route.Route.LoaderData<typeof home>>().type.toBe<void>()
    expect<Route.Route.Services<typeof home>>().type.toBe<never>()
    expect<Route.Route.LoaderError<typeof home>>().type.toBe<never>()
  })

  test("requires loader services in the router Layer", () => {
    expect(Router.make).type.not.toBeCallableWith({ routes: [project], layer: MemoryHistory.layer() })
    expect(Router.make).type.toBeCallableWith({
      routes: [project],
      layer: Layer.merge(MemoryHistory.layer(), Layer.succeed(Projects, { title: "Project" }))
    })
  })

  test("route IDs discriminate data and loader failures", () => {
    if (resolved.id === "project") {
      expect(resolved.loaderData).type.toBe<{ id: typeof ProjectId.Type; title: string }>()
    } else {
      expect(resolved.loaderData).type.toBe<void>()
    }
    type Failure = Extract<
      Router.NavigationError<readonly [typeof home, typeof project]>,
      Router.RouteLoaderError<string, unknown>
    >
    expect<Failure>().type.toBe<Router.RouteLoaderError<"project", Missing>>()
  })
})
