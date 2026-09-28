import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { MemoryHistory, Router } from "@effect-stack/router"

const Home = Router.route("home", "/")
const Project = Router.route("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  prepare: () => Effect.void
})

const App = Router.make("App", [Home, Project])
const AppLive = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))

describe("Router", () => {
  it.effect("navigates headlessly and publishes committed decoded input", () =>
    Effect.gen(function* () {
      const router = yield* App.service
      const outcome = yield* router.navigate(Project.to({ params: { projectId: 1 } }))
      expect(outcome).toBe("Committed")
      const state = yield* router.state
      const presentation = Option.getOrThrow(state.presentation)
      expect(presentation._tag).toBe("Resolved")
      if (presentation._tag !== "Resolved") throw new Error("expected a resolved presentation")
      const entry = presentation.entries.find((candidate) => candidate.id === "project")
      expect(entry).toBeDefined()
      expect(entry !== undefined && Result.getOrThrow(entry.input).params).toEqual({ projectId: 1 })
    }).pipe(Effect.provide(AppLive))
  )

  it("generates hrefs", () => {
    const result = Router.href(Project.to({ params: { projectId: 7 }, search: { tab: "activity" } }))
    expect(Result.getOrThrow(result)).toBe("/projects/7?tab=activity")
  })
})
