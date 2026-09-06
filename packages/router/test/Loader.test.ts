import { MemoryHistory, Route, Router } from "@effect-stack/router"
import { describe, expect, it } from "@effect/vitest"
import { Cause, Context, Deferred, Effect, Exit, Layer, Option, Schema } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"

const home = Route.make({ id: "home", path: "/", params: {}, search: {} })

const makeRegistry = Effect.fn("LoaderTest.makeRegistry")(function*() {
  const registry = AtomRegistry.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
  return registry
})

class MissingProject extends Schema.TaggedError<MissingProject>()("MissingProject", { id: Schema.Number }) {}

describe("data loaders", () => {
  it.effect("decodes inputs, provides services, and reruns on refresh and navigation", () =>
    Effect.gen(function*() {
      class Projects extends Context.Service<Projects, { readonly title: string }>()("test/Projects") {}
      const calls: Array<number> = []
      const project = Route.make({
        id: "project",
        path: "/projects/:id",
        params: { id: Schema.FiniteFromString },
        search: { tab: Schema.optionalKey(Schema.Literals(["activity", "overview"])) },
        hash: Schema.Literals(["", "details"]),
        loader: Effect.fn("LoaderTest.project")(function*({ params, search, hash, location }) {
          const projects = yield* Projects
          calls.push(params.id)
          return { title: projects.title, id: params.id, tab: search.tab, hash, pathname: location.pathname }
        })
      })
      const router = Router.make({
        routes: [home, project],
        layer: Layer.merge(
          MemoryHistory.layer("/projects/42?tab=activity#details"),
          Layer.succeed(Projects, { title: "Project" })
        )
      })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)
      const initial = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(initial.loaderData).toEqual({
        title: "Project",
        id: 42,
        tab: "activity",
        hash: "details",
        pathname: "/projects/42"
      })
      expect(initial.module).toBeUndefined()
      registry.set(router.navigate, Router.refresh)
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
      registry.set(router.navigate, Router.push(project, { params: { id: 43 }, search: {}, hash: "" }))
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
      expect(calls).toEqual([42, 42, 43])
      expect((yield* AtomRegistry.getResult(registry, router.state)).loaderData?.id).toBe(43)
    }))

  it.effect("does not invoke loaders for unmatched or malformed URLs", () =>
    Effect.gen(function*() {
      let calls = 0
      const project = Route.make({
        id: "project",
        path: "/projects/:id",
        params: { id: Schema.FiniteFromString },
        search: {},
        loader: () => Effect.sync(() => ++calls)
      })
      for (const url of ["/", "/projects/invalid", "/missing"]) {
        const router = Router.make({ routes: [home, project], layer: MemoryHistory.layer(url) })
        const registry = yield* makeRegistry()
        yield* AtomRegistry.mount(registry, router.state)
        const exit = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(Effect.exit)
        expect(Exit.isSuccess(exit)).toBe(url === "/")
      }
      expect(calls).toBe(0)
    }))

  it.effect("loads code and data concurrently and keeps their results separate", () =>
    Effect.gen(function*() {
      const codeStarted = yield* Deferred.make<void>()
      const dataStarted = yield* Deferred.make<void>()
      const project = Route.make({
        id: "project",
        path: "/",
        params: {},
        search: {},
        load: () =>
          Deferred.succeed(codeStarted, undefined).pipe(
            Effect.andThen(Deferred.await(dataStarted)),
            Effect.as({ view: "Project" })
          ),
        loader: () =>
          Deferred.succeed(dataStarted, undefined).pipe(
            Effect.andThen(Deferred.await(codeStarted)),
            Effect.as({ title: "Project 42" })
          )
      })
      const router = Router.make({ routes: [project], layer: MemoryHistory.layer() })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      const resolved = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(resolved.module).toEqual({ view: "Project" })
      expect(resolved.loaderData).toEqual({ title: "Project 42" })
    }))

  it.effect("preserves typed data errors and supports refresh after failure", () =>
    Effect.gen(function*() {
      const error = new MissingProject({ id: 42 })
      let fail = true
      const project = Route.make({
        id: "project",
        path: "/",
        params: {},
        search: {},
        loader: () => fail ? Effect.fail(error) : Effect.succeed({ id: 42 })
      })
      const router = Router.make({ routes: [project], layer: MemoryHistory.layer() })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)
      const exit = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return expect.fail("Expected loader failure")
      const failure = Cause.findErrorOption(exit.cause)
      if (Option.isNone(failure)) return expect.fail("Expected typed failure")
      expect(failure.value).toBeInstanceOf(Router.RouteLoaderError)
      if (failure.value instanceof Router.RouteLoaderError) {
        expect(failure.value.routeId).toBe("project")
        expect(failure.value.error).toBe(error)
      }
      fail = false
      registry.set(router.navigate, Router.refresh)
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
      expect((yield* AtomRegistry.getResult(registry, router.state)).loaderData).toEqual({ id: 42 })
    }))

  it.effect("interrupts and finalizes data loaders when superseded or disposed", () =>
    Effect.gen(function*() {
      for (const dispose of [false, true]) {
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
        const router = Router.make({ routes: [home, slow], layer: MemoryHistory.layer("/slow") })
        const registry = yield* makeRegistry()
        yield* AtomRegistry.mount(registry, router.state)
        yield* AtomRegistry.mount(registry, router.navigate)
        yield* Deferred.await(started)
        if (dispose) registry.dispose()
        else registry.set(router.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))
        yield* Deferred.await(finalized)
        if (!dispose) {
          const resolved = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
          expect(resolved.id).toBe("home")
          expect(resolved.loaderData).toBeUndefined()
        }
      }
    }))

  it.effect("interrupts sibling code loading when the data loader fails", () =>
    Effect.gen(function*() {
      const codeStarted = yield* Deferred.make<void>()
      const finalized = yield* Deferred.make<void>()
      const project = Route.make({
        id: "project",
        path: "/",
        params: {},
        search: {},
        load: () =>
          Effect.gen(function*() {
            yield* Effect.addFinalizer(() => Deferred.succeed(finalized, undefined))
            yield* Deferred.succeed(codeStarted, undefined)
            return yield* Effect.never
          }),
        loader: () => Deferred.await(codeStarted).pipe(Effect.andThen(Effect.fail(new MissingProject({ id: 42 }))))
      })
      const router = Router.make({ routes: [project], layer: MemoryHistory.layer() })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      const exit = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      yield* Deferred.await(finalized)
    }))

  it.effect("ignores late success and failure from superseded non-cancelable promises", () =>
    Effect.gen(function*() {
      for (const reject of [false, true]) {
        const started = yield* Deferred.make<void>()
        let complete: () => void = () => {
          throw new Error("Promise executor did not initialize")
        }
        const completion = new Promise<{ readonly id: number }>((resolve, rejectPromise) => {
          complete = () => reject ? rejectPromise(new MissingProject({ id: 42 })) : resolve({ id: 42 })
        })
        const slow = Route.make({
          id: "slow",
          path: "/slow",
          params: {},
          search: {},
          loader: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(
                Effect.tryPromise({ try: () => completion, catch: () => new MissingProject({ id: 42 }) })
              )
            )
        })
        const router = Router.make({ routes: [home, slow], layer: MemoryHistory.layer("/slow") })
        const registry = yield* makeRegistry()
        yield* AtomRegistry.mount(registry, router.state)
        yield* AtomRegistry.mount(registry, router.navigate)
        yield* Deferred.await(started)
        registry.set(router.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))
        yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
        complete()
        yield* Effect.promise(() => completion.catch(() => undefined))
        yield* Effect.yieldNow
        expect((yield* AtomRegistry.getResult(registry, router.state)).id).toBe("home")
      }
    }))

  it.effect("closes successful loader scopes before publishing their data", () =>
    Effect.gen(function*() {
      let finalized = false
      const project = Route.make({
        id: "project",
        path: "/",
        params: {},
        search: {},
        loader: () =>
          Effect.gen(function*() {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                finalized = true
              })
            )
            return { id: 42 }
          })
      })
      const router = Router.make({ routes: [project], layer: MemoryHistory.layer() })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      expect((yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })).loaderData).toEqual({
        id: 42
      })
      expect(finalized).toBe(true)
    }))

  it.effect("keeps thrown loader defects out of the typed error channel", () =>
    Effect.gen(function*() {
      const defect = new Error("loader defect")
      const project = Route.make({
        id: "project",
        path: "/",
        params: {},
        search: {},
        loader: (): Effect.Effect<never> => {
          throw defect
        }
      })
      const router = Router.make({ routes: [project], layer: MemoryHistory.layer() })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      const exit = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return expect.fail("Expected defect")
      expect(Cause.findErrorOption(exit.cause)).toEqual(Option.none())
      expect(Cause.squash(exit.cause)).toBe(defect)
    }))
})
