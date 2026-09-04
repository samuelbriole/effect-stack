import * as MemoryHistory from "@effect-web/router/MemoryHistory"
import * as Route from "@effect-web/router/Route"
import * as Router from "@effect-web/router/Router"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
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
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) }
})

const makeRegistry = Effect.fn("RouterTest.makeRegistry")(function*() {
  const registry = AtomRegistry.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
  return registry
})

describe("Router", () => {
  it.effect("resolves initial state and typed navigation through atoms", () =>
    Effect.gen(function*() {
      const router = Router.make({ routes: [home, project], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)

      const initial = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(initial.id).toBe("home")

      registry.set(
        router.navigate,
        Router.push(project, {
          params: { projectId: 42 },
          search: { tab: "activity" },
          hash: ""
        })
      )
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
      const next = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })

      expect(next.id).toBe("project")
      if (next.id === "project") {
        expect(next.params.projectId).toBe(42)
        expect(next.search.tab).toBe("activity")
      }
      expect(next.location.pathname).toBe("/projects/42")
    }))

  it.effect("resolves back and forward through the history change stream", () =>
    Effect.gen(function*() {
      const router = Router.make({ routes: [home, project], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })

      registry.set(
        router.navigate,
        Router.push(project, {
          params: { projectId: 1 },
          search: {},
          hash: ""
        })
      )
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
      registry.set(
        router.navigate,
        Router.push(project, {
          params: { projectId: 2 },
          search: {},
          hash: ""
        })
      )
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })

      const previous = yield* AtomRegistry.toStream(registry, router.state).pipe(
        Stream.filter((state) =>
          AsyncResult.isSuccess(state) && state.value.id === "project" && state.value.params.projectId === 1
        ),
        Stream.runHead,
        Effect.forkChild
      )
      yield* Effect.yieldNow
      registry.set(router.navigate, Router.back)
      expect(Option.isSome(yield* Fiber.join(previous))).toBe(true)

      const next = yield* AtomRegistry.toStream(registry, router.state).pipe(
        Stream.filter((state) =>
          AsyncResult.isSuccess(state) && state.value.id === "project" && state.value.params.projectId === 2
        ),
        Stream.runHead,
        Effect.forkChild
      )
      yield* Effect.yieldNow
      registry.set(router.navigate, Router.forward)
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
        load: () => Effect.sync(() => ({ title: `Loaded ${++loads}` }))
      })
      const router = Router.make({ routes: [home, lazy], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(loads).toBe(0)

      registry.set(router.navigate, Router.push(lazy, { params: {}, search: {}, hash: "" }))
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
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
        load: () => PageTitles.use((titles) => Effect.succeed({ title: titles.project }))
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
        load: () => Effect.fail(new ExpectedLoadError({ message: "expected" }))
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
          _tag: "@effect-web/router/RouterConfigurationError"
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

  it.effect("uses declaration order for ambiguous templates", () =>
    Effect.gen(function*() {
      const first = Route.make({
        id: "by-id",
        path: "/items/:id",
        params: { id: Schema.String },
        search: {}
      })
      const second = Route.make({
        id: "by-slug",
        path: "/items/:slug",
        params: { slug: Schema.String },
        search: {}
      })
      const router = Router.make({ routes: [first, second], layer: MemoryHistory.layer("/items/value") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)

      const resolved = yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })
      expect(resolved.id).toBe("by-id")
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
        load: loadSlow
      })
      const router = Router.make({ routes: [home, slow], layer: MemoryHistory.layer("/") })
      const registry = yield* makeRegistry()
      yield* AtomRegistry.mount(registry, router.state)
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })

      registry.set(router.navigate, Router.push(slow, { params: {}, search: {}, hash: "" }))
      yield* Deferred.await(started)
      registry.set(router.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))

      yield* Deferred.await(finalized)
      expect(finalizations).toBe(1)
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
        load: Effect.fn("RouterTest.loadStaleSuccess")(function*() {
          startSuccess()
          return yield* Effect.promise(() => successCompletion)
        })
      })
      const staleFailure = Route.make({
        id: "stale-failure",
        path: "/stale-failure",
        params: {},
        search: {},
        load: Effect.fn("RouterTest.loadStaleFailure")(function*() {
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
      yield* AtomRegistry.mount(registry, router.navigate)
      yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })

      registry.set(router.navigate, Router.push(staleSuccess, { params: {}, search: {}, hash: "" }))
      yield* Effect.promise(() => successStarted)
      registry.set(router.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
      completeSuccess()
      yield* Effect.promise(() => successCompletion)
      yield* Effect.yieldNow
      expect((yield* AtomRegistry.getResult(registry, router.state, { suspendOnWaiting: true })).id).toBe("home")

      registry.set(router.navigate, Router.push(staleFailure, { params: {}, search: {}, hash: "" }))
      yield* Effect.promise(() => failureStarted)
      registry.set(router.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))
      yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
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
        load: Effect.fn("RouterTest.loadUntilDisposed")(function*() {
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
})
