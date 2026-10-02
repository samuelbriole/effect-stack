import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { MemoryHistory, Router } from "@effect-stack/router"

class MissingProject extends Schema.TaggedError<MissingProject>()("MissingProject", { projectId: Schema.Number }) {}

const log: Array<string> = []

const Home = Router.route("home", "/")

const Accounts = Router.layout("accounts", "/accounts", {
  prepare: () =>
    Effect.sync(() => {
      log.push("accounts")
    })
})

const AccountDetail = Accounts.route("detail", "/:accountId", {
  params: { accountId: Schema.FiniteFromString },
  prepare: ({ params }) =>
    Effect.sync(() => {
      log.push("detail")
      void params.accountId
    })
})

const Teams = Router.layout("teams", "/teams", { prepare: () => Effect.void })

const TeamMember = Teams.route("member", "/:memberId", {
  params: { memberId: Schema.FiniteFromString },
  prepare: ({ params }) => Effect.fail(new MissingProject({ projectId: params.memberId }))
})

const Project = Router.route("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.String) },
  prepare: ({ params }) =>
    Effect.sync(() => {
      log.push(`project:${params.projectId}`)
    })
})

const Redirecting = Router.route("redirecting", "/redirecting", {
  prepare: () => Effect.fail(Router.redirect(Project.to({ params: { projectId: 9 } })))
})

// A redirect combined with a finalizer defect is not a pure redirect signal.
const RedirectBadRelease = Router.route("redirectBadRelease", "/redirect-bad-release", {
  prepare: () =>
    Effect.acquireRelease(Effect.void, () => Effect.die(new Error("redirect-release-boom"))).pipe(
      Effect.andThen(Effect.fail(Router.redirect(Project.to({ params: { projectId: 5 } }))))
    )
})

const Boom = Router.route("boom", "/boom", {
  prepare: () => Effect.fail(new MissingProject({ projectId: 1 }))
})

const loopTargets: { loopy?: Router.Destination<unknown>; loopb?: Router.Destination<unknown> } = {}
const Loopa = Router.route("loopa", "/loopa", {
  prepare: () => Effect.fail(Router.redirect(loopTargets.loopb as Router.Destination<unknown>))
})
const Loopb = Router.route("loopb", "/loopb", {
  prepare: () => Effect.fail(Router.redirect(loopTargets.loopy as Router.Destination<unknown>))
})
loopTargets.loopy = Loopa.to()
loopTargets.loopb = Loopb.to()

const App = await Effect.runPromise(
  Router.make("Nav", [Home, AccountDetail, TeamMember, Project, Redirecting, RedirectBadRelease, Boom, Loopa, Loopb])
)

const makeApp = (initial: string) => App.layer.pipe(Layer.provide(MemoryHistory.layer(initial)))

const entryOf = (state: Router.RouterState<unknown>, id: string) => {
  const presentation = Option.getOrThrow(state.presentation)
  if (presentation._tag === "Pending") throw new Error("expected a settled presentation")
  const entry = presentation.entries.find((candidate) => candidate.id === id)
  if (entry === undefined) throw new Error(`missing entry ${id}`)
  return entry
}

describe("Router navigation", () => {
  it.effect("resolves the initial location without failing the Layer", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      expect(presentation._tag).toBe("Resolved")
      expect(Result.getOrThrow(entryOf(state, "home").input).params).toEqual({})
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("runs ancestor layout gates before descendants", () =>
    Effect.gen(function* () {
      log.length = 0
      const router = yield* App.service
      yield* router.navigate(AccountDetail.to({ params: { accountId: 5 } }))
      expect(log).toEqual(["accounts", "detail"])
      const state = yield* router.state
      expect(Result.getOrThrow(entryOf(state, "accounts").input).params).toEqual({})
      expect(Result.getOrThrow(entryOf(state, "accounts.detail").input).params).toEqual({ accountId: 5 })
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("encodes and decodes destinations with search", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      const outcome = yield* router.navigate(Project.to({ params: { projectId: 7 }, search: { tab: "activity" } }))
      expect(outcome).toBe("Committed")
      const state = yield* router.state
      const entry = entryOf(state, "project")
      expect(Result.getOrThrow(entry.input)).toMatchObject({ search: { tab: "activity" } })
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("publishes typed domain failures against their owning node and keeps the router usable", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      const error = yield* Effect.flip(router.navigate(Boom.to()))
      expect(error).toBeInstanceOf(MissingProject)
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
      expect(presentation.owner).toBe("boom")
      const entry = presentation.entries.find((candidate) => candidate.id === "boom")
      expect(entry).toBeDefined()
      if (entry !== undefined) {
        expect(Option.isSome(entry.failure)).toBe(true)
        if (Option.isSome(entry.failure)) {
          expect(Cause.squash(entry.failure.value)).toBeInstanceOf(MissingProject)
        }
      }
      const recovered = yield* router.navigate(Project.to({ params: { projectId: 3 } }))
      expect(recovered).toBe("Committed")
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("attributes a failed child while keeping its prepared ancestor", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      const error = yield* Effect.flip(router.navigate(TeamMember.to({ params: { memberId: 8 } })))
      expect(error).toBeInstanceOf(MissingProject)
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
      expect(presentation.owner).toBe("teams.member")
      expect(Result.getOrThrow(entryOf(state, "teams").input).params).toEqual({})
      expect(Option.isNone(entryOf(state, "teams").failure)).toBe(true)
      const member = presentation.entries.find((candidate) => candidate.id === "teams.member")
      expect(member !== undefined && Option.isSome(member.failure)).toBe(true)
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("publishes an unknown initial location instead of waiting forever", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial.pipe(Effect.exit)
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
      expect(presentation.owner).toBe("<notfound>")
      const location = Option.getOrThrow(state.location)
      expect(location.pathname).toBe("/missing")
    }).pipe(Effect.provide(makeApp("/missing")))
  )

  it.effect("does not plan or prepare endpoint prefixes for an unmatched location", () =>
    Effect.gen(function* () {
      let preparations = 0
      const Parent = Router.layout("parent", "/parent", {
        prepare: () =>
          Effect.sync(() => {
            preparations++
          })
      })
      const Endpoint = Parent.route("overview", "/", {
        prepare: () =>
          Effect.sync(() => {
            preparations++
          })
      })
      const LocalApp = yield* Router.make("ExactEndpoints", [Endpoint])
      yield* Effect.gen(function* () {
        const router = yield* LocalApp.service
        expect(yield* Effect.flip(router.awaitInitial)).toBeInstanceOf(Router.RouteNotFound)
        const presentation = Option.getOrThrow((yield* router.state).presentation)
        if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
        expect(presentation.entries).toEqual([])
        expect(preparations).toBe(0)
        expect(yield* router.navigate(Endpoint.to())).toBe("Committed")
        expect(preparations).toBe(2)
      }).pipe(Effect.provide(LocalApp.layer.pipe(Layer.provide(MemoryHistory.layer("/parent/unknown")))))
    })
  )

  it.effect("publishes an unknown traversed location against that location", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.awaitInitial.pipe(Effect.exit)
      yield* router.navigate(Project.to({ params: { projectId: 12 } }))
      yield* router.back
      let presentation = Option.getOrUndefined((yield* router.state).presentation)
      for (let index = 0; index < 200; index++) {
        const state = yield* router.state
        presentation = Option.getOrUndefined(state.presentation)
        if (presentation?._tag === "Failed" && presentation.owner === "<notfound>") break
        yield* Effect.yieldNow
      }
      if (presentation === undefined || presentation._tag !== "Failed") {
        throw new Error("expected a failed presentation after traversal")
      }
      expect(presentation.owner).toBe("<notfound>")
      const location = Option.getOrThrow((yield* router.state).location)
      expect(location.pathname).toBe("/missing")
    }).pipe(Effect.provide(makeApp("/missing")))
  )

  it.effect("follows redirects within one attempt and replaces history", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      const outcome = yield* router.navigate(Redirecting.to())
      expect(outcome).toBe("Committed")
      const state = yield* router.state
      expect(Result.getOrThrow(entryOf(state, "project").input).params).toEqual({ projectId: 9 })
      const location = Option.getOrThrow(state.location)
      expect(location.pathname).toBe("/projects/9")
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("does not consume a redirect combined with a finalizer defect", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      const exit = yield* Effect.exit(router.navigate(RedirectBadRelease.to()))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(true)
        expect(exit.cause.reasons.some(Cause.isFailReason)).toBe(true)
      }
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
      expect(presentation.owner).toBe("redirectBadRelease")
      expect(presentation.entries.some((entry) => entry.id === "project")).toBe(false)
    }).pipe(Effect.provide(makeApp("/")))
  )

  it("generates canonical hrefs", () => {
    expect(Result.getOrThrow(Router.href(AccountDetail.to({ params: { accountId: 3 } })))).toBe("/accounts/3")
    expect(Result.getOrThrow(Router.href(Project.to({ params: { projectId: 4 }, search: {} })))).toBe("/projects/4")
  })

  it.effect("rejects redirect loops with a useful failure", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      const error = yield* Effect.flip(router.navigate(Loopa.to()))
      expect(error).toBeInstanceOf(Router.RouteDefinitionError)
      expect((error as Error).message).toContain("Redirect loop")
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("acknowledges traversal and prepares the destination", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      yield* router.navigate(Project.to({ params: { projectId: 11 } }))
      yield* router.back
      let pathname: string | undefined
      for (let index = 0; index < 200; index++) {
        const state = yield* router.state
        pathname = Option.map(state.location, (location) => location.pathname).pipe(Option.getOrUndefined)
        if (pathname === "/") break
        yield* Effect.yieldNow
      }
      expect(pathname).toBe("/")
      const state = yield* router.state
      expect(Result.getOrThrow(entryOf(state, "home").input).params).toEqual({})
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("navigation options override destination replace and state defaults", () =>
    Effect.gen(function* () {
      const OptionsHome = Router.route("home", "/")
      const OptionsTarget = Router.route("target", "/target")
      const OptionsApp = yield* Router.make("Options", [OptionsHome, OptionsTarget])
      const app = OptionsApp.layer.pipe(Layer.provide(MemoryHistory.layer("/")))
      yield* Effect.gen(function* () {
        const router = yield* OptionsApp.service
        yield* router.awaitInitial
        // Destination defaults are overridden by explicit options.
        yield* router.navigate(OptionsTarget.to(undefined, { replace: false, state: { from: "dest" } }), {
          replace: true,
          state: { from: "options" }
        })
        const overridden = Option.getOrThrow((yield* router.state).location)
        expect(overridden.index).toBe(0)
        expect(overridden.state).toEqual({ from: "options" })
        // An absent state option keeps the destination default.
        yield* router.navigate(OptionsTarget.to(undefined, { replace: true, state: { from: "dest" } }))
        expect(Option.getOrThrow((yield* router.state).location).state).toEqual({ from: "dest" })
        // An explicit `undefined` state option clears the destination default.
        yield* router.navigate(OptionsTarget.to(undefined, { replace: true, state: { from: "dest" } }), {
          state: undefined
        })
        expect(Option.getOrThrow((yield* router.state).location).state).toBeUndefined()
        // A destination replace default is honored without an option.
        yield* router.navigate(OptionsTarget.to(undefined, { replace: false }))
        expect(Option.getOrThrow((yield* router.state).location).index).toBe(1)
      }).pipe(Effect.provide(app))
    })
  )
})
