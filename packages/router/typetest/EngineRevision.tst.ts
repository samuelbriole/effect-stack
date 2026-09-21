import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Route from "@effect-stack/router/Route"
import * as Router from "@effect-stack/router/Router"
import * as RouteTree from "@effect-stack/router/RouteTree"
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type * as Atom from "effect/unstable/reactivity/Atom"
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import { describe, expect, test } from "tstyche"

class LoadIssue extends Schema.TaggedError<LoadIssue>()("LoadIssue", {}) {}
class DataIssue extends Schema.TaggedError<DataIssue>()("DataIssue", {}) {}

const home = Route.make({ id: "home", path: "/", params: {}, search: {} })
const project = Route.make({
  id: "project",
  path: "/projects/:id",
  params: { id: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  lazy: () => Effect.fail(new LoadIssue()).pipe(Effect.as({ title: "project" } as const)),
  loader: (input: Route.LoaderInput<{ id: number }, { tab?: "overview" | "activity" }, string>) =>
    input.params.id === 1 ? Effect.succeed({ id: input.params.id }) : Effect.fail(new DataIssue())
})
const foreign = Route.make({ id: "foreign", path: "/foreign", params: {}, search: {} })

const routes = [home, project] as const
type Routes = typeof routes
const router = Router.make({ routes, layer: MemoryHistory.layer() })
const sampleBranch: Router.Branch<Routes, never> = null as unknown as Router.Branch<Routes, never>

describe("execute and retry contracts", () => {
  test("execute is a registry-scoped effect with typed navigation failures", () => {
    expect(router.execute(Router.push(project, { params: { id: 7 }, search: {}, hash: "" }))).type.toBe<
      Effect.Effect<void, Router.NavigationError<Routes>, AtomRegistry.AtomRegistry>
    >()
    expect(router.retry).type.toBe<Effect.Effect<void, Router.NavigationError<Routes>, AtomRegistry.AtomRegistry>>()
  })
  test("execute rejects commands for routes outside the set", () => {
    expect(router.execute).type.not.toBeCallableWith(Router.push(foreign, { params: {}, search: {}, hash: "" }))
  })
})

describe("typed branch inference", () => {
  test("branch exposes the per-router typed snapshot", () => {
    expect(router.branch).type.toBe<Atom.Atom<Router.Branch<Routes, never>>>()
    expect(router.completed).type.toBe<Atom.Atom<Option.Option<Router.SuccessfulBranch<Routes>>>>()
  })
  test("routeId discriminates entry data, input, and typed failures", () => {
    for (const entry of sampleBranch.matches) {
      if (entry.routeId === "project") {
        expect(entry.route).type.toBe<typeof project>()
        expect(entry.incoming).type.toBe<Result.Result<Router.IncomingRoute<typeof project>, Route.RouteDecodeError>>()
        expect(entry.result).type.toBe<
          AsyncResult.AsyncResult<Router.ResolvedRoute<typeof project>, Router.RouteFailure<typeof project>>
        >()
        expect(entry.retained).type.toBe<Option.Option<Router.ResolvedRoute<typeof project>>>()
        if (AsyncResult.isSuccess(entry.result)) {
          expect(entry.result.value.params.id).type.toBe<number>()
          expect(entry.result.value.module).type.toBe<{ readonly title: "project" }>()
        }
      } else {
        expect(entry.routeId).type.toBe<"home">()
        expect(entry.route).type.toBe<typeof home>()
        expect(entry.result).type.toBe<
          AsyncResult.AsyncResult<Router.ResolvedRoute<typeof home>, Route.RouteDecodeError>
        >()
      }
    }
  })
  test("route failures expose exactly the route's own load, loader, and decode errors", () => {
    expect<Router.RouteFailure<typeof project>>().type.toBe<
      | Route.RouteDecodeError
      | Router.RouteLoadError<"project", LoadIssue>
      | Router.RouteLoaderError<"project", DataIssue>
    >()
    expect<Router.RouteFailure<typeof home>>().type.toBe<Route.RouteDecodeError>()
  })
  test("branch widens to the default generic used by shared policies", () => {
    expect(router.branch).type.toBeAssignableTo<Atom.Atom<Router.Branch>>()
    expect<Router.TransitionId>().type.toBeAssignableTo<object>()
  })
})

describe("route atoms", () => {
  test("selections carry route-typed values", () => {
    const atoms = router.routeAtoms(project)
    expect(atoms.route).type.toBe<typeof project>()
    expect(atoms.state).type.toBe<Atom.Atom<Option.Option<Router.MatchState<typeof project>>>>()
    expect(atoms.incoming).type.toBe<
      Atom.Atom<Option.Option<Result.Result<IncomingOf<typeof project>, Route.RouteDecodeError>>>
    >()
    expect(atoms.params).type.toBe<Atom.Atom<Option.Option<{ readonly id: number }>>>()
    expect(atoms.search).type.toBe<Atom.Atom<Option.Option<{ readonly tab?: "overview" | "activity" }>>>()
    expect(atoms.resolved).type.toBe<Atom.Atom<Option.Option<Router.ResolvedRoute<typeof project>>>>()
    expect(router.routeAtoms(home).params).type.not.toBe<Atom.Atom<Option.Option<{ readonly id: number }>>>()
  })
  test("route atoms reject routes outside the set", () => {
    expect(router.routeAtoms).type.not.toBeCallableWith(foreign)
  })
})

describe("tree routers", () => {
  const treeRoot = RouteTree.root()
  const leaf = RouteTree.make({
    getParentRoute: () => treeRoot,
    path: "leaf/:id",
    params: { id: Schema.FiniteFromString }
  })
  const tree = treeRoot.addChildren([leaf])
  const treeRouter = Router.fromTree({ routeTree: tree, layer: MemoryHistory.layer() })
  test("fromTree exposes the compiled plan", () => {
    expect(treeRouter.compiled).type.toBe<RouteTree.Compiled | undefined>()
    expect<Router.Branch<ReadonlyArray<RouteTree.All<typeof tree>>, never>>().type.toBeAssignableTo<Router.Branch>()
  })
  test("flat routers report no compiled tree", () => {
    expect(router.compiled).type.toBe<RouteTree.Compiled | undefined>()
  })
})

type IncomingOf<R extends Route.Any> = Router.IncomingRoute<R>
