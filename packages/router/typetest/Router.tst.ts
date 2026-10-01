import { describe, expect, test } from "tstyche"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Router from "@effect-stack/router/Router"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Atom from "effect/reactivity/Atom"
import type * as AtomRouter from "@effect-stack/router/AtomRouter"

describe("direct gates and actual parent metadata", () => {
  const Id = Schema.FiniteFromString.pipe(Schema.brand("Id"))
  class Dep extends Context.Service<Dep, {}>()("type/Dep") {}
  class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}
  const Parent = Router.layout("parent", "/:id", {
    params: { id: Id },
    search: { tab: Schema.String },
    prepare: () => Effect.asVoid(Dep)
  })
  const Middle = Parent.layout("middle", "/middle", { prepare: () => Effect.fail(new Missing()) })
  const Child = Middle.route("child", "/child", { prepare: () => Effect.void })
  const App = Router.make("App", [Child])
  test("traverses actual parents and preserves inferred gate E/R", () => {
    const TypedInput = Middle.route("typed", "/typed", {
      prepare: (input) => {
        expect(input.params.id).type.toBe<typeof Id.Type>()
        expect(input.search.tab).type.toBe<string>()
        return Effect.void
      }
    })
    void TypedInput
    expect<(typeof Child)["~parent"]>().type.toBe<typeof Middle>()
    expect<(typeof Middle)["~parent"]>().type.toBe<typeof Parent>()
    expect<Router.ErrorOf<typeof Middle>>().type.toBe<Missing>()
    expect<Router.RequirementsOf<typeof Parent>>().type.toBe<Dep>()
    expect<Router.ApplicationRequirementsOf<typeof App>>().type.toBe<Dep>()
    expect<Router.ApplicationErrorOf<typeof App>>().type.toBe<Missing>()
    expect<Router.ErrorOf<typeof Child>>().type.toBe<never>()
    expect<Router.RequirementsOf<typeof Child>>().type.toBe<never>()
  })
  test("removes redirects and transient Scope from metadata", () => {
    const Redirecting = Router.route("redirect", "/redirect", {
      prepare: () =>
        Effect.fail(
          Router.redirect(Child.to({ params: { id: Schema.decodeUnknownSync(Id)(1) }, search: { tab: "x" } }))
        )
    })
    const Scoped = Router.route("scoped", "/scoped", { prepare: () => Effect.asVoid(Scope.Scope) })
    expect<Router.ErrorOf<typeof Redirecting>>().type.toBe<never>()
    expect<Router.RequirementsOf<typeof Scoped>>().type.toBe<never>()
  })
  test("aggregates unions without conflating own node evidence or key identity", () => {
    class OtherDep extends Context.Service<OtherDep, {}>()("type/OtherDep") {}
    class OtherError extends Schema.TaggedError<OtherError>()("OtherError", {}) {}
    const Other = Router.route("other", "/other", {
      prepare: () => OtherDep.pipe(Effect.flatMap(() => Effect.fail(new OtherError())))
    })
    const Combined = Router.make("Combined", [Child, Other])
    expect<Router.ApplicationErrorOf<typeof Combined>>().type.toBe<Missing | OtherError>()
    expect<Router.ApplicationRequirementsOf<typeof Combined>>().type.toBe<Dep | OtherDep>()
    expect<Router.ErrorOf<typeof Other>>().type.toBe<OtherError>()
    expect<Router.RequirementsOf<typeof Other>>().type.toBe<OtherDep>()
    expect<Router.ErrorOf<typeof Child>>().type.toBe<never>()
    expect<Router.RequirementsOf<typeof Child>>().type.toBe<never>()
    expect<Router.RoutesOf<typeof Combined>>().type.toBe<readonly [typeof Child, typeof Other]>()
    expect<Router.AppIdOf<typeof Combined>>().type.toBe<"Combined">()
    expect<Router.NavigationError<Missing>>().type.toBe<
      | Router.History.HistoryError
      | Router.RouteDecodeError
      | Router.RouteEncodeError
      | Router.RouteNotFound
      | Router.RouteDefinitionError
      | Missing
    >()
    expect<Router.ApplicationErrorOf<Router.ApplicationOf<"Empty", readonly []>>>().type.toBe<never>()
    expect<Router.ApplicationRequirementsOf<Router.ApplicationOf<"Empty", readonly []>>>().type.toBe<never>()
  })
  test("startup errors retain history and supplied Layer failures, not gate failures", () => {
    class StartupError extends Schema.TaggedError<StartupError>()("StartupError", {}) {}
    expect<Layer.Error<typeof App.layer>>().type.toBe<Router.History.HistoryError>()
    expect<Router.ApplicationErrorOf<typeof App>>().type.toBe<Missing>()
    expect<Router.ErrorOf<typeof Middle>>().type.toBe<Missing>()
    const provided = App.layer.pipe(
      Layer.provide(Layer.effect(Dep, Effect.fail(new StartupError()))),
      Layer.provide(MemoryHistory.layer())
    )
    expect<Layer.Error<typeof provided>>().type.toBe<Router.History.HistoryError | StartupError>()
    const runtime = Atom.runtime(provided)
    type StartupOf<T> = T extends Atom.AtomRuntime<infer _R, infer ER> ? ER : never
    expect<StartupOf<typeof runtime>>().type.toBe<Router.History.HistoryError | StartupError>()
  })
  test("broad and erased metadata remains conservative", () => {
    const erased: Omit<typeof Child, "~parent"> = Child
    const ErasedApp = Router.make("Erased", [erased])
    expect<Router.ApplicationRequirementsOf<typeof ErasedApp>>().type.toBe<unknown>()
    expect<Router.ApplicationErrorOf<typeof ErasedApp>>().type.toBe<unknown>()
    type OptionalParent = Omit<typeof Child, "~parent"> & { readonly "~parent"?: typeof Middle }
    expect<
      Router.ApplicationRequirementsOf<Router.ApplicationOf<"Evidence", readonly [OptionalParent]>>
    >().type.toBe<unknown>()
    expect<
      Router.ApplicationErrorOf<
        Router.ApplicationOf<"Evidence", readonly [typeof Child | Omit<typeof Child, "~parent">]>
      >
    >().type.toBe<unknown>()
    expect<
      // oxlint-disable-next-line typescript/no-explicit-any -- Deliberately erased selection must remain conservative.
      Router.ApplicationRequirementsOf<Router.ApplicationOf<"Evidence", readonly [any]>>
    >().type.toBe<unknown>()
    expect<
      // oxlint-disable-next-line typescript/no-explicit-any -- Deliberately erased gate channels must remain conservative.
      Router.RequirementsOf<{ readonly "~gate": { readonly error: any; readonly requirements: any } }>
    >().type.toBe<unknown>()
    const Top = Router.make("Top", [Router.route("top", "/top")])
    expect<Router.ApplicationRequirementsOf<typeof Top>>().type.toBe<never>()
    expect<Router.ApplicationErrorOf<typeof Top>>().type.toBe<never>()
    expect<Router.ApplicationRequirementsOf<unknown>>().type.toBe<unknown>()
    expect<Router.ApplicationErrorOf<unknown>>().type.toBe<unknown>()
    type ErasedParent = Omit<typeof Child, "~parent"> & { readonly "~parent": unknown }
    expect<
      Router.ApplicationRequirementsOf<Router.ApplicationOf<"Evidence", readonly [ErasedParent]>>
    >().type.toBe<unknown>()
    // oxlint-disable-next-line typescript/no-explicit-any -- Tests conservative handling of deliberately erased metadata.
    expect<Router.ErrorOf<{ readonly "~gate": any }>>().type.toBe<unknown>()
    expect<Router.ErrorOf<Router.AnyDefinitionShape>>().type.toBe<unknown>()
    expect<Router.RequirementsOf<Router.AnyDefinitionShape>>().type.toBe<unknown>()
    expect<
      Router.ApplicationRequirementsOf<Router.ApplicationOf<"Evidence", ReadonlyArray<Router.AnyDefinitionShape>>>
    >().type.toBe<unknown>()
    expect<Router.ErrorOf<Pick<typeof Child, "~node">>>().type.toBe<unknown>()
    expect<Router.ErrorOf<{ readonly "~gate": never }>>().type.toBe<unknown>()
    expect<Router.ErrorOf<{ readonly "~gate": { readonly error: "broken" } }>>().type.toBe<unknown>()
    expect<Router.ErrorOf<unknown>>().type.toBe<unknown>()
    expect<Router.ApplicationErrorOf<Router.ApplicationOf<"Evidence", unknown>>>().type.toBe<unknown>()
    expect<Router.ApplicationRequirementsOf<Router.ApplicationOf<"Evidence", unknown>>>().type.toBe<unknown>()
    expect<Router.ApplicationErrorOf<Router.ApplicationOf<"Evidence", never>>>().type.toBe<unknown>()
    type Widened = Router.RouteDefinition<Router.AnyNodeInfo, undefined, never, never>
    expect<Router.ApplicationErrorOf<Router.ApplicationOf<"Evidence", readonly [Widened]>>>().type.toBe<unknown>()
    expect<
      Router.ApplicationRequirementsOf<Router.ApplicationOf<"Evidence", readonly [Widened]>>
    >().type.toBe<unknown>()
    type NeverParent = Omit<typeof Child, "~parent"> & { readonly "~parent": never }
    expect<Router.ApplicationErrorOf<Router.ApplicationOf<"Evidence", readonly [NeverParent]>>>().type.toBe<unknown>()
    type MalformedParent = Omit<typeof Child, "~parent"> & { readonly "~parent": string }
    expect<
      Router.ApplicationErrorOf<Router.ApplicationOf<"Evidence", readonly [MalformedParent]>>
    >().type.toBe<unknown>()
  })
  test("recursive structural erasure terminates conservatively without truncating finite parents", () => {
    interface KnownCycle {
      readonly "~node": Router.NodeInfo<"cycle", "/cycle", {}, {}, undefined, "layout">
      readonly "~gate": { readonly error: never; readonly requirements: never }
      readonly "~parent": KnownCycle | undefined
    }
    expect<Router.ApplicationErrorOf<Router.ApplicationOf<"Cycle", readonly [KnownCycle]>>>().type.toBe<unknown>()
    expect<
      Router.ApplicationRequirementsOf<Router.ApplicationOf<"Cycle", readonly [KnownCycle]>>
    >().type.toBe<unknown>()
    interface Erased extends Router.AnyDefinitionShape {
      readonly "~parent": Erased | undefined
    }
    const erased: Erased = Child
    const ErasedApp = Router.make("RecursiveErased", [erased])
    expect<Router.ApplicationRequirementsOf<typeof ErasedApp>>().type.toBe<unknown>()
    expect<Router.ApplicationErrorOf<typeof ErasedApp>>().type.toBe<unknown>()
    interface Left extends Router.AnyDefinitionShape {
      readonly "~parent": Right | undefined
    }
    interface Right extends Router.AnyDefinitionShape {
      readonly "~parent": Left | undefined
    }
    const mutual: Left = Child
    const MutualApp = Router.make("MutualErased", [mutual])
    expect<Router.ApplicationRequirementsOf<typeof MutualApp>>().type.toBe<unknown>()
    expect<Router.ApplicationErrorOf<typeof MutualApp>>().type.toBe<unknown>()
    const Deep = Child // finite constructor ancestry must retain exact evidence
    const L1 = Middle.layout("l1", "/l1")
    const L2 = L1.layout("l2", "/l2")
    const L3 = L2.layout("l3", "/l3")
    const L4 = L3.layout("l4", "/l4")
    const Leaf = L4.route("leaf", "/leaf")
    const Finite = Router.make("Finite", [Deep, Leaf])
    expect<Router.ApplicationRequirementsOf<typeof Finite>>().type.toBe<Dep>()
    expect<Router.ApplicationErrorOf<typeof Finite>>().type.toBe<Missing>()
  })
  test("index schemas and endpoint/layout distinctions remain exact", () => {
    const Index = Parent.index({ hash: Schema.String, search: { page: Schema.FiniteFromString } })
    const Overview = Parent.route("overview", "/")
    expect<Router.InfoOf<typeof Index>["kind"]>().type.toBe<"endpoint">()
    expect<Router.InfoOf<typeof Overview>["kind"]>().type.toBe<"endpoint">()
    expect<Router.ParamsOfDef<typeof Index>>().type.toBe<Router.ParamsOfDef<typeof Overview>>()
    expect<keyof AtomRouter.RouteView<typeof Index>>().type.toBe<"params" | "search" | "hash" | "input">()
    expect<Router.HashOfDef<typeof Index>>().type.toBe<string>()
    expect<Router.PathsOf<readonly [typeof Parent]>>().type.toBe<never>()
    expect<Router.PathsOf<readonly [typeof Parent, typeof Index]>>().type.toBe<"/:id">()
    expect(Index.to).type.toBeCallableWith({
      params: { id: Schema.decodeUnknownSync(Id)(1) },
      search: { tab: "x", page: 1 },
      hash: "deep"
    })
  })
  test("hash inheritance preserves decoded brands through gates, nested layouts, index, and overrides", () => {
    const HashParent = Router.layout("hashParent", "/hash-parent", { hash: Id })
    const Nested = HashParent.layout("nested", "/nested", {
      prepare: ({ hash }) => {
        expect(hash).type.toBe<typeof Id.Type>()
        return Effect.void
      }
    })
    const Endpoint = Nested.route("endpoint", "/endpoint", {
      prepare: ({ hash }) => {
        expect(hash).type.toBe<typeof Id.Type>()
        return Effect.void
      }
    })
    const Index = Nested.index({
      prepare: ({ hash }) => {
        expect(hash).type.toBe<typeof Id.Type>()
        return Effect.void
      }
    })
    expect<Router.HashOfDef<typeof Endpoint>>().type.toBe<typeof Id.Type>()
    expect<Router.HashOfDef<typeof Index>>().type.toBe<typeof Id.Type>()
    expect<AtomRouter.RouteView<typeof Endpoint>["hash"]>().type.toBe<typeof Id.Type>()
    expect<AtomRouter.RouteView<typeof Index>["input"]["hash"]>().type.toBe<typeof Id.Type>()
    expect(Endpoint.to).type.not.toBeCallableWith({})
    expect(Index.to).type.not.toBeCallableWith({})
    const Override = Nested.route("override", "/override", {
      hash: Schema.String,
      prepare: ({ hash }) => {
        expect(hash).type.toBe<string>()
        return Effect.void
      }
    })
    expect<Router.HashOfDef<typeof Override>>().type.toBe<string>()
    expect(Override.to).type.toBeCallableWith({ hash: "section" })
  })
  test("path target unions do not cross decoded input shapes", () => {
    const A = Router.route("a", "/a/:a", { params: { a: Id } })
    const B = Router.route("b", "/b/:b", { params: { b: Id } })
    type Targets = Router.PathTargets<readonly [typeof A, typeof B]>
    expect<{ to: "/a/:a"; params: { a: typeof Id.Type } }>().type.toBeAssignableTo<Targets>()
    expect<{ to: "/b/:b"; params: { b: typeof Id.Type } }>().type.toBeAssignableTo<Targets>()
    expect<{ to: "/a/:a"; params: { b: typeof Id.Type } }>().type.not.toBeAssignableTo<Targets>()
    expect<{ to: "/a/:a" }>().type.not.toBeAssignableTo<Targets>()
  })
  test("application service identity is invariant in the full gate specification", () => {
    type Id = Router.ApplicationServiceId<
      "App",
      Router.ApplicationErrorOf<typeof App>,
      Router.ApplicationRequirementsOf<typeof App>
    >
    const Free = Router.make("App", [Router.route("free", "/free")])
    expect<Context.Service.Identifier<typeof Free.service>>().type.not.toBeAssignableTo<Id>()
    expect<Router.ApplicationServiceId<"App", Missing, Dep>>().type.not.toBeAssignableTo<
      Router.ApplicationServiceId<"App", never, Dep>
    >()
    expect<Router.ApplicationServiceId<"App", never, Dep>>().type.not.toBeAssignableTo<
      Router.ApplicationServiceId<"App", Missing, Dep>
    >()
    expect<Router.ApplicationServiceId<"App", Missing, Dep>>().type.not.toBeAssignableTo<
      Router.ApplicationServiceId<"App", Missing, never>
    >()
    expect<Router.ApplicationServiceId<"App", Missing, never>>().type.not.toBeAssignableTo<
      Router.ApplicationServiceId<"App", Missing, Dep>
    >()
    expect<Router.ErrorOf<typeof Parent>>().type.toBe<never>()
    expect<Router.RequirementsOf<typeof Child>>().type.toBe<never>()
  })
})
