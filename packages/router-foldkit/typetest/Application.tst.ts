import { describe, expect, test } from "tstyche"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as Router from "@effect-stack/router/Router"
import { MemoryHistory } from "@effect-stack/router"
import type { HtmlBuilder } from "foldkit/html"
import type * as Update from "foldkit/update"
import { create, State, RouterMessage, type ConnectionId } from "@effect-stack/router-foldkit"

class Access extends Context.Service<Access, { readonly check: Effect.Effect<void, Denied> }>()(
  "FoldkitTypes/Access"
) {}
class Denied extends Schema.TaggedError<Denied>()("Denied", { message: Schema.String }) {}
const Model = Schema.Struct({ router: State, title: Schema.String })
type Model = typeof Model.Type
const GotRouter = Schema.TaggedStruct("GotRouter", { event: RouterMessage })
const Message = Schema.Union([GotRouter, Schema.TaggedStruct("Clicked", {})])
type Message = typeof Message.Type
const Id = Schema.FiniteFromString.pipe(Schema.brand("FoldkitApplicationId"))

const F = create<Model, Message>({
  getState: (model) => model.router,
  setState: (model, router) => ({ ...model, router }),
  toMessage: (event) => GotRouter.make({ event })
})
const Team = F.layout("team", "/teams/:teamId", {
  params: { teamId: Id },
  prepare: () => Access.use((access) => access.check),
  errorSchema: Denied,
  render: ({ h, outlet, input }) => {
    expect(input.params.teamId).type.toBe<typeof Id.Type>()
    return h.div([], [outlet()])
  },
  error: ({ failure, h }) => {
    if (failure._tag === "Domain") expect(failure.error).type.toBe<Denied>()
    return h.div([], [])
  }
})
const Page = Team.route("page", "/projects/:projectId", {
  params: { projectId: Id },
  search: { page: Schema.optional(Schema.FiniteFromString) },
  render: ({ h, input, model }) => {
    expect(model).type.toBe<Model>()
    expect(h).type.toBe<HtmlBuilder<Message>>()
    expect(input.params.projectId).type.toBe<typeof Id.Type>()
    return h.div([], [])
  }
})
const App = F.make("FoldkitTypes", [Page])

describe("Foldkit application inference", () => {
  test("retains canonical gate and requirement inference", () => {
    expect<Router.ApplicationErrorOf<typeof App>>().type.toBe<Denied>()
    expect<Router.ApplicationRequirementsOf<typeof App>>().type.toBe<Access>()
    expect(App.initialState).type.toBe<State>()
    expect(App.input({} as State, Page)).type.toBe<Option.Option<Router.DecodedRouteInputOfDef<typeof Page>>>()
    expect(App.input({} as State, Team)).type.toBe<Option.Option<Router.DecodedRouteInputOfDef<typeof Team>>>()
  })

  test("makes typed application Messages without introducing a Model/application cycle", () => {
    const target = {
      to: "/teams/:teamId/projects/:projectId",
      params: { teamId: Id.make(1), projectId: Id.make(2) }
    } as const
    expect(App.navigate(target)).type.toBe<Message>()
    expect(App.navigate(Page.to({ params: target.params }), { replace: true, state: undefined })).type.toBe<Message>()
    expect(App.navigate(target, { state: { source: "menu" } })).type.toBe<Message>()
    expect(App.navigate).type.not.toBeCallableWith({
      to: "/teams/:teamId/projects/:projectId",
      params: { projectId: Id.make(2) }
    })
    expect(App.navigate).type.not.toBeCallableWith({ to: "/not-selected" })
    expect(App.navigate).type.not.toBeCallableWith({ to: "/teams/:teamId", params: { teamId: Id.make(1) } })
    expect(App.navigate).type.not.toBeCallableWith(target, { state: () => undefined })
    expect(App.retry()).type.toBe<Message>()
    expect(App.cancel(1)).type.toBe<Message>()
  })

  test("returns infallible Foldkit Commands sharing a precise connection requirement", () => {
    expect(App.update({} as Model, {} as RouterMessage)).type.toBe<
      Update.Return<Model, Message, ConnectionId<"FoldkitTypes">>
    >()
    const executable = App.layer.pipe(
      Layer.provide(Layer.merge(MemoryHistory.layer("/"), Layer.succeed(Access, { check: Effect.void })))
    )
    const connection = App.connect(executable, { linkRoot: false })
    expect(connection.resources).type.toBe<Layer.Layer<ConnectionId<"FoldkitTypes">>>()
    expect(App.connect).type.not.toBeCallableWith(App.layer)
    const Other = F.make("OtherTypes", [Page])
    expect(App.connect).type.not.toBeCallableWith(
      Other.layer.pipe(
        Layer.provide(Layer.merge(MemoryHistory.layer("/"), Layer.succeed(Access, { check: Effect.void })))
      )
    )
  })

  test("does not assemble views from an incompatible Model/Message universe", () => {
    const Other = create<{ router: State }, RouterMessage>({
      getState: (model) => model.router,
      setState: (_, router) => ({ router }),
      toMessage: (message) => message
    })
    const OtherPage = Other.route("other", "/other", { render: () => null })
    expect(F.make).type.not.toBeCallableWith("InvalidUniverse", [OtherPage])
  })
})
