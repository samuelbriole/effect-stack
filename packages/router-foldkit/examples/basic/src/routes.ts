import { create } from "@effect-stack/router-foldkit"
import { Effect, Schema } from "effect"
import type { Html } from "foldkit/html"
import { Access, AccessDenied } from "./access.ts"
import { ClickedIncrement, ClickedUnlock, GotRouter, type Message, type Model } from "./model.ts"

export const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
export const projectId = Schema.decodeUnknownSync(ProjectId)("42")
export const restrictedProjectId = Schema.decodeUnknownSync(ProjectId)("13")

const checkProjectAccess = (input: {
  readonly params: { readonly projectId: typeof ProjectId.Type }
}): Effect.Effect<void, AccessDenied, Access> =>
  Effect.flatMap(Access, (access) => access.check(input.params.projectId))

const { route, layout, make } = create<Model, Message>({
  getState: (model) => model.router,
  setState: (model, router) => ({ ...model, router }),
  toMessage: (message) => GotRouter.make({ message }),
  pending: (_model, h) => h.p([h.Role("status")], ["Connecting…"]),
  notFound: (_model, h) => h.p([h.Role("status")], ["Page not found. Use Home above."])
})

export const Home = route("home", "/", {
  render: ({ model, h }) =>
    h.section(
      [],
      [
        h.h2([], ["Native Foldkit routing"]),
        h.p([], ["Routes render from your Model. Navigation flows through your Message and update."]),
        h.button([h.OnClick(ClickedIncrement.make({}))], [`Counter: ${model.count}`]),
        h.p([], ["Open Project 42, then Details. Use Back and Forward, including your browser's buttons."]),
        h.p([], ["Use ‘Lock and open Project 13’ to exercise the expected gate failure."])
      ]
    )
})

export const Project = layout("project", "/projects/:projectId", {
  params: { projectId: ProjectId },
  prepare: checkProjectAccess,
  errorSchema: AccessDenied,
  error: ({ model, h, failure, retry }) =>
    h.section(
      [h.Role("alert")],
      [
        h.h2([], ["Project access required"]),
        h.p(
          [],
          [
            failure._tag === "Domain"
              ? `Project ${failure.error.projectId} is locked for this browser session.`
              : failure.diagnostic.message
          ]
        ),
        h.button([h.OnClick(ClickedUnlock.make({})), h.Disabled(model.changingAccess)], ["Allow access and retry"]),
        h.button([h.OnClick(retry)], ["Retry without changing access"])
      ]
    ),
  render: ({ model, h, input, outlet }): Html =>
    h.section(
      [],
      [
        h.h2([], [`Project ${input.params.projectId}`]),
        h.p([], [`Application counter: ${model.count}`]),
        h.button([h.OnClick(ClickedIncrement.make({}))], ["Increment"]),
        h.nav(
          [],
          [
            App.link(h, ProjectIndex.to({ params: { projectId: input.params.projectId } }), ["Overview"]),
            App.link(h, DetailsIndex.to({ params: { projectId: input.params.projectId } }), ["Details"])
          ]
        ),
        outlet()
      ]
    )
})

export const ProjectIndex = Project.index({
  render: ({ h, input }) => h.p([], [`Overview receives the branded ancestor id: ${input.params.projectId}.`])
})

export const Details = Project.layout("details", "/details", {
  render: ({ h, input, outlet }) =>
    h.section([], [h.h3([], [`Nested details layout for ${input.params.projectId}`]), outlet()])
})

export const DetailsIndex = Details.index({
  render: ({ h, input }) => h.p([], [`Nested index also receives project ${input.params.projectId}.`])
})

export const App = make("Example", [Home, ProjectIndex, DetailsIndex])
