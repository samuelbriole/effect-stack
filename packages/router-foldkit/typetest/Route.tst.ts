import * as Router from "@effect-stack/router/Router"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import type { HtmlBuilder } from "foldkit/html"
import { expect, test } from "tstyche"
import { makeRouteConstructors, type DirectOptions } from "../src/internal/route.js"

type Model = { readonly count: number }
type Message = { readonly _tag: "Retry" }
class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}
const Id = Schema.FiniteFromString.pipe(Schema.brand("Id"))
const { route, layout } = makeRouteConstructors<Model, Message>()

test("render-first and error-first options preserve contextual input and gate failures", () => {
  const Child = route("child", "/child/:id", {
    render: ({ model, h, input, outlet }) => {
      expect(model).type.toBe<Model>()
      expect(h).type.toBe<HtmlBuilder<Message>>()
      expect(input.params.id).type.toBe<typeof Id.Type>()
      return outlet()
    },
    error: ({ model, h, failure, retry }) => {
      expect(model).type.toBe<Model>()
      expect(h).type.toBe<HtmlBuilder<Message>>()
      expect(retry).type.toBe<Message>()
      if (failure._tag === "Domain") expect(failure.error).type.toBe<Missing>()
      return h.div([], [])
    },
    errorSchema: Missing,
    params: { id: Id },
    prepare: () => Effect.fail(new Missing())
  })
  expect<Router.ErrorOf<typeof Child>>().type.toBe<Missing>()
  const ErrorFirst = route("errorFirst", "/error-first", {
    error: ({ failure, h }) => {
      if (failure._tag === "Domain") expect(failure.error).type.toBe<Missing>()
      return h.div([], [])
    },
    errorSchema: Missing,
    prepare: () => Effect.fail(new Missing()),
    empty: true
  })
  expect<Router.ErrorOf<typeof ErrorFirst>>().type.toBe<Missing>()
})

test("nested layouts, routes and index inherit decoded ancestor schemas", () => {
  const Parent = layout("parent", "/parents/:id", {
    params: { id: Id },
    search: { tab: Schema.String },
    hash: Id
  })
  const Nested = Parent.layout("nested", "/nested", {
    render: ({ input, outlet }) => {
      expect(input.params.id).type.toBe<typeof Id.Type>()
      expect(input.search.tab).type.toBe<string>()
      expect(input.hash).type.toBe<typeof Id.Type>()
      return outlet()
    }
  })
  const Child = Nested.route("child", "/children/:childId", {
    params: { childId: Schema.String },
    render: ({ input, outlet }) => {
      expect(input.params.id).type.toBe<typeof Id.Type>()
      expect(input.params.childId).type.toBe<string>()
      expect(input.search.tab).type.toBe<string>()
      expect(input.hash).type.toBe<typeof Id.Type>()
      return outlet()
    }
  })
  expect<(typeof Child)["~parent"]>().type.toBe<typeof Nested>()
  Nested.index({
    render: ({ input, outlet }) => {
      expect(input.params.id).type.toBe<typeof Id.Type>()
      expect(input.hash).type.toBe<typeof Id.Type>()
      return outlet()
    }
  })
  Nested.route("override", "/override", {
    hash: Schema.String,
    render: ({ input, outlet }) => {
      expect(input.hash).type.toBe<string>()
      return outlet()
    }
  })
})

test("redirects and transient Scope do not enter public gate metadata", () => {
  const Home = route("home", "/", { empty: true })
  const Redirecting = route("redirecting", "/redirecting", {
    prepare: () => Router.redirect(Home.to()),
    error: ({ failure, h }) => {
      if (failure._tag === "Domain") expect(failure.error).type.toBe<never>()
      return h.div([], [])
    },
    empty: true
  })
  const Scoped = route("scoped", "/scoped", { prepare: () => Effect.asVoid(Scope.Scope), empty: true })
  expect<Router.ErrorOf<typeof Redirecting>>().type.toBe<never>()
  expect<Router.RequirementsOf<typeof Scoped>>().type.toBe<never>()
})

test("error schemas cannot broaden inferred gate errors and native universes remain distinct", () => {
  expect<{ errorSchema: typeof Schema.Unknown }>().type.not.toBeAssignableTo<
    DirectOptions<Model, Message, {}, {}, undefined, Missing>
  >()
  expect<{ errorSchema: typeof Missing }>().type.not.toBeAssignableTo<DirectOptions<Model, Message>>()
  const Local = route("local", "/local", { empty: true })
  const Foreign = makeRouteConstructors<{ readonly name: string }, { readonly _tag: "Other" }>().route(
    "local",
    "/local",
    { empty: true }
  )
  expect(Foreign).type.not.toBeAssignableTo<typeof Local>()
})
