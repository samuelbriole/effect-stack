import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as Scope from "effect/Scope"
import * as Router from "@effect-stack/router/Router"
import type { History } from "@effect-stack/router"
import { finishApplication, makeDefinitionEngine } from "@effect-stack/router/Adapter"

const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
const projectId = Schema.decodeUnknownSync(ProjectId)(1)
class Dep extends Context.Service<Dep, {}>()("check/Dep") {}
class Boom extends Schema.TaggedError<Boom>()("Boom", {}) {}
const Parent = Router.layout("workspace", "/workspaces/:workspaceId", {
  params: { workspaceId: ProjectId },
  search: { tab: Schema.String },
  prepare: () => Effect.asVoid(Dep)
})
const Middle = Parent.layout("middle", "/middle", { prepare: () => Effect.fail(new Boom()) })
const Child = Middle.route("project", "/:projectId", {
  params: { projectId: ProjectId },
  prepare: ({ params, search }) =>
    Effect.sync(() => {
      const inherited: typeof projectId = params.workspaceId
      const own: typeof projectId = params.projectId
      const tab: string = search.tab
      void inherited
      void own
      void tab
    })
})
const actualParent: typeof Middle = Child["~parent"]
void actualParent
const App = Effect.runSync(Router.make("App", [Child]))
declare const dep: Dep
const requirement: Router.ApplicationRequirementsOf<typeof App> = dep
const error: Router.ApplicationErrorOf<typeof App> = new Boom()
void requirement
void error
Child.to({ params: { workspaceId: projectId, projectId }, search: { tab: "x" } })
// @ts-expect-error inherited params remain required
Child.to({ params: { projectId }, search: { tab: "x" } })
// @ts-expect-error decoded brands are preserved
Child.to({ params: { workspaceId: "1", projectId }, search: { tab: "x" } })
const Other = Router.route("project", "/other/:other", { params: { other: ProjectId } })
// @ts-expect-error destinations are correlated to selected endpoints
const foreign: Router.DestinationOf<readonly [typeof Child]> = Other.to({ params: { other: projectId } })
void foreign
const Index = Parent.index({ hash: Schema.String, search: { page: Schema.FiniteFromString } })
const Overview = Parent.route("overview", "/")
Overview.to({ params: { workspaceId: projectId }, search: { tab: "x" } })
// @ts-expect-error same-path endpoints cannot add path parameters
Parent.route("invalidOverview", "/", { params: { extra: Schema.String } })
// @ts-expect-error index shorthand cannot add path parameters
Parent.index({ params: { extra: Schema.String } })
Index.to({ params: { workspaceId: projectId }, search: { tab: "x", page: 1 }, hash: "section" })
// @ts-expect-error required hash cannot be omitted
Index.to({ params: { workspaceId: projectId }, search: { tab: "x", page: 1 } })
// @ts-expect-error layouts do not contribute endpoint paths
const layoutPath: Router.PathsOf<readonly [typeof Parent]> = "/workspaces/:workspaceId"
void layoutPath
Router.route("value", "/value", { prepare: () => Effect.succeed({ title: "x" }).pipe(Effect.asVoid) })
// @ts-expect-error handler factories are not gates
Router.route("factory", "/factory", { prepare: Effect.succeed(() => Effect.void) })
// @ts-expect-error old load options are removed
Router.route("load", "/load", { load: () => Effect.void })
const Scoped = Router.route("scoped", "/scoped", { prepare: () => Effect.asVoid(Scope.Scope) })
const ScopedApp = Effect.runSync(Router.make("Scoped", [Scoped]))
const scopeExcluded: Router.ApplicationRequirementsOf<typeof ScopedApp> extends never ? true : false = true
void scopeExcluded
const Different = Effect.runSync(Router.make("App", [Router.route("workspace", "/workspace")]))
// @ts-expect-error service identifiers are invariant in the complete gate specification
const wrongLayer: Layer.Layer<
  Router.ApplicationServiceId<
    "App",
    Router.ApplicationErrorOf<typeof App>,
    Router.ApplicationRequirementsOf<typeof App>
  >,
  History.HistoryError,
  unknown
> = Different.layer
void wrongLayer
declare const broad: Router.AnyDefinitionShape
const BroadApp = Effect.runSync(Router.make("Broad", [broad]))
const conservative: unknown extends Router.ApplicationRequirementsOf<typeof BroadApp> ? true : false = true
const conservativeError: unknown extends Router.ApplicationErrorOf<typeof BroadApp> ? true : false = true
void conservative
void conservativeError
const erased: Pick<typeof Child, "_tag" | "id" | "path" | "~node"> = Child
const ErasedApp = Effect.runSync(Router.make("Erased", [erased]))
const erasedReq: unknown extends Router.ApplicationRequirementsOf<typeof ErasedApp> ? true : false = true
void erasedReq
const erasedParent: Omit<typeof Child, "~parent"> = Child
const ErasedParentApp = Effect.runSync(Router.make("ErasedParent", [erasedParent]))
const erasedParentReq: unknown extends Router.ApplicationRequirementsOf<typeof ErasedParentApp> ? true : false = true
const erasedParentError: unknown extends Router.ApplicationErrorOf<typeof ErasedParentApp> ? true : false = true
void erasedParentReq
void erasedParentError
const HashParent = Router.layout("hashParent", "/hash-parent", { hash: ProjectId })
const HashMiddle = HashParent.layout("nested", "/nested", {
  prepare: ({ hash }) => {
    const decoded: typeof projectId = hash
    return Effect.sync(() => void decoded)
  }
})
const HashChild = HashMiddle.route("child", "/child", { prepare: ({ hash }) => Effect.sync(() => void hash) })
const HashIndex = HashMiddle.index()
HashChild.to({ hash: projectId })
HashIndex.to({ hash: projectId })
// @ts-expect-error inherited hash remains required
HashChild.to()
// @ts-expect-error inherited index hash remains required
HashIndex.to({})
// @ts-expect-error inherited hash uses the decoded brand, not its encoded string
HashChild.to({ hash: "1" })
const HashOverride = HashMiddle.route("override", "/override", { hash: Schema.String })
HashOverride.to({ hash: "section" })
// @ts-expect-error a widened selection is not a non-empty tuple
void Router.make("Wide", [] as ReadonlyArray<Router.AnyDefinitionShape>)
const engine = makeDefinitionEngine<unknown>({ renderer: "check", normalize: () => undefined, isEmpty: () => true })
const finished = Effect.runSync(finishApplication(engine, "Finish", [Child]))
const adapterRequirement: Router.ApplicationRequirementsOf<typeof finished> = dep
void adapterRequirement
const ServicefulCodec = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformEffect((input: string) => Effect.as(Dep, input)),
    encode: SchemaGetter.transform((input: string) => input)
  })
)
// @ts-expect-error URL codecs cannot require services
Router.route("serviceful", "/:id", { params: { id: ServicefulCodec } })
const A = Router.route("a", "/a/:a", { params: { a: ProjectId } })
const B = Router.route("b", "/b/:b", { params: { b: ProjectId } })
type Targets = Router.PathTargets<readonly [typeof A, typeof B]>
const valid: Targets = { to: "/a/:a", params: { a: projectId } }
void valid
// @ts-expect-error path inputs cannot cross the correlated union
const crossed: Targets = { to: "/a/:a", params: { b: projectId } }
void crossed
// @ts-expect-error no public runtime metadata map
void App.gates
