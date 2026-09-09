import * as History from "@effect-stack/router/History"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Route from "@effect-stack/router/Route"
import * as Router from "@effect-stack/router/Router"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"

const home = Route.make({
  id: "home",
  path: "/",
  params: {},
  search: {}
})

const project = Route.make({
  id: "project",
  path: "/projects/:projectId",
  params: { projectId: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  hash: Schema.Literals(["", "details"])
})

const makeRegistry = Effect.fn("RouterTest.makeRegistry")(function*() {
  const registry = AtomRegistry.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
  return registry
})

// Runs an `execute` effect with the concrete test registry as service.
const runRegistryEffect = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  self: Effect.Effect<A, E, AtomRegistry.AtomRegistry>
): Effect.Effect<A, E> => Effect.provideService(self, AtomRegistry.AtomRegistry, registry)

describe("Router", () => {
  it.effect("resolves initial state and typed navigation through atoms", () =>
    Effect.gen(function*() {
      const router = Router.make({ routes: [home, project], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      const initial = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(initial.id).toBe("home")

      yield* runRegistryEffect(
        registry,
        router.execute(Router.push(project, {
          params: { projectId: 42 },
          search: { tab: "activity" },
          hash: ""
        }))
      )
      const next = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })

      expect(next.id).toBe("project")
      if (next.id === "project") {
        expect(next.params.projectId).toBe(42)
        expect(next.search.tab).toBe("activity")
      }
      expect(next.location.pathname).toBe("/projects/42")

      yield* runRegistryEffect(
        registry,
        router.execute(Router.replace(project, {
          params: { projectId: 43 },
          search: {},
          hash: ""
        }))
      )
      const replaced = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(replaced.id === "project" && replaced.params.projectId).toBe(43)
      expect(replaced.location.index).toBe(next.location.index)
      expect(replaced.location.key).toBe(next.location.key)
    }))

  it.effect("publishes waiting state before mutating history", () =>
    Effect.gen(function*() {
      const pushStarted = yield* Deferred.make<void>()
      const allowPush = yield* Deferred.make<void>()
      const initial: History.Location = {
        pathname: "/",
        search: "",
        hash: "",
        state: undefined,
        key: "initial",
        index: 0
      }
      const history = History.Service.of({
        current: Effect.succeed(initial),
        push: Effect.fn("RouterTest.pushHistory")(function*(destination) {
          yield* Deferred.succeed(pushStarted, undefined)
          yield* Deferred.await(allowPush)
          return { ...destination, state: destination.state, key: "next", index: 1 }
        }),
        replace: (destination) => Effect.succeed({ ...destination, state: destination.state, key: "next", index: 0 }),
        go: () => Effect.void,
        changes: Stream.empty
      })
      const router = Router.make({ routes: [home, project], layer: Layer.succeed(History.Service, history) })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigation)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })

      const running = yield* Effect.forkScoped(
        runRegistryEffect(
          registry,
          router.execute(Router.push(project, { params: { projectId: 1 }, search: {}, hash: "" }))
        )
      )
      yield* Deferred.await(pushStarted)
      const waiting = registry.get(router.state)
      expect(waiting.waiting).toBe(true)
      expect(AsyncResult.isSuccess(waiting) && waiting.value.id).toBe("home")
      expect(registry.get(router.navigation).waiting).toBe(true)

      yield* Deferred.succeed(allowPush, undefined)
      yield* Fiber.join(running)
      expect(registry.get(router.navigation)._tag).toBe("Success")
    }))

  it.effect("resolves back and forward through the history change stream", () =>
    Effect.gen(function*() {
      const router = Router.make({ routes: [home, project], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })

      yield* runRegistryEffect(
        registry,
        router.execute(Router.push(project, {
          params: { projectId: 1 },
          search: {},
          hash: ""
        }))
      )
      yield* runRegistryEffect(
        registry,
        router.execute(Router.push(project, {
          params: { projectId: 2 },
          search: {},
          hash: ""
        }))
      )

      const previous = yield* AtomRegistry.toStream(registry, router.state).pipe(
        Stream.filter((state) =>
          AsyncResult.isSuccess(state) && state.value.id === "project" && state.value.params.projectId === 1
        ),
        Stream.runHead,
        Effect.forkChild
      )
      yield* Effect.yieldNow
      yield* runRegistryEffect(registry, router.execute(Router.back))
      expect(Option.isSome(yield* Fiber.join(previous))).toBe(true)

      const next = yield* AtomRegistry.toStream(registry, router.state).pipe(
        Stream.filter((state) =>
          AsyncResult.isSuccess(state) && state.value.id === "project" && state.value.params.projectId === 2
        ),
        Stream.runHead,
        Effect.forkChild
      )
      yield* Effect.yieldNow
      yield* runRegistryEffect(registry, router.execute(Router.forward))
      expect(Option.isSome(yield* Fiber.join(next))).toBe(true)
    }))

  it.effect("loads lazy modules only when matched", () =>
    Effect.gen(function*() {
      let loads = 0
      const lazy = Route.make({
        id: "lazy",
        path: "/lazy",
        params: {},
        search: {},
        lazy: () => Effect.sync(() => ({ title: `Loaded ${++loads}` }))
      })
      const router = Router.make({ routes: [home, lazy], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(loads).toBe(0)

      yield* runRegistryEffect(registry, router.execute(Router.push(lazy, { params: {}, search: {}, hash: "" })))
      const resolved = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(resolved.id).toBe("lazy")
      if (resolved.id === "lazy") {
        expect(resolved.module).toEqual({ title: "Loaded 1" })
      }
    }))

  it.effect("supplies Layer services to lazy loaders", () =>
    Effect.gen(function*() {
      class PageTitles extends Context.Service<PageTitles, { readonly project: string }>()("test/PageTitles") {}
      const serviceRoute = Route.make({
        id: "service",
        path: "/service",
        params: {},
        search: {},
        lazy: () => PageTitles.use((titles) => Effect.succeed({ title: titles.project }))
      })
      const router = Router.make({
        routes: [serviceRoute],
        layer: Layer.merge(
          MemoryHistory.layer("/service"),
          Layer.succeed(PageTitles, PageTitles.of({ project: "Layer-powered" }))
        )
      })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      const resolved = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(resolved.module).toEqual({ title: "Layer-powered" })
    }))

  it.effect("associates typed lazy failures with their route", () =>
    Effect.gen(function*() {
      class ExpectedLoadError extends Schema.TaggedError<ExpectedLoadError>()("ExpectedLoadError", {
        message: Schema.String
      }) {}
      const failing = Route.make({
        id: "failing",
        path: "/failing",
        params: {},
        search: {},
        lazy: () => Effect.fail(new ExpectedLoadError({ message: "expected" }))
      })
      const router = Router.make({ routes: [failing], layer: MemoryHistory.layer("/failing") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      const settled = yield* AtomRegistry.toStream(registry, router.state).pipe(
        Stream.filter((state) => !state.waiting && AsyncResult.isFailure(state)),
        Stream.runHead
      )
      expect(Option.isSome(settled)).toBe(true)
      if (Option.isSome(settled) && AsyncResult.isFailure(settled.value)) {
        const failure = Cause.findErrorOption(settled.value.cause)
        expect(Option.isSome(failure) && failure.value).toMatchObject({
          _tag: "RouteLoadError",
          routeId: "failing",
          error: { _tag: "ExpectedLoadError", message: "expected" }
        })
      }
    }))

  it.effect("rejects duplicate route configuration deterministically", () =>
    Effect.gen(function*() {
      const duplicate = Route.make({ id: "home", path: "/other", params: {}, search: {} })
      const router = Router.make({ routes: [home, duplicate], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      const settled = yield* AtomRegistry.toStream(registry, router.state).pipe(
        Stream.filter((state) => !state.waiting && AsyncResult.isFailure(state)),
        Stream.runHead
      )
      expect(Option.isSome(settled)).toBe(true)
      if (Option.isSome(settled) && AsyncResult.isFailure(settled.value)) {
        const failure = Cause.findErrorOption(settled.value.cause)
        expect(Option.isSome(failure) && failure.value).toMatchObject({
          _tag: "@effect-stack/router/RouterConfigurationError"
        })
      }
    }))

  it.effect("rejects duplicate exact path templates", () =>
    Effect.gen(function*() {
      const duplicatePath = Route.make({ id: "other-home", path: "/", params: {}, search: {} })
      const router = Router.make({ routes: [home, duplicatePath], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      const settled = yield* AtomRegistry.toStream(registry, router.state).pipe(
        Stream.filter((state) => !state.waiting && AsyncResult.isFailure(state)),
        Stream.runHead
      )
      expect(Option.isSome(settled)).toBe(true)
    }))

  it.effect("keeps declaration order for equal-ranking templates", () =>
    Effect.gen(function*() {
      // Route IDs are arbitrary strings for flat routers, so an ID with more
      // slashes (the tree ancestry depth key) must not outrank an equal
      // pattern that was declared first.
      const first = Route.make({
        id: "by-slug",
        path: "/items/:slug",
        params: { slug: Schema.String },
        search: {}
      })
      const second = Route.make({
        id: "catalog/by-id",
        path: "/items/:id",
        params: { id: Schema.String },
        search: {}
      })
      const router = Router.make({ routes: [first, second], layer: MemoryHistory.layer("/items/value") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      const resolved = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(resolved.id).toBe("by-slug")
    }))

  it.effect("ranks static segments ahead of dynamic ones for flat routes", () =>
    Effect.gen(function*() {
      const byId = Route.make({
        id: "by-id",
        path: "/users/:id",
        params: { id: Schema.String },
        search: {}
      })
      const newUser = Route.make({
        id: "new-user",
        path: "/users/new",
        params: {},
        search: {}
      })
      // The dynamic route is declared first; the canonical planner still ranks
      // the static endpoint ahead of it, independent of declaration order.
      const router = Router.make({ routes: [byId, newUser], layer: MemoryHistory.layer("/users/new") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      const resolved = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(resolved.id).toBe("new-user")
    }))

  it.effect("reports malformed percent-encoding on a dynamic segment as a typed decode failure", () =>
    Effect.gen(function*() {
      const byId = Route.make({
        id: "by-id",
        path: "/users/:id",
        params: { id: Schema.String },
        search: {}
      })
      const router = Router.make({ routes: [byId], layer: MemoryHistory.layer("/users/%zz") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      const settled = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(
        Effect.exit
      )
      expect(Exit.isFailure(settled)).toBe(true)
      if (Exit.isFailure(settled)) {
        const failure = Cause.findErrorOption(settled.cause)
        expect(Option.isSome(failure) && failure.value).toMatchObject({
          _tag: "@effect-stack/router/RouteDecodeError",
          part: "path"
        })
      }
    }))

  it.effect("does not match malformed percent-encoding against a static segment", () =>
    Effect.gen(function*() {
      const fixed = Route.make({ id: "cafe", path: "/café/100%", params: {}, search: {} })
      const router = Router.make({ routes: [fixed], layer: MemoryHistory.layer("/caf%zz/100%25") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      // Malformed encoding never matches the static candidate, so no route
      // answers the URL and the navigation settles as not-found.
      const settled = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(
        Effect.exit
      )
      expect(Exit.isFailure(settled)).toBe(true)
      if (Exit.isFailure(settled)) {
        const failure = Cause.findErrorOption(settled.cause)
        expect(Option.isSome(failure) && failure.value).toMatchObject({
          _tag: "@effect-stack/router/RouteNotFound"
        })
      }
    }))

  it.effect("keeps covering entries in a flat not-found branch", () =>
    Effect.gen(function*() {
      const users = Route.make({ id: "users", path: "/users", params: {}, search: {} })
      const router = Router.make({ routes: [home, users], layer: MemoryHistory.layer("/users/123") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.branch)
      const settled = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(
        Effect.exit
      )
      expect(Exit.isFailure(settled)).toBe(true)
      // Like the tree model, the answered prefix stays observable in the branch.
      const branch = registry.get(router.branch)
      expect(branch.notFound).toBe(true)
      expect(branch.matches.map((entry) => entry.routeId)).toEqual(["users"])
      expect(Option.map(branch.location, (value) => value.pathname)).toEqual(Option.some("/users/123"))
    }))

  it.effect("interrupts superseded navigation and never commits stale state", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const finalized = yield* Deferred.make<void>()
      let finalizations = 0
      const loadSlow = Effect.fn("RouterTest.loadSlow")(function*() {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            finalizations++
          }).pipe(Effect.andThen(Deferred.succeed(finalized, undefined)))
        )
        yield* Deferred.succeed(started, undefined)
        return yield* Effect.never
      })
      const slow = Route.make({
        id: "slow",
        path: "/slow",
        params: {},
        search: {},
        lazy: loadSlow
      })
      const router = Router.make({ routes: [home, slow], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })

      const superseded = yield* Effect.forkScoped(
        runRegistryEffect(registry, router.execute(Router.push(slow, { params: {}, search: {}, hash: "" })))
      )
      yield* Deferred.await(started)
      yield* runRegistryEffect(registry, router.execute(Router.push(home, { params: {}, search: {}, hash: "" })))

      yield* Deferred.await(finalized)
      expect(finalizations).toBe(1)
      const supersededExit = yield* Effect.exit(Fiber.join(superseded))
      expect(Exit.isFailure(supersededExit) && Cause.hasInterruptsOnly(supersededExit.cause)).toBe(true)
      const resolved = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(resolved.id).toBe("home")
    }))

  it.effect("ignores stale non-cancelable Promise success and failure", () =>
    Effect.gen(function*() {
      let startSuccess!: () => void
      let completeSuccess!: () => void
      const successStarted = new Promise<void>((resolve) => {
        startSuccess = resolve
      })
      const successCompletion = new Promise<{ readonly title: "stale success" }>((resolve) => {
        completeSuccess = () => resolve({ title: "stale success" })
      })
      let startFailure!: () => void
      let completeFailure!: () => void
      const failureStarted = new Promise<void>((resolve) => {
        startFailure = resolve
      })
      const failureCompletion = new Promise<never>((_resolve, reject) => {
        completeFailure = () => reject("stale failure")
      })
      const staleSuccess = Route.make({
        id: "stale-success",
        path: "/stale-success",
        params: {},
        search: {},
        lazy: Effect.fn("RouterTest.loadStaleSuccess")(function*() {
          startSuccess()
          return yield* Effect.promise(() => successCompletion)
        })
      })
      const staleFailure = Route.make({
        id: "stale-failure",
        path: "/stale-failure",
        params: {},
        search: {},
        lazy: Effect.fn("RouterTest.loadStaleFailure")(function*() {
          startFailure()
          return yield* Effect.tryPromise({
            try: () => failureCompletion,
            catch: (error) => String(error)
          })
        })
      })
      const router = Router.make({
        routes: [home, staleSuccess, staleFailure],
        layer: MemoryHistory.layer("/")
      })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigation)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })

      const staleSuccessRun = yield* Effect.forkScoped(
        runRegistryEffect(registry, router.execute(Router.push(staleSuccess, { params: {}, search: {}, hash: "" })))
      )
      yield* Effect.promise(() => successStarted)
      yield* runRegistryEffect(registry, router.execute(Router.push(home, { params: {}, search: {}, hash: "" })))
      yield* Fiber.join(staleSuccessRun).pipe(Effect.exit)
      completeSuccess()
      yield* Effect.promise(() => successCompletion)
      yield* Effect.yieldNow
      expect((yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })).id).toBe("home")

      const staleFailureRun = yield* Effect.forkScoped(
        runRegistryEffect(registry, router.execute(Router.push(staleFailure, { params: {}, search: {}, hash: "" })))
      )
      yield* Effect.promise(() => failureStarted)
      yield* runRegistryEffect(registry, router.execute(Router.push(home, { params: {}, search: {}, hash: "" })))
      yield* Fiber.join(staleFailureRun).pipe(Effect.exit)
      completeFailure()
      yield* Effect.promise(() => failureCompletion.catch(() => undefined))
      yield* Effect.yieldNow
      expect((yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })).id).toBe("home")
    }))

  it.effect("disposal interrupts active navigation", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const finalized = yield* Deferred.make<void>()
      const slow = Route.make({
        id: "dispose-slow",
        path: "/dispose-slow",
        params: {},
        search: {},
        lazy: Effect.fn("RouterTest.loadUntilDisposed")(function*() {
          yield* Effect.addFinalizer(() => Deferred.succeed(finalized, undefined))
          yield* Deferred.succeed(started, undefined)
          return yield* Effect.never
        })
      })
      const router = Router.make({ routes: [slow], layer: MemoryHistory.layer("/dispose-slow") })
      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      registry.mount(router.state)

      yield* Deferred.await(started)
      registry.dispose()
      yield* Deferred.await(finalized)
    }))

  it.effect("surfaces malformed initial locations as typed state failures", () =>
    Effect.gen(function*() {
      const router = Router.make({ routes: [project], layer: MemoryHistory.layer("/projects/not-a-number") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      const settled = yield* AtomRegistry.toStream(registry, router.state).pipe(
        Stream.filter((state) => !state.waiting && !AsyncResult.isInitial(state)),
        Stream.runHead
      )
      expect(Option.isSome(settled)).toBe(true)
      if (Option.isSome(settled)) {
        expect(AsyncResult.isFailure(settled.value)).toBe(true)
      }
    }))

  it.effect.each(
    [
      ["/projects/1?tab=unknown", "search"],
      ["/projects/1#unknown", "hash"]
    ] as const
  )("identifies a malformed %s transition", ([href, part]) =>
    Effect.gen(function*() {
      const router = Router.make({ routes: [project], layer: MemoryHistory.layer(href) })
      const registry = AtomRegistry.make()
      registry.mount(router.state)
      const settled = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true }).pipe(
        Effect.exit
      )
      registry.dispose()
      if (Exit.isFailure(settled)) {
        const failure = Cause.findErrorOption(settled.cause)
        expect(Option.isSome(failure) && failure.value).toMatchObject({
          _tag: "@effect-stack/router/RouteDecodeError",
          part
        })
      } else {
        expect.fail(`Expected ${part} failure`)
      }
    }))
})
