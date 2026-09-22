import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { MemoryHistory, Router } from "@effect-stack/router"

const Routes = Router.schema("App", {
  home: "/",
  project: {
    path: "/projects/:projectId",
    params: { projectId: Schema.FiniteFromString },
    search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
    success: Schema.Struct({ title: Schema.String }),
    error: Schema.Struct({ code: Schema.Number })
  }
})

const ProjectLive = Router.route(Routes.project, ({ params, search }) =>
  Effect.succeed({ title: `Project ${params.projectId} ${search.tab ?? "overview"}` })
)

const AppLive = Router.layer(Routes).pipe(Layer.provide(ProjectLive), Layer.provide(MemoryHistory.layer("/")))

describe("Router", () => {
  it.effect("navigates headlessly with typed data", () =>
    Effect.gen(function* () {
      const router = yield* Routes.service
      const outcome = yield* router.navigate(Routes.project({ params: { projectId: 1 } }))
      expect(outcome).toBe("Committed")
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      expect(presentation._tag).toBe("Resolved")
      const entry = presentation.entries.find((candidate) => candidate.id === "project")
      expect(entry).toBeDefined()
      expect(entry === undefined ? undefined : AsyncResult.value(entry.data)).toEqual(
        Option.some({ title: "Project 1 overview" })
      )
    }).pipe(Effect.provide(AppLive))
  )

  it("generates hrefs", () => {
    const result = Router.href(Routes.project({ params: { projectId: 7 }, search: { tab: "activity" } }))
    expect(Result.getOrThrow(result)).toBe("/projects/7?tab=activity")
  })
})
