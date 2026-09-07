import * as History from "@effect-stack/router/History"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Route from "@effect-stack/router/Route"
import * as Router from "@effect-stack/router/Router"
import * as RouteTree from "@effect-stack/router/RouteTree"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

const makeRegistry = Effect.fn("EngineRevision.makeRegistry")(function*() {
  const registry = AtomRegistry.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
  return registry
})

// Runs an `execute`/`retry` effect with the concrete test registry as service.
const runRegistryEffect = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  self: Effect.Effect<A, E, AtomRegistry.AtomRegistry>
): Effect.Effect<A, E> => Effect.provideService(self, AtomRegistry.AtomRegistry, registry)

class BuildFailed extends Schema.TaggedError<BuildFailed>()("EngineRevision.BuildFailed", {}) {}
class MissingChild extends Schema.TaggedError<MissingChild>()("EngineRevision.MissingChild", { id: Schema.Number }) {}

const home = Route.make({ id: "home", path: "/", params: {}, search: {} })

const project = Route.make({
  id: "project",
  path: "/projects/:id",
  params: { id: Schema.FiniteFromString },
  search: {}
})

type ErasedEntry = Router.MatchState<Route.Any>

const absentResult = AsyncResult.initial<Router.ResolvedRoute<Route.Any>, Router.RouteFailure<Route.Any>>()

const entryResult = (entry: ErasedEntry | undefined) => entry === undefined ? absentResult : entry.result

const childEntry = <Routes extends ReadonlyArray<Route.Any>>(
  branch: Router.Branch<Routes>,
  routeId: string
): ErasedEntry | undefined =>
  (branch.matches as unknown as ReadonlyArray<ErasedEntry>).find((entry) => entry.routeId === routeId)

describe("EngineRevision", () => {
  it.effect("publishes decoded incoming entries for the whole branch before loaders settle", () =>
    Effect.gen(function*() {
      const rootStarted = yield* Deferred.make<void>()
      const allowRoot = yield* Deferred.make<void>()
      const root = RouteTree.root({
        loader: () => Deferred.succeed(rootStarted, undefined).pipe(Effect.andThen(Deferred.await(allowRoot)))
      })
      const child = RouteTree.make({
        getParentRoute: () => root,
        path: "child/:id",
        params: { id: Schema.FiniteFromString },
        loader: () => Effect.succeed("child-data")
      })
      const tree = root.addChildren([child])
      const router = Router.fromTree({ routeTree: tree, layer: MemoryHistory.layer("/child/7") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.branch)
      yield* Deferred.await(rootStarted)
      const branch = registry.get(router.branch)
      expect(branch.matches.map((entry) => entry.routeId)).toEqual(["__root__", "__root__/child/:id"])
      // Every planned entry's decoded input is published, even while the root
      // loader still runs and the child loader has not started.
      const plannedChild = childEntry(branch, "__root__/child/:id")
      expect(plannedChild !== undefined).toBe(true)
      if (plannedChild !== undefined && Result.isSuccess(plannedChild.incoming)) {
        expect(plannedChild.incoming.success.params.id).toBe(7)
      } else {
        expect.fail("Expected decoded child input")
      }
      expect(plannedChild?.result._tag).toBe("Initial")
      expect(plannedChild?.result.waiting).toBe(true)
      expect(branch.location._tag).toBe("Some")
      expect(branch.lastSuccess._tag).toBe("None")
      yield* Deferred.succeed(allowRoot, undefined)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      const settled = registry.get(router.branch)
      const settledChild = childEntry(settled, "__root__/child/:id")
      expect(AsyncResult.isSuccess(entryResult(settledChild))).toBe(true)
      expect(AsyncResult.value(entryResult(settledChild)).pipe(Option.map((value) => value.loaderData))).toEqual(
        Option.some("child-data")
      )
      expect(settled.matches.every((entry) => !entry.result.waiting)).toBe(true)
    }))

  it.effect("flat routers publish incoming before loaders and settle terminal entries", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const allow = yield* Deferred.make<void>()
      const slowProject = Route.make({
        id: "project",
        path: "/projects/:id",
        params: { id: Schema.FiniteFromString },
        search: {},
        loader: ({ params }) =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(allow)),
            Effect.as(`data-${params.id}`)
          )
      })
      const router = Router.make({ routes: [home, slowProject], layer: MemoryHistory.layer("/projects/3") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.branch)
      yield* Deferred.await(started)
      const branch = registry.get(router.branch)
      expect(branch.matches.length).toBe(1)
      const entry = branch.matches[0]
      expect(entry?.routeId).toBe("project")
      if (entry !== undefined && entry.routeId === "project" && Result.isSuccess(entry.incoming)) {
        expect(entry.incoming.success.params.id).toBe(3)
      } else {
        expect.fail("Expected decoded project input")
      }
      expect(entry?.result.waiting).toBe(true)
      yield* Deferred.succeed(allow, undefined)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      const settledEntry = childEntry(registry.get(router.branch), "project")
      expect(AsyncResult.value(entryResult(settledEntry)).pipe(Option.map((value) => value.loaderData))).toEqual(
        Option.some("data-3")
      )
      expect(settledEntry?.result.waiting).toBe(false)
    }))

  it.effect("publishes truthful waiting states and preserves settled entry identity", () =>
    Effect.gen(function*() {
      const rootGate = yield* Deferred.make<void>()
      const rootReloading = yield* Deferred.make<void>()
      const childGate = yield* Deferred.make<void>()
      const childReloading = yield* Deferred.make<void>()
      let rootLoads = 0
      const root = RouteTree.root({
        loader: () =>
          Effect.gen(function*() {
            rootLoads += 1
            if (rootLoads > 1) {
              yield* Deferred.succeed(rootReloading, undefined)
              yield* Deferred.await(rootGate)
            }
            return "root-data"
          })
      })
      const child = RouteTree.make({
        getParentRoute: () => root,
        path: "child/:id",
        params: { id: Schema.FiniteFromString },
        loader: Effect.fn("EngineRevision.childLoader")(function*({ params }) {
          if (params.id === 2) {
            yield* Deferred.succeed(childReloading, undefined)
            yield* Deferred.await(childGate)
          }
          if (params.id === 3) {
            return yield* new MissingChild({ id: params.id })
          }
          return `child-${params.id}`
        })
      })
      const tree = root.addChildren([child])
      const router = Router.fromTree({ routeTree: tree, layer: MemoryHistory.layer("/child/1") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      const first = registry.get(router.branch)
      const firstRootEntry = childEntry(first, "__root__")
      const firstChildEntry = childEntry(first, "__root__/child/:id")
      if (firstChildEntry === undefined || !AsyncResult.isSuccess(firstChildEntry.result)) {
        return expect.fail("Expected resolved child entry")
      }
      const originalResolved = firstChildEntry.result.value
      expect(originalResolved.params.id).toBe(1)
      expect(firstChildEntry.retained).toEqual(Option.some(originalResolved))

      // During a sibling navigation, every rerunning entry truthfully reports
      // waiting under the NEW transition token, while still surfacing its
      // prior data. The stable decoded input object is reused when unchanged.
      const navigating = yield* Effect.forkScoped(
        runRegistryEffect(registry, router.execute(Router.push(child, { params: { id: 2 }, search: {}, hash: "" })))
      )
      yield* Deferred.await(rootReloading)
      const mid = registry.get(router.branch)
      const midRoot = childEntry(mid, "__root__")
      expect(midRoot?.transitionId).toBe(mid.transitionId)
      expect(midRoot?.result.waiting).toBe(true)
      expect(AsyncResult.value(entryResult(midRoot)).pipe(Option.map((value) => value.loaderData))).toEqual(
        Option.some("root-data")
      )
      expect(midRoot?.incoming).toBe(firstRootEntry?.incoming)
      const midChild = childEntry(mid, "__root__/child/:id")
      expect(midChild?.transitionId).toBe(mid.transitionId)
      expect(AsyncResult.value(entryResult(midChild)).pipe(Option.map((value) => value.params.id))).toEqual(
        Option.some(1)
      )
      expect(midChild?.result.waiting).toBe(true)
      expect(midChild?.retained).toEqual(Option.some(originalResolved))
      expect(mid.result.waiting).toBe(true)

      // Once the root settles, its entry keeps its identity while the sibling
      // entry is still loading and when the sibling settles afterwards.
      yield* Deferred.succeed(rootGate, undefined)
      yield* Deferred.await(childReloading)
      const rootCommitted = childEntry(registry.get(router.branch), "__root__")
      expect(rootCommitted?.result.waiting).toBe(false)
      expect(rootCommitted?.transitionId).toBe(mid.transitionId)
      yield* Deferred.succeed(childGate, undefined)
      yield* Fiber.join(navigating)
      const second = registry.get(router.branch)
      expect(childEntry(second, "__root__")).toBe(rootCommitted)
      const secondChild = childEntry(second, "__root__/child/:id")
      expect(AsyncResult.value(entryResult(secondChild)).pipe(Option.map((value) => value.params.id))).toEqual(
        Option.some(2)
      )
      expect(second.matches.every((entry) => entry.transitionId === second.transitionId)).toBe(true)
      expect(Option.map(secondChild?.retained ?? Option.none(), (value) => value.params.id)).toEqual(Option.some(2))
      expect(registry.get(router.routeAtoms(child).resolved).pipe(Option.map((value) => value.params.id))).toEqual(
        Option.some(2)
      )

      // A failed navigation never revises the completed snapshot; the entry
      // and its resolved projection keep showing the last good data.
      const failed = yield* runRegistryEffect(
        registry,
        router.execute(Router.push(child, { params: { id: 3 }, search: {}, hash: "" })).pipe(Effect.exit)
      )
      expect(Exit.isFailure(failed)).toBe(true)
      if (Exit.isFailure(failed)) {
        const error = Cause.findErrorOption(failed.cause)
        expect(Option.isSome(error) && error.value).toMatchObject({
          _tag: "@effect-stack/router/RouteLoaderError",
          routeId: "__root__/child/:id"
        })
      }
      const afterFailure = registry.get(router.branch)
      expect(afterFailure.result._tag).toBe("Failure")
      expect(afterFailure.lastSuccess).toEqual(second.lastSuccess)
      const failedChild = childEntry(afterFailure, "__root__/child/:id")
      expect(AsyncResult.isFailure(entryResult(failedChild))).toBe(true)
      expect(AsyncResult.value(entryResult(failedChild)).pipe(Option.map((value) => value.params.id))).toEqual(
        Option.some(2)
      )
      expect(
        Option.map(failedChild?.retained ?? Option.none(), (value: Router.ResolvedRoute<Route.Any>) => value.params.id)
      ).toEqual(Option.some(2))
      const completed = registry.get(router.completed)
      expect(Option.isSome(completed)).toBe(true)
      expect(completed).toEqual(second.lastSuccess)
      // The resolved projection falls back to the retained snapshot.
      const resolved = registry.get(router.routeAtoms(child).resolved)
      expect(Option.map(resolved, (value) => value.params.id)).toEqual(Option.some(2))
      const incoming = registry.get(router.routeAtoms(child).incoming)
      expect(
        Option.flatMap(
          incoming,
          (value) => (Result.isSuccess(value) ? Option.some(value.success.params.id) : Option.none())
        )
      ).toEqual(Option.some(3))
    }))

  it.effect("completed revisions advance only on successful transitions", () =>
    Effect.gen(function*() {
      let failRefresh = false
      const tracked = Route.make({
        id: "home",
        path: "/",
        params: {},
        search: {},
        loader: () => failRefresh ? Effect.fail(new MissingChild({ id: 0 })) : Effect.succeed("ok")
      })
      const router = Router.make({ routes: [tracked], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.completed)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      const initial = registry.get(router.completed)
      expect(Option.isSome(initial)).toBe(true)
      yield* runRegistryEffect(registry, router.execute(Router.refresh))
      const refreshed = registry.get(router.completed)
      expect(Option.isSome(refreshed)).toBe(true)
      if (Option.isSome(initial) && Option.isSome(refreshed)) {
        expect(refreshed.value.transitionId).not.toBe(initial.value.transitionId)
        expect(refreshed.value.matches.length).toBe(1)
        expect(refreshed.value.location.pathname).toBe("/")
      }
      expect(registry.get(router.branch).transitionId).toEqual(
        Option.getOrThrow(Option.map(refreshed, (value) => value.transitionId))
      )
      failRefresh = true
      const failed = yield* runRegistryEffect(registry, router.execute(Router.refresh).pipe(Effect.exit))
      expect(Exit.isFailure(failed)).toBe(true)
      expect(registry.get(router.completed)).toEqual(refreshed)
      expect(registry.get(router.branch).result._tag).toBe("Failure")
    }))

  it.effect("route atoms are cached per ID and skip notifications for unchanged selections", () =>
    Effect.gen(function*() {
      const router = Router.make({ routes: [home, project], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(router.routeAtoms(home)).toBe(router.routeAtoms(home))
      const events = yield* Ref.make<number>(0)
      const unsubscribe = registry.subscribe(
        router.routeAtoms(project).params,
        () => Effect.runSync(Ref.update(events, (count) => count + 1))
      )
      yield* runRegistryEffect(
        registry,
        router.execute(Router.push(project, { params: { id: 42 }, search: {}, hash: "" }))
      )
      expect(registry.get(router.routeAtoms(project).params)).toEqual(Option.some({ id: 42 }))
      const eventsAfterNavigation = yield* Ref.get(events)
      // Refresh republishes the incoming input, but an equal selection must not
      // notify subscribers.
      yield* runRegistryEffect(registry, router.execute(Router.refresh))
      expect(yield* Ref.get(events)).toBe(eventsAfterNavigation)
      yield* runRegistryEffect(
        registry,
        router.execute(Router.push(project, { params: { id: 43 }, search: {}, hash: "" }))
      )
      expect(yield* Ref.get(events)).toBe(eventsAfterNavigation + 1)
      expect(registry.get(router.routeAtoms(project).params)).toEqual(Option.some({ id: 43 }))
      const resolved = registry.get(router.routeAtoms(project).resolved)
      expect(Option.map(resolved, (value) => value.params.id)).toEqual(Option.some(43))
      const incoming = registry.get(router.routeAtoms(project).incoming)
      expect(Option.isSome(incoming)).toBe(true)
      unsubscribe()
    }))

  it.effect("concurrent executes interrupt the superseded transition and resolve the second", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const finalized = yield* Deferred.make<void>()
      const slow = Route.make({
        id: "slow",
        path: "/slow",
        params: {},
        search: {},
        loader: () =>
          Effect.gen(function*() {
            yield* Effect.addFinalizer(() => Deferred.succeed(finalized, undefined))
            yield* Deferred.succeed(started, undefined)
            return yield* Effect.never
          })
      })
      const router = Router.make({ routes: [home, slow], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      const first = yield* Effect.forkScoped(
        runRegistryEffect(registry, router.execute(Router.push(slow, { params: {}, search: {}, hash: "" })))
      )
      yield* Deferred.await(started)
      yield* runRegistryEffect(registry, router.execute(Router.push(home, { params: {}, search: {}, hash: "" })))
      const firstExit = yield* Effect.exit(Fiber.join(first))
      expect(Exit.isFailure(firstExit)).toBe(true)
      if (Exit.isFailure(firstExit)) {
        expect(Cause.hasInterruptsOnly(firstExit.cause)).toBe(true)
      }
      const resolved = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(resolved.id).toBe("home")
      expect(yield* Deferred.isDone(finalized)).toBe(true)
    }))

  it.effect("aborting execute interrupts the exact transition and awaits its cleanup", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const finalized = yield* Deferred.make<void>()
      const slow = Route.make({
        id: "slow",
        path: "/slow",
        params: {},
        search: {},
        load: Effect.fn("EngineRevision.loadSlowUntilAborted")(function*() {
          yield* Effect.addFinalizer(() => Deferred.succeed(finalized, undefined))
          yield* Deferred.succeed(started, undefined)
          return yield* Effect.never
        })
      })
      const router = Router.make({ routes: [home, slow], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.branch)
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      const running = yield* Effect.forkScoped(
        runRegistryEffect(registry, router.execute(Router.push(slow, { params: {}, search: {}, hash: "" })))
      )
      yield* Deferred.await(started)
      yield* Fiber.interrupt(running)
      // The abort already completed, so the transition fiber must be finalized.
      expect(yield* Deferred.isDone(finalized)).toBe(true)
      const branch = registry.get(router.branch)
      const entry = childEntry(branch, "slow")
      expect(entry?.routeId).toBe("slow")
      expect(entry?.result._tag).toBe("Failure")
      if (entry !== undefined && AsyncResult.isFailure(entry.result)) {
        expect(Cause.hasInterruptsOnly(entry.result.cause)).toBe(true)
      }
      expect(entry?.result.waiting).toBe(false)
      expect(branch.result._tag).toBe("Failure")
      expect(branch.lastSuccess._tag).toBe("Some")
      // The compatible navigate atom projected the same aborted operation.
      const navigateResult = registry.get(router.navigate)
      expect(navigateResult._tag).toBe("Failure")
      if (navigateResult._tag === "Failure") {
        expect(Cause.hasInterruptsOnly(navigateResult.cause)).toBe(true)
      }
      expect(navigateResult.waiting).toBe(false)
    }))

  it.effect("self-interruption is a terminal failure for the entry, branch, and navigate projection", () =>
    Effect.gen(function*() {
      const selfInterrupting = Route.make({
        id: "interrupted",
        path: "/interrupted",
        params: {},
        search: {},
        loader: () => Effect.interrupt
      })
      const router = Router.make({ routes: [home, selfInterrupting], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.branch)
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      const failed = yield* runRegistryEffect(
        registry,
        router.execute(Router.push(selfInterrupting, { params: {}, search: {}, hash: "" })).pipe(Effect.exit)
      )
      expect(Exit.isFailure(failed)).toBe(true)
      const branch = registry.get(router.branch)
      const entry = childEntry(branch, "interrupted")
      expect(entry?.result._tag).toBe("Failure")
      if (entry !== undefined && AsyncResult.isFailure(entry.result)) {
        expect(Cause.hasInterruptsOnly(entry.result.cause)).toBe(true)
      }
      expect(entry?.result.waiting).toBe(false)
      expect(branch.result._tag).toBe("Failure")
      expect(branch.result.waiting).toBe(false)
      const navigateResult = registry.get(router.navigate)
      expect(navigateResult._tag).toBe("Failure")
      expect(navigateResult.waiting).toBe(false)
      // The healthy runtime can retry by re-dispatching the current location.
      expect(registry.get(router.completed)._tag).toBe("Some")
    }))

  it.effect("navigate observes execute-driven operations for renderer compatibility", () =>
    Effect.gen(function*() {
      const router = Router.make({ routes: [home, project], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      yield* runRegistryEffect(
        registry,
        router.execute(Router.push(project, { params: { id: 7 }, search: {}, hash: "" }))
      )
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
      expect((yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })).id).toBe("project")
      // Legacy writes keep working after execute-driven operations.
      registry.set(router.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
      expect((yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })).id).toBe("home")
    }))

  it.effect("retry rebuilds a failed Layer, re-executes it, and resolves the initial navigation", () =>
    Effect.gen(function*() {
      class Greeter extends Context.Service<Greeter, { readonly greeting: string }>()("EngineRevision.Greeter") {}
      let builds = 0
      let loaderRuns = 0
      const greeted = Route.make({
        id: "home",
        path: "/",
        params: {},
        search: {},
        loader: () => Greeter.use((service) => Effect.sync(() => `${service.greeting} ${++loaderRuns}`))
      })
      const router = Router.make({
        routes: [greeted],
        layer: Layer.merge(
          MemoryHistory.layer("/"),
          Layer.effect(
            Greeter,
            Effect.gen(function*() {
              builds += 1
              if (builds === 1) return yield* new BuildFailed()
              return Greeter.of({ greeting: "hello" })
            })
          )
        )
      })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.branch)
      const failed = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(
        Effect.exit
      )
      expect(Exit.isFailure(failed)).toBe(true)
      if (Exit.isFailure(failed)) {
        const error = Cause.findErrorOption(failed.cause)
        expect(Option.isSome(error) && error.value).toBeInstanceOf(BuildFailed)
      }
      expect(loaderRuns).toBe(0)
      expect(registry.get(router.branch).result._tag).toBe("Failure")
      yield* runRegistryEffect(registry, router.retry)
      expect(builds).toBe(2)
      const resolved = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(loaderRuns).toBe(1)
      expect(resolved.loaderData).toBe("hello 1")
      expect(registry.get(router.branch).result._tag).toBe("Success")
    }))

  it.effect("retry on a healthy runtime re-dispatches the current location", () =>
    Effect.gen(function*() {
      let loads = 0
      const counted = Route.make({
        id: "home",
        path: "/",
        params: {},
        search: {},
        loader: () => Effect.sync(() => ++loads)
      })
      const router = Router.make({ routes: [counted], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(loads).toBe(1)
      yield* runRegistryEffect(registry, router.retry)
      expect(loads).toBe(2)
    }))

  it.effect("Back, Forward, and Go are acceptance-only and resolve without their transitions", () =>
    Effect.gen(function*() {
      const traversals = yield* Ref.make<ReadonlyArray<number>>([])
      const location: History.Location = {
        pathname: "/",
        search: "",
        hash: "",
        state: undefined,
        key: "initial",
        index: 0
      }
      const history = History.Service.of({
        current: Effect.succeed(location),
        push: () => Effect.succeed(location),
        replace: () => Effect.succeed(location),
        go: (delta) => Ref.update(traversals, (entries) => [...entries, delta]),
        changes: Stream.never
      })
      const router = Router.make({ routes: [home], layer: Layer.succeed(History.Service, history) })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      // `changes: Stream.never` means no follow-up navigation can ever arrive;
      // acceptance-only commands must still complete.
      yield* runRegistryEffect(registry, router.execute(Router.back))
      yield* runRegistryEffect(registry, router.execute(Router.forward))
      yield* runRegistryEffect(registry, router.execute(Router.go(-2)))
      expect(yield* Ref.get(traversals)).toEqual([-1, 1, -2])
      registry.set(router.navigate, Router.back)
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
      expect(AsyncResult.isSuccess(registry.get(router.state))).toBe(true)
    }))

  it.effect("not-found transitions publish the location and keep completed snapshots untouched", () =>
    Effect.gen(function*() {
      const root = RouteTree.root()
      const child = RouteTree.make({ getParentRoute: () => root, path: "known" })
      const tree = root.addChildren([child])
      const router = Router.fromTree({ routeTree: tree, layer: MemoryHistory.layer("/missing/deep") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.branch)
      yield* AtomRegistry.mount(registry, router.state)
      const settled = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(
        Effect.exit
      )
      expect(Exit.isFailure(settled)).toBe(true)
      if (Exit.isFailure(settled)) {
        const error = Cause.findErrorOption(settled.cause)
        expect(Option.isSome(error) && error.value).toMatchObject({
          _tag: "@effect-stack/router/RouteNotFound"
        })
      }
      const branch = registry.get(router.branch)
      expect(branch.notFound).toBe(true)
      expect(Option.map(branch.location, (value) => value.pathname)).toEqual(Option.some("/missing/deep"))
      expect(branch.matches.map((entry) => entry.routeId)).toEqual(["__root__"])
      expect(branch.lastSuccess._tag).toBe("None")
      expect(registry.get(router.completed)._tag).toBe("None")
      expect(branch.matches.every((entry) => !entry.result.waiting)).toBe(true)
    }))

  it.effect("navigate resets to initial and tracks subsequent operations", () =>
    Effect.gen(function*() {
      let failNext = false
      const tracked = Route.make({
        id: "project",
        path: "/projects/:id",
        params: { id: Schema.FiniteFromString },
        search: {},
        loader: () => failNext ? Effect.fail(new MissingChild({ id: 0 })) : Effect.succeed("ok")
      })
      const router = Router.make({ routes: [home, tracked], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      // An execute-driven success is projected, resettable to Initial, and the
      // next operation is tracked again.
      yield* runRegistryEffect(
        registry,
        router.execute(Router.push(tracked, { params: { id: 1 }, search: {}, hash: "" }))
      )
      expect(registry.get(router.navigate)._tag).toBe("Success")
      registry.set(router.navigate, Atom.Reset)
      expect(registry.get(router.navigate)._tag).toBe("Initial")
      yield* runRegistryEffect(
        registry,
        router.execute(Router.push(tracked, { params: { id: 2 }, search: {}, hash: "" }))
      )
      expect(registry.get(router.navigate)._tag).toBe("Success")
      // A failed operation projects as Failure; reset hides it until the next
      // operation settles.
      failNext = true
      const failed = yield* runRegistryEffect(registry, router.execute(Router.refresh)).pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      expect(registry.get(router.navigate)._tag).toBe("Failure")
      registry.set(router.navigate, Atom.Reset)
      expect(registry.get(router.navigate)._tag).toBe("Initial")
      failNext = false
      yield* runRegistryEffect(registry, router.execute(Router.refresh))
      expect(registry.get(router.navigate)._tag).toBe("Success")
      // Legacy writes still work after resets.
      registry.set(router.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
      expect(registry.get(router.navigate)._tag).toBe("Success")
    }))

  it.effect("Atom.Interrupt cancels the accepted transition and terminalizes it as interrupted", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const finalized = yield* Deferred.make<void>()
      const slow = Route.make({
        id: "slow",
        path: "/slow",
        params: {},
        search: {},
        loader: () =>
          Effect.gen(function*() {
            yield* Effect.addFinalizer(() => Deferred.succeed(finalized, undefined))
            yield* Deferred.succeed(started, undefined)
            return yield* Effect.never
          })
      })
      const router = Router.make({ routes: [home, slow], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.mount(registry, router.branch)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      registry.set(router.navigate, Router.push(slow, { params: {}, search: {}, hash: "" }))
      yield* Deferred.await(started)
      registry.set(router.navigate, Atom.Interrupt)
      // Settling the observer proves the transition reached a terminal failure;
      // the blocked loader can never turn it into an eventual success.
      const settled = yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true }).pipe(
        Effect.exit
      )
      expect(Exit.isFailure(settled)).toBe(true)
      if (Exit.isFailure(settled)) {
        expect(Cause.hasInterruptsOnly(settled.cause)).toBe(true)
      }
      expect(yield* Deferred.isDone(finalized)).toBe(true)
      const operation = registry.get(router.navigate)
      expect(operation._tag).toBe("Failure")
      expect(operation.waiting).toBe(false)
      const entry = childEntry(registry.get(router.branch), "slow")
      expect(entry?.result._tag).toBe("Failure")
      expect(entry?.result.waiting).toBe(false)
    }))

  it.effect("a reset during a running operation stays Initial past its settle and tracks the next one", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const slow = Route.make({
        id: "slow",
        path: "/slow",
        params: {},
        search: {},
        loader: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.as("slow-data")
          )
      })
      const router = Router.make({ routes: [home, slow], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      const running = yield* Effect.forkScoped(
        runRegistryEffect(registry, router.execute(Router.push(slow, { params: {}, search: {}, hash: "" })))
      )
      yield* Deferred.await(started)
      registry.set(router.navigate, Atom.Reset)
      expect(registry.get(router.navigate)._tag).toBe("Initial")
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(running)
      // The superseded operation's settlement must not resurface.
      expect(registry.get(router.navigate)._tag).toBe("Initial")
      // The next dispatched operation is projected again.
      yield* runRegistryEffect(registry, router.execute(Router.refresh))
      expect(registry.get(router.navigate)._tag).toBe("Success")
    }))

  it.effect("resolved projection keeps the original inputs and data through a failed refresh", () =>
    Effect.gen(function*() {
      let fail = false
      const tracked = Route.make({
        id: "home",
        path: "/",
        params: {},
        search: { tab: Schema.optionalKey(Schema.String) },
        loader: ({ search }) => fail ? Effect.fail(new MissingChild({ id: 0 })) : Effect.succeed(`tab:${search.tab}`)
      })
      const router = Router.make({ routes: [tracked], layer: MemoryHistory.layer("/?tab=one") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      const atoms = router.routeAtoms(tracked)
      const original = registry.get(atoms.resolved)
      expect(Option.map(original, (value) => value.loaderData)).toEqual(Option.some("tab:one"))
      fail = true
      const failed = yield* runRegistryEffect(registry, router.execute(Router.refresh).pipe(Effect.exit))
      expect(Exit.isFailure(failed)).toBe(true)
      // Failed refresh: incoming shows the new decoded input, resolved keeps
      // the original successful snapshot.
      const incoming = registry.get(atoms.incoming)
      expect(
        Option.flatMap(
          incoming,
          (value) => (Result.isSuccess(value) ? Option.some(value.success.search.tab) : Option.none())
        )
      ).toEqual(Option.some("one"))
      expect(registry.get(atoms.resolved)).toEqual(original)
      const entry = registry.get(atoms.state)
      expect(Option.map(entry, (value) => value.result._tag)).toEqual(Option.some("Failure"))
    }))

  it.live("execute alone keeps a long loader alive without any mounted atoms", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const slow = Route.make({
        id: "slow",
        path: "/slow",
        params: {},
        search: {},
        loader: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.as("slow-data")
          )
      })
      const router = Router.make({ routes: [home, slow], layer: MemoryHistory.layer("/") })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      // Deliberately mount no router atoms: execute alone must retain the
      // scoped engine through the whole operation.
      const running = yield* Effect.forkScoped(
        runRegistryEffect(registry, router.execute(Router.push(slow, { params: {}, search: {}, hash: "" })))
      )
      yield* Deferred.await(started)
      yield* Effect.sleep("150 millis")
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(running)
      expect(yield* Deferred.isDone(release)).toBe(true)
    }))
})
