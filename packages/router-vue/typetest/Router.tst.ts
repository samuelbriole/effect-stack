import { expect, test } from "tstyche"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Layer from "effect/Layer"
import * as Atom from "effect/reactivity/Atom"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import type * as Router from "@effect-stack/router/Router"
import * as VueRouter from "@effect-stack/router-vue"
import {
  Provider,
  useRouter,
  useRouterState,
  useNavigateEffect,
  layout,
  make,
  makeNavigation,
  route,
  useRouteInput
} from "@effect-stack/router-vue"
import { h, type ComputedRef } from "vue"

class Dep extends Context.Service<Dep, {}>()("type/VueDep") {}
class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}
const Id = Schema.FiniteFromString.pipe(Schema.brand("Id"))
const Parent = layout("parent", "/:id", {
  params: { id: Id },
  search: { tab: Schema.String },
  prepare: () => Effect.asVoid(Dep)
})
const Child = Parent.route("child", "/child", { prepare: () => Effect.fail(new Missing()), render: () => null })
const App = make("VueTypes", [Child])
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
  expect(useRouteInput(HashChild).value.hash).type.toBe<typeof Id.Type>()
  expect(useRouteInput(Index).value.hash).type.toBe<typeof Id.Type>()
  expect(useRouteInput(HashChild)).type.toBe<ComputedRef<Router.DecodedRouteInputOfDef<typeof HashChild>>>()
  expect(useRouteInput(Index)).type.toBe<ComputedRef<Router.DecodedRouteInputOfDef<typeof Index>>>()
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
  expect(useRouteInput(Override).value.hash).type.toBe<string>()
  expect(useRouteInput(Override)).type.toBe<ComputedRef<Router.DecodedRouteInputOfDef<typeof Override>>>()
})
test("actual parent, inherited input, and gate E/R remain exact", () => {
  expect<(typeof Child)["~parent"]>().type.toBe<typeof Parent>()
  expect<Router.ErrorOf<typeof Child>>().type.toBe<Missing>()
  expect<Router.RequirementsOf<typeof Child>>().type.toBe<never>()
  expect<Router.ApplicationErrorOf<typeof App>>().type.toBe<Missing>()
  expect<Router.ApplicationRequirementsOf<typeof App>>().type.toBe<Dep>()
  expect(useRouteInput(Child)).type.toBe<ComputedRef<Router.DecodedRouteInputOfDef<typeof Child>>>()
  expect(VueRouter).type.not.toHaveProperty("useRoute")
})
test("standalone provider retains exact service requirements in direct and explicitly instantiated h calls", () => {
  const Home = route("providerHome", "/", { empty: true })
  const ProviderApp = make("VueProviderTypes", [Home])
  const runtime = Atom.runtime(ProviderApp.layer.pipe(Layer.provide(MemoryHistory.layer())))
  const wrongRuntime = Atom.runtime(Layer.empty)
  expect(Provider).type.toBeCallableWith({ app: ProviderApp, runtime })
  expect(Provider).type.not.toBeCallableWith({ app: ProviderApp, runtime: wrongRuntime })
  expect(Provider<typeof ProviderApp>).type.toBeCallableWith({ app: ProviderApp, runtime })
  expect(Provider<typeof ProviderApp>).type.not.toBeCallableWith({ app: ProviderApp, runtime: wrongRuntime })
  expect(h(Provider<typeof ProviderApp>, { app: ProviderApp, runtime })).type.toBe<ReturnType<typeof h>>()
  expect(useRouter(ProviderApp)).type.toBe<() => Router.RouterService<typeof ProviderApp.routes, never>>()
  expect(useRouterState(ProviderApp)).type.toBe<ComputedRef<Router.RouterState<typeof ProviderApp.routes>>>()
  expect(useRouter()).type.toBe<() => Router.RouterService<unknown, unknown>>()
})
test("index URL types and non-navigable layouts are preserved", () => {
  const Index = Parent.index({ hash: Schema.String, render: () => null })
  expect<Router.HashOfDef<typeof Index>>().type.toBe<string>()
  expect<Router.PathsOf<readonly [typeof Parent]>>().type.toBe<never>()
  expect<Router.ParamsOfDef<typeof Index>>().type.toBe<{ readonly id: typeof Id.Type }>()
})
test("bound navigation preserves target and error channels", () => {
  const navigate = useNavigateEffect(App)
  expect<Parameters<typeof navigate>[0]>().type.toBe<Router.NavigateTarget<typeof App.routes>>()
  expect<Effect.Error<ReturnType<typeof navigate>>>().type.toBe<
    Router.NavigationError<Router.ApplicationErrorOf<typeof App>>
  >()
  const Other = route("other", "/other", { render: () => null })
  expect(Other.to()).type.not.toBeAssignableTo<Router.DestinationOf<typeof App.routes>>()
})
test("type-only navigation and broad metadata remain honest", () => {
  const helpers = makeNavigation<typeof App>()
  expect<{ to: "/:id/child"; params: { id: typeof Id.Type }; search: { tab: string } }>().type.toBeAssignableTo<
    Parameters<typeof helpers.Link>[0]
  >()
  expect<Router.RequirementsOf<Router.AnyDefinitionShape>>().type.toBe<unknown>()
})
