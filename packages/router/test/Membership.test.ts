import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { MemoryHistory, Route, Router } from "@effect-stack/router"
import * as AtomRouter from "@effect-stack/router/AtomRouter"

const Project = Schema.Struct({ title: Schema.String })

const makeProject = <const CollectionId extends string>(collectionId: CollectionId) =>
  Router.make(collectionId).add(
    Route.make("project", "/projects/:projectId", {
      params: { projectId: Schema.FiniteFromString },
      success: Project
    })
  )

describe("contract membership", () => {
  it.effect("rejects foreign destinations before writing history", () =>
    Effect.gen(function* () {
      const A = makeProject("A")
      const B = makeProject("B")
      const ALive = Router.route(A.project, () => Effect.succeed({ title: "a" }))
      const app = Router.layer(A).pipe(Layer.provide(ALive), Layer.provide(MemoryHistory.layer("/")))

      yield* Effect.gen(function* () {
        const router = yield* A.service
        yield* router.awaitInitial.pipe(Effect.exit)
        const foreign = B.project({ params: { projectId: 1 } }) as never
        const error = yield* Effect.flip(router.navigate(foreign))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
        const state = yield* router.state
        expect(Option.getOrThrow(state.location).pathname).toBe("/")
        expect(Result.isFailure(router.href(foreign))).toBe(true)
        const submitError = yield* Effect.flip(router.submit(foreign))
        expect(submitError).toBeInstanceOf(Router.RouteEncodeError)
        expect(Result.isSuccess(Router.href(B.project({ params: { projectId: 1 } })))).toBe(true)
        expect(Result.isSuccess(router.href(A.project({ params: { projectId: 1 } })))).toBe(true)
      }).pipe(Effect.provide(app))
    })
  )

  it.effect("keeps base references valid and rejects extension-only destinations in the base", () =>
    Effect.gen(function* () {
      const Base = makeProject("App")
      const ProjectLive = Router.route(Base.project, () => Effect.succeed({ title: "base" }))
      const Extended = Base.add(Route.make("home", "/"))
      const extendedApp = Router.layer(Extended).pipe(
        Layer.provide(ProjectLive),
        Layer.provide(MemoryHistory.layer("/"))
      )
      const baseApp = Router.layer(Base).pipe(Layer.provide(ProjectLive), Layer.provide(MemoryHistory.layer("/")))

      yield* Effect.gen(function* () {
        const router = yield* Extended.service
        expect(yield* router.navigate(Base.project({ params: { projectId: 1 } }))).toBe("Committed")
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        const entry = presentation.entries.find((candidate) => candidate.id === "project")
        expect(entry === undefined ? undefined : AsyncResult.value(entry.data)).toEqual(Option.some({ title: "base" }))
      }).pipe(Effect.provide(extendedApp))

      yield* Effect.gen(function* () {
        const router = yield* Base.service
        const error = yield* Effect.flip(router.navigate(Extended.home() as never))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
      }).pipe(Effect.provide(baseApp))
    })
  )

  it.effect("shares old nodes but not additions between forked extensions", () =>
    Effect.gen(function* () {
      const Base = makeProject("App")
      const ProjectLive = Router.route(Base.project, () => Effect.succeed({ title: "base" }))
      const Left = Base.add(Route.make("left", "/left"))
      const Right = Base.add(Route.make("right", "/right"))
      const leftApp = Router.layer(Left).pipe(Layer.provide(ProjectLive), Layer.provide(MemoryHistory.layer("/")))

      yield* Effect.gen(function* () {
        const router = yield* Left.service
        expect(yield* router.navigate(Base.project({ params: { projectId: 2 } }))).toBe("Committed")
        const error = yield* Effect.flip(router.navigate(Right.right() as never))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
      }).pipe(Effect.provide(leftApp))
    })
  )

  it.effect("detects an implementation bound to a different contract version", () =>
    Effect.gen(function* () {
      const V1 = makeProject("App")
      const V2 = makeProject("App")
      const Impl = Router.route(V2.project, () => Effect.succeed({ title: "v2" }))
      const app = Router.layer(V1).pipe(Layer.provide(Impl), Layer.provide(MemoryHistory.layer("/")))
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          yield* V1.service
        }).pipe(Effect.provide(app))
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(true)
    })
  )

  it.effect("rejects foreign redirects before replacing history", () =>
    Effect.gen(function* () {
      const A = Router.make("A").add(Route.make("go", "/go", { success: Schema.Void }))
      const B = makeProject("B")
      const GoLive = Router.route(A.go, () =>
        Effect.fail(Router.redirect(B.project({ params: { projectId: 1 } })) as never)
      )
      const app = Router.layer(A).pipe(Layer.provide(GoLive), Layer.provide(MemoryHistory.layer("/")))

      yield* Effect.gen(function* () {
        const router = yield* A.service
        const error = yield* Effect.flip(router.navigate(A.go()))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
        const state = yield* router.state
        // The command's own accepted write remains; the foreign redirect must
        // not have replaced history with its target.
        expect(Option.getOrThrow(state.location).pathname).toBe("/go")
        const presentation = Option.getOrThrow(state.presentation)
        expect(presentation._tag).toBe("Failed")
        if (presentation._tag === "Failed") expect(presentation.owner).toBe("go")
      }).pipe(Effect.provide(app))
    })
  )

  it.effect("rejects foreign Atom projections and hrefs synchronously", () =>
    Effect.gen(function* () {
      const A = makeProject("A")
      const B = makeProject("B")
      const ALive = Router.route(A.project, () => Effect.succeed({ title: "a" }))
      const runtime = Atom.runtime(Router.layer(A).pipe(Layer.provide(ALive), Layer.provide(MemoryHistory.layer("/"))))
      const atomRouter = AtomRouter.make(runtime, A)
      expect(Result.isFailure(atomRouter.href(B.project({ params: { projectId: 1 } }) as never))).toBe(true)
      expect(Result.isSuccess(atomRouter.href(A.project({ params: { projectId: 1 } })))).toBe(true)
      expect(() => atomRouter.route(B.project)).toThrow(Router.RouteDefinitionError)
    })
  )

  it.effect("fails Atom startup when the runtime contract version differs", () =>
    Effect.gen(function* () {
      const Base = makeProject("App")
      const Extended = Base.add(Route.make("home", "/"))
      const Impl = Router.route(Base.project, () => Effect.succeed({ title: "base" }))
      const runtime = Atom.runtime(
        Router.layer(Extended).pipe(Layer.provide(Impl), Layer.provide(MemoryHistory.layer("/")))
      )
      const atomRouter = AtomRouter.make(runtime, Base)
      const registry = AtomRegistry.make()
      const exit = yield* Effect.exit(AtomRegistry.getResult(registry, atomRouter.service))
      expect(Exit.isFailure(exit)).toBe(true)
    })
  )
})
