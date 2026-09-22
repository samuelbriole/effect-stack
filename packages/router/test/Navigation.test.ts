import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { MemoryHistory, Router } from "@effect-stack/router"

class MissingProject extends Schema.TaggedError<MissingProject>()("MissingProject", { projectId: Schema.Number }) {}

const Routes = Router.schema("Nav", {
  home: "/",
  accounts: {
    path: "/accounts",
    success: Schema.Struct({ count: Schema.Number }),
    children: {
      detail: {
        path: ":accountId",
        params: { accountId: Schema.FiniteFromString },
        success: Schema.Struct({ name: Schema.String })
      }
    }
  },
  teams: {
    path: "/teams",
    success: Schema.Struct({ label: Schema.String }),
    children: {
      member: {
        path: ":memberId",
        params: { memberId: Schema.FiniteFromString },
        success: Schema.Struct({ name: Schema.String }),
        error: MissingProject
      }
    }
  },
  project: {
    path: "/projects/:projectId",
    params: { projectId: Schema.FiniteFromString },
    search: { tab: Schema.optionalKey(Schema.String) },
    success: Schema.Struct({ title: Schema.String }),
    error: MissingProject
  },
  redirecting: { path: "/redirecting", success: Schema.Void },
  redirectBadRelease: { path: "/redirect-bad-release", success: Schema.Void },
  loopa: { path: "/loopa", success: Schema.Void },
  loopb: { path: "/loopb", success: Schema.Void },
  boom: { path: "/boom", success: Schema.Void, error: MissingProject }
})

const log: Array<string> = []

const AccountsLive = Router.route(Routes.accounts, () =>
  Effect.sync(() => {
    log.push("accounts")
    return { count: 2 }
  })
)

const AccountDetailLive = Router.route(Routes.accounts.detail, ({ params }) =>
  Effect.sync(() => {
    log.push("detail")
    return { name: `Account ${params.accountId}` }
  })
)

const ProjectLive = Router.route(Routes.project, ({ params }) =>
  Effect.sync(() => {
    log.push(`project:${params.projectId}`)
    return { title: `Project ${params.projectId}` }
  })
)

const TeamsLive = Router.route(Routes.teams, () => Effect.succeed({ label: "Teams" }))

const TeamMemberLive = Router.route(Routes.teams.member, ({ params }) =>
  Effect.fail(new MissingProject({ projectId: params.memberId }))
)

const RedirectingLive = Router.route(Routes.redirecting, () =>
  Effect.fail(Router.redirect(Routes.project({ params: { projectId: 9 } })))
)

// A redirect combined with a finalizer defect is not a pure redirect signal.
const RedirectBadReleaseLive = Router.route(Routes.redirectBadRelease, () =>
  Effect.acquireRelease(Effect.void, () => Effect.die(new Error("redirect-release-boom"))).pipe(
    Effect.andThen(Effect.fail(Router.redirect(Routes.project({ params: { projectId: 5 } }))))
  )
)

const BoomLive = Router.route(Routes.boom, () => Effect.fail(new MissingProject({ projectId: 1 })))

const LoopALive = Router.route(Routes.loopa, () => Effect.fail(Router.redirect(Routes.loopb())))
const LoopBLive = Router.route(Routes.loopb, () => Effect.fail(Router.redirect(Routes.loopa())))

const features = Layer.mergeAll(
  AccountsLive,
  AccountDetailLive,
  ProjectLive,
  TeamsLive,
  TeamMemberLive,
  RedirectingLive,
  RedirectBadReleaseLive,
  BoomLive,
  LoopALive,
  LoopBLive
)

const makeApp = (initial: string) =>
  Router.layer(Routes).pipe(Layer.provide(features), Layer.provide(MemoryHistory.layer(initial)))

const entryOf = (state: Router.RouterState<unknown>, id: string) => {
  const presentation = Option.getOrThrow(state.presentation)
  const entry = presentation.entries.find((candidate) => candidate.id === id)
  if (entry === undefined) throw new Error(`missing entry ${id}`)
  return entry
}

describe("Router navigation", () => {
  it.effect("resolves the initial location without failing the Layer", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      yield* router.awaitInitial
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      expect(presentation._tag).toBe("Resolved")
      expect(entryOf(state, "home").data._tag).toBe("Success")
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("runs ancestor group handlers before descendants", () =>
    Effect.gen(function* () {
      log.length = 0
      const router = yield* Routes.service
      yield* router.navigate(Routes.accounts.detail({ params: { accountId: 5 } }))
      expect(log).toEqual(["accounts", "detail"])
      const state = yield* router.state
      expect(AsyncResult.value(entryOf(state, "accounts").data)).toEqual(Option.some({ count: 2 }))
      expect(AsyncResult.value(entryOf(state, "accounts.detail").data)).toEqual(Option.some({ name: "Account 5" }))
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("encodes and decodes destinations with search", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      const outcome = yield* router.navigate(Routes.project({ params: { projectId: 7 }, search: { tab: "activity" } }))
      expect(outcome).toBe("Committed")
      const state = yield* router.state
      const entry = entryOf(state, "project")
      expect(Result.getOrThrow(entry.input)).toMatchObject({ search: { tab: "activity" } })
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("publishes typed domain failures against their owning node and keeps the router usable", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      const error = yield* Effect.flip(router.navigate(Routes.boom()))
      expect(error).toBeInstanceOf(MissingProject)
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
      // A user error without a `routeId` must still attribute to its node
      // rather than falling back to the router/not-found boundary.
      expect(presentation.owner).toBe("boom")
      const entry = presentation.entries.find((candidate) => candidate.id === "boom")
      expect(entry).toBeDefined()
      if (entry !== undefined) {
        expect(AsyncResult.isFailure(entry.data)).toBe(true)
        if (AsyncResult.isFailure(entry.data)) {
          expect(Cause.squash(entry.data.cause)).toBeInstanceOf(MissingProject)
        }
      }
      const recovered = yield* router.navigate(Routes.project({ params: { projectId: 3 } }))
      expect(recovered).toBe("Committed")
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("attributes a failed child while keeping its prepared ancestor", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      const error = yield* Effect.flip(router.navigate(Routes.teams.member({ params: { memberId: 8 } })))
      expect(error).toBeInstanceOf(MissingProject)
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
      expect(presentation.owner).toBe("teams.member")
      expect(AsyncResult.value(entryOf(state, "teams").data)).toEqual(Option.some({ label: "Teams" }))
      const member = presentation.entries.find((candidate) => candidate.id === "teams.member")
      expect(member !== undefined && AsyncResult.isFailure(member.data)).toBe(true)
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("publishes an unknown initial location instead of waiting forever", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      yield* router.awaitInitial.pipe(Effect.exit)
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
      expect(presentation.owner).toBe("<notfound>")
      const location = Option.getOrThrow(state.location)
      expect(location.pathname).toBe("/missing")
    }).pipe(Effect.provide(makeApp("/missing")))
  )

  it.effect("publishes an unknown traversed location against that location", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      yield* router.awaitInitial.pipe(Effect.exit)
      yield* router.navigate(Routes.project({ params: { projectId: 12 } }))
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
      const router = yield* Routes.service
      const outcome = yield* router.navigate(Routes.redirecting())
      expect(outcome).toBe("Committed")
      const state = yield* router.state
      expect(entryOf(state, "project").data._tag).toBe("Success")
      const location = Option.getOrThrow(state.location)
      expect(location.pathname).toBe("/projects/9")
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("does not consume a redirect combined with a finalizer defect", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      const exit = yield* Effect.exit(router.navigate(Routes.redirectBadRelease()))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.some(Cause.isDieReason)).toBe(true)
        expect(exit.cause.reasons.some(Cause.isFailReason)).toBe(true)
      }
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      if (presentation._tag !== "Failed") throw new Error("expected a failed presentation")
      expect(presentation.owner).toBe("redirectBadRelease")
      // The redirect must not have been followed or committed.
      expect(presentation.entries.some((entry) => entry.id === "project")).toBe(false)
    }).pipe(Effect.provide(makeApp("/")))
  )

  it("generates canonical hrefs", () => {
    expect(Result.getOrThrow(Router.href(Routes.accounts.detail({ params: { accountId: 3 } })))).toBe("/accounts/3")
    expect(Result.getOrThrow(Router.href(Routes.project({ params: { projectId: 4 }, search: {} })))).toBe("/projects/4")
  })

  it.effect("rejects redirect loops with a useful failure", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      const error = yield* Effect.flip(router.navigate(Routes.loopa()))
      expect(error).toBeInstanceOf(Router.RouteDefinitionError)
      expect(String(error)).toContain("Redirect loop")
    }).pipe(Effect.provide(makeApp("/")))
  )

  it.effect("acknowledges traversal and prepares the destination", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      yield* router.navigate(Routes.project({ params: { projectId: 11 } }))
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
      expect(entryOf(state, "home").data._tag).toBe("Success")
    }).pipe(Effect.provide(makeApp("/")))
  )
})
