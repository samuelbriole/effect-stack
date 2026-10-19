import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import type * as AsyncResult from "effect/reactivity/AsyncResult"
import { MemoryHistory, Router } from "@effect-stack/router"
import * as AtomRouter from "@effect-stack/router/AtomRouter"

const makeProject = () =>
  Router.route("project", "/projects/:projectId", {
    params: { projectId: Schema.FiniteFromString },
    prepare: () => Effect.void
  })

describe("application membership", () => {
  it.live("uses the same href codecs before and after service acquisition", () =>
    Effect.gen(function* () {
      const Home = Router.route("home", "/")
      const Project = Router.route("project", "/projects/:projectId", {
        params: { projectId: Schema.FiniteFromString },
        search: { query: Schema.String },
        hash: Schema.FiniteFromString
      })
      const App = yield* Router.make("HrefCodecs", [Home, Project])
      const runtime = Atom.runtime(Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/"))))
      const atoms = AtomRouter.make(runtime, App)
      const valid = Project.to({ params: { projectId: 7 }, search: { query: "a b&c" }, hash: 9 })
      const destinations = [
        valid,
        Project.to({ params: { projectId: "invalid" }, search: { query: "ok" }, hash: 9 } as never),
        Project.to({ params: { projectId: 7 }, search: { query: 1 }, hash: 9 } as never),
        Project.to({ params: { projectId: 7 }, search: { query: "ok" }, hash: "invalid" } as never)
      ]
      const encoded = destinations.map((destination) => atoms.href(destination))
      expect(Result.getOrThrow(atoms.href(valid))).toBe("/projects/7?query=a+b%26c#9")
      for (const result of encoded.slice(1)) expect(Result.isFailure(result)).toBe(true)

      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      const router = yield* AtomRegistry.getResult(registry, atoms.service)
      yield* router.awaitInitial
      for (const [index, destination] of destinations.entries()) {
        expect(Router.href(destination)).toEqual(encoded[index])
        expect(router.href(destination)).toEqual(encoded[index])
        expect(atoms.href(destination)).toEqual(encoded[index])
      }
    })
  )

  it.live("checks exact destination membership before accessing codecs", () =>
    Effect.gen(function* () {
      const Home = Router.route("home", "/")
      const Project = makeProject()
      const Foreign = makeProject()
      const App = yield* Router.make("HrefMembership", [Home, Project])
      const runtime = Atom.runtime(Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/"))))
      const atoms = AtomRouter.make(runtime, App)
      const destination = Project.to({ params: { projectId: 1 } })
      const copied = {
        ...destination,
        node: {
          ...destination.node,
          get paramsSchema(): Router.RuntimeNode["paramsSchema"] {
            throw new Error("A foreign node's codec must not be read")
          }
        }
      }
      const foreign = Foreign.to({ params: { projectId: "invalid" } } as never)
      const failures = [foreign, copied].map((target) => atoms.href(target))
      for (const result of failures) {
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({
            _tag: "@effect-stack/router/RouteEncodeError",
            routeId: Project.id,
            part: "path",
            message: "Destination does not belong to this router selection"
          })
        }
      }
      expect(Result.isSuccess(Router.href(Foreign.to({ params: { projectId: 1 } })))).toBe(true)

      const registry = AtomRegistry.make()
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
      const router = yield* AtomRegistry.getResult(registry, atoms.service)
      yield* router.awaitInitial
      const before = yield* router.state
      for (const [index, target] of [foreign, copied].entries()) {
        expect(router.href(target)).toEqual(failures[index])
        const error = yield* Effect.flip(router.submit(target))
        expect(Result.fail(error)).toEqual(failures[index])
        expect(yield* router.state).toStrictEqual(before)
      }
    })
  )

  it.effect("rejects foreign destinations before writing history", () =>
    Effect.gen(function* () {
      const AProject = makeProject()
      const BProject = makeProject()
      const App = yield* Router.make("A", [AProject])
      const app = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))

      yield* Effect.gen(function* () {
        const router = yield* App.service
        yield* router.awaitInitial.pipe(Effect.exit)
        const before = yield* router.state
        const foreign = BProject.to({ params: { projectId: 1 } }) as never
        const error = yield* Effect.flip(router.navigate(foreign))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
        const state = yield* router.state
        expect(Option.getOrThrow(state.location).pathname).toBe("/")
        expect(Result.isFailure(router.href(foreign))).toBe(true)
        const submitError = yield* Effect.flip(router.submit(foreign))
        expect(submitError).toBeInstanceOf(Router.RouteEncodeError)
        expect(yield* router.state).toStrictEqual(before)
        expect((yield* router.state).status).toBe(before.status)
        expect(Result.isSuccess(Router.href(BProject.to({ params: { projectId: 1 } })))).toBe(true)
        expect(Result.isSuccess(router.href(AProject.to({ params: { projectId: 1 } })))).toBe(true)
      }).pipe(Effect.provide(app))
    })
  )

  it.effect("keeps base references valid and rejects extension-only destinations in the base", () =>
    Effect.gen(function* () {
      const Project = makeProject()
      const Home = Router.route("home", "/")
      const Extended = yield* Router.make("App", [Project, Home])
      const Base = yield* Router.make("App", [Project])
      const extendedApp = Extended.layer.pipe(Layer.provide(MemoryHistory.layer("/")))
      const baseApp = Base.layer.pipe(Layer.provide(MemoryHistory.layer("/")))

      yield* Effect.gen(function* () {
        const router = yield* Extended.service
        expect(yield* router.navigate(Project.to({ params: { projectId: 1 } }))).toBe("Committed")
        const state = yield* router.state
        const presentation = Option.getOrThrow(state.presentation)
        if (presentation._tag !== "Resolved") throw new Error("expected a resolved presentation")
        const entry = presentation.entries.find((candidate) => candidate.id === "project")
        expect(entry !== undefined && Result.getOrThrow(entry.input).params).toEqual({ projectId: 1 })
      }).pipe(Effect.provide(extendedApp))

      yield* Effect.gen(function* () {
        const router = yield* Base.service
        const error = yield* Effect.flip(router.navigate(Home.to() as never))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
      }).pipe(Effect.provide(baseApp))
    })
  )

  it.effect("keeps independent definitions isolated between applications", () =>
    Effect.gen(function* () {
      const Left = makeProject()
      const Right = Router.route("right", "/right")
      const LeftApp = yield* Router.make("App", [Left])
      const leftApp = LeftApp.layer.pipe(Layer.provide(MemoryHistory.layer("/")))

      yield* Effect.gen(function* () {
        const router = yield* LeftApp.service
        expect(yield* router.navigate(Left.to({ params: { projectId: 2 } }))).toBe("Committed")
        const error = yield* Effect.flip(router.navigate(Right.to() as never))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
      }).pipe(Effect.provide(leftApp))
    })
  )

  it("rejects an untrusted spread definition", () => {
    const Project = makeProject()
    const forged = { ...Project } as typeof Project
    expect(Effect.runSyncExit(Router.make("App", [forged]))).toMatchObject({
      _tag: "Failure",
      cause: { reasons: [{ _tag: "Die", defect: expect.any(Router.RouteDefinitionError) as unknown }] }
    })
  })

  it.effect("rejects foreign redirects before replacing history", () =>
    Effect.gen(function* () {
      const Go = Router.route("go", "/go", { prepare: () => Effect.void })
      const Foreign = makeProject()
      const A = Router.route("redirecting", "/redirecting", {
        prepare: () => Effect.fail(Router.redirect(Foreign.to({ params: { projectId: 1 } })) as never)
      })
      const App = yield* Router.make("A", [Go, A])
      const app = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))

      yield* Effect.gen(function* () {
        const router = yield* App.service
        const error = yield* Effect.flip(router.navigate(A.to()))
        expect(error).toBeInstanceOf(Router.RouteEncodeError)
        const state = yield* router.state
        expect(Option.getOrThrow(state.location).pathname).toBe("/redirecting")
        const presentation = Option.getOrThrow(state.presentation)
        expect(presentation._tag).toBe("Failed")
        if (presentation._tag === "Failed") expect(presentation.owner).toBe("redirecting")
      }).pipe(Effect.provide(app))
    })
  )

  it.effect("rejects foreign Atom projections and hrefs synchronously", () =>
    Effect.gen(function* () {
      const AProject = makeProject()
      const BProject = makeProject()
      const App = yield* Router.make("A", [AProject])
      const runtime = Atom.runtime(Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer("/"))))
      const atomRouter = AtomRouter.make(runtime, App)
      expect(Result.isFailure(atomRouter.href(BProject.to({ params: { projectId: 1 } }) as never))).toBe(true)
      expect(Result.isSuccess(atomRouter.href(AProject.to({ params: { projectId: 1 } })))).toBe(true)
      expect(() => atomRouter.route(BProject)).toThrow(Router.RouteDefinitionError)
    })
  )

  it.effect.each(["service", "state"] as const)(
    "fails Atom %s startup when the runtime application identity differs",
    (projection) =>
      Effect.gen(function* () {
        const Project = makeProject()
        const First = yield* Router.make("App", [Project])
        const Second = yield* Router.make("App", [Project])
        const runtime = Atom.runtime(Router.layer(Effect.succeed(First)).pipe(Layer.provide(MemoryHistory.layer("/"))))
        const atomRouter = AtomRouter.make(runtime, Second)
        const registry = AtomRegistry.make()
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
        const atom: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>> = atomRouter[projection]
        const exit = yield* Effect.exit(AtomRegistry.getResult(registry, atom))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(
            exit.cause.reasons.some(
              (reason) => Cause.isDieReason(reason) && reason.defect instanceof Router.RouteDefinitionError
            )
          ).toBe(true)
        }
      })
  )
})
