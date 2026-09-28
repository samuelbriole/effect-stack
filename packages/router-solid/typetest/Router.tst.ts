import { expect, test } from "tstyche"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Router from "@effect-stack/router/Router"
import * as SolidRouter from "@effect-stack/router-solid"
import {
  layout,
  make,
  makeNavigation,
  route,
  useRouteInput,
  useRouter,
  useNavigateEffect
} from "@effect-stack/router-solid"
import type { Accessor } from "solid-js"

class Dep extends Context.Service<Dep, {}>()("type/SolidDep") {}
class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}
const Id = Schema.FiniteFromString.pipe(Schema.brand("Id"))
const Parent = layout("parent", "/:id", {
  params: { id: Id },
  search: { tab: Schema.String },
  prepare: () => Effect.asVoid(Dep)
})
const Child = Parent.route("child", "/child", { prepare: () => Effect.fail(new Missing()), component: () => null })
const App = make("SolidTypes", [Child])
test("inherited hash stays exact in native gates, hooks, index, and overrides", () => {
  const HashParent = layout("inheritedHash", "/inherited-hash", { hash: Id })
  const Nested = HashParent.layout("nested", "/nested", {
    prepare: ({ hash }) => {
      expect(hash).type.toBe<typeof Id.Type>()
      return Effect.void
    }
  })
  const HashChild = Nested.route("child", "/child", {
    empty: true,
    prepare: ({ hash }) => {
      expect(hash).type.toBe<typeof Id.Type>()
      return Effect.void
    }
  })
  const Index = Nested.index({
    empty: true,
    prepare: ({ hash }) => {
      expect(hash).type.toBe<typeof Id.Type>()
      return Effect.void
    }
  })
  expect(useRouteInput(HashChild)().hash).type.toBe<typeof Id.Type>()
  expect(useRouteInput(Index)().hash).type.toBe<typeof Id.Type>()
  expect(useRouteInput(HashChild)).type.toBe<Accessor<Router.DecodedRouteInputOfDef<typeof HashChild>>>()
  expect(useRouteInput(Index)).type.toBe<Accessor<Router.DecodedRouteInputOfDef<typeof Index>>>()
  expect(HashChild.to).type.not.toBeCallableWith({})
  expect(Index.to).type.not.toBeCallableWith({})
  const Override = Nested.route("override", "/override", {
    hash: Schema.String,
    empty: true,
    prepare: ({ hash }) => {
      expect(hash).type.toBe<string>()
      return Effect.void
    }
  })
  expect(useRouteInput(Override)().hash).type.toBe<string>()
  expect(useRouteInput(Override)).type.toBe<Accessor<Router.DecodedRouteInputOfDef<typeof Override>>>()
})
test("actual parent, inherited input, and gate E/R remain exact", () => {
  expect<(typeof Child)["~parent"]>().type.toBe<typeof Parent>()
  expect<Router.ErrorOf<typeof Child>>().type.toBe<Missing>()
  expect<Router.ApplicationRequirementsOf<typeof App>>().type.toBe<Dep>()
  expect(useRouteInput(Child)).type.toBe<Accessor<Router.DecodedRouteInputOfDef<typeof Child>>>()
  expect(SolidRouter).type.not.toHaveProperty("useRoute")
})
test("application errors aggregate actual ancestors while definition errors stay local", () => {
  class ParentMissing extends Schema.TaggedError<ParentMissing>()("ParentMissing", {}) {}
  const ErrorParent = layout("errorParent", "/errors", { prepare: () => Effect.fail(new ParentMissing()) })
  const ErrorChild = ErrorParent.route("child", "/child", {
    prepare: () => Effect.fail(new Missing()),
    empty: true
  })
  const ErrorApp = make("SolidParentErrors", [ErrorChild])
  expect<Router.ErrorOf<typeof ErrorChild>>().type.toBe<Missing>()
  expect<Router.ApplicationErrorOf<typeof ErrorApp>>().type.toBe<Missing | ParentMissing>()
  expect<Router.RequirementsOf<typeof Child>>().type.toBe<never>()
  expect<Router.ApplicationRequirementsOf<typeof App>>().type.toBe<Dep>()
  expect(useRouter()).type.toBe<Accessor<Router.RouterService<unknown, unknown>>>()
})
test("index URL types and non-navigable layouts are preserved", () => {
  const Index = Parent.index({ hash: Schema.String, component: () => null })
  expect<Router.HashOfDef<typeof Index>>().type.toBe<string>()
  expect<Router.PathsOf<readonly [typeof Parent]>>().type.toBe<never>()
  expect<Router.ParamsOfDef<typeof Index>>().type.toBe<{ readonly id: typeof Id.Type }>()
})
test("bound navigation preserves target and error channels", () => {
  const Navigation = makeNavigation(App)
  expect<Parameters<ReturnType<typeof Navigation.useNavigateEffect>>[0]>().type.toBe<
    Router.NavigateTarget<typeof App.routes>
  >()
  expect<Effect.Error<ReturnType<ReturnType<typeof Navigation.useNavigateEffect>>>>().type.toBe<
    Router.NavigationError<Router.ApplicationErrorOf<typeof App>>
  >()
  expect(useRouter(App)).type.toBe<Accessor<Router.RouterService<typeof App.routes, Missing>>>()
  expect(useNavigateEffect(App)).type.toBe<ReturnType<typeof Navigation.useNavigateEffect>>()
  const Other = route("other", "/other", { component: () => null })
  expect(Other.to()).type.not.toBeAssignableTo<Router.DestinationOf<typeof App.routes>>()
})
test("type-only navigation and broad metadata remain honest", () => {
  const helpers = makeNavigation<typeof App>()
  expect<{ to: "/:id/child"; params: { id: typeof Id.Type }; search: { tab: string } }>().type.toBeAssignableTo<
    Parameters<typeof helpers.Link>[0]
  >()
  expect<Router.RequirementsOf<Router.AnyDefinitionShape>>().type.toBe<unknown>()
})
