/**
 * Compile-time negative contract checks and the Phase 1 inference proof.
 * Typechecked by `pnpm check`; not run by Vitest.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Route from "@effect-stack/router/Route"
import * as RouteGroup from "@effect-stack/router/RouteGroup"
import type { Destination } from "@effect-stack/router/Router"
import * as Router from "@effect-stack/router/Router"

const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
const projectId = Schema.decodeUnknownSync(ProjectId)(1)

const ProjectRoutes = RouteGroup.make("projects")
  .add(
    Route.make("index", "/"),
    Route.make("detail", "/:projectId", {
      params: { projectId: ProjectId },
      search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
      success: Schema.Struct({ title: Schema.String }),
      error: Schema.Struct({ code: Schema.Number })
    })
  )
  .prefix("/projects")

const Routes = Router.make("App").add(Route.make("home", "/"), ProjectRoutes)

// @ts-expect-error Missing required params.
Routes.projects.detail({ search: {} })
// @ts-expect-error Search values are constrained by the declared schema.
Routes.projects.detail({ params: { projectId }, search: { tab: "nope" } })
// @ts-expect-error Params are branded.
Routes.projects.detail({ params: { projectId: 1 } })

const detailId: Router.IdOf<typeof Routes.projects.detail> = "projects.detail"
void detailId
// @ts-expect-error The local key alone is not the qualified identifier.
const localDetailId: Router.IdOf<typeof Routes.projects.detail> = "detail"
void localDetailId

const detailPath: typeof Routes.projects.detail.path = "/projects/:projectId"
void detailPath

class Boom {
  readonly _tag = "Boom"
}
// @ts-expect-error Undeclared handler errors are rejected.
Router.route(Routes.projects.detail, () => Effect.fail(new Boom()))
// @ts-expect-error Handler success must satisfy the declared success schema.
Router.route(Routes.projects.detail, () => Effect.succeed({ nope: 1 }))
// @ts-expect-error Standalone declarations are not implementation targets.
Router.route(ProjectRoutes)
// @ts-expect-error Bound nodes cannot be added back as declarations.
Router.make("Reuse").add(Routes.projects)

const Routes2 = Router.make("Other").add(
  Route.make("home", "/"),
  RouteGroup.make("projects")
    .prefix("/projects")
    .add(
      Route.make("index", "/"),
      Route.make("detail", "/:projectId", {
        params: { projectId: ProjectId },
        success: Schema.Struct({ title: Schema.String })
      })
    )
)

const equivalent: Router.IdOf<typeof Routes2.projects.detail> = "projects.detail"
void equivalent
const equivalentPath: typeof Routes2.projects.detail.path = "/projects/:projectId"
void equivalentPath

// --- Phase 1: nested reusable group inference proof ---

const TaskId = Schema.FiniteFromString.pipe(Schema.brand("TaskId"))
const taskId = Schema.decodeUnknownSync(TaskId)(2)
const Task = Schema.Struct({ name: Schema.String })

const TaskRoutes = RouteGroup.make("tasks").add(
  Route.make("detail", "/:taskId", { params: { taskId: TaskId }, success: Task })
)

const Nested = Router.make("Nested").add(
  RouteGroup.make("project", { params: { projectId: ProjectId } })
    .add(Route.make("index", "/"), TaskRoutes)
    .prefix("/projects/:projectId")
)

const nestedId: Router.IdOf<typeof Nested.project.tasks.detail> = "project.tasks.detail"
void nestedId
const nestedPath: typeof Nested.project.tasks.detail.path = "/projects/:projectId/:taskId"
void nestedPath

const nestedDestination = Nested.project.tasks.detail({ params: { projectId, taskId } })
const nestedInput: Router.InputOfNode<typeof Nested.project.tasks.detail> = {
  params: { projectId, taskId }
}
void nestedInput
// @ts-expect-error The child alone cannot repair an inherited parameter.
Nested.project.tasks.detail({ params: { taskId } })
// @ts-expect-error The composite path parameter names are required.
Nested.project.tasks.detail({ params: { projectId } })

const NestedLive = Router.route(Nested.project.tasks.detail, () => Effect.succeed({ name: "n" }))
const NestedApp = Router.layer(Nested).pipe(Layer.provide(NestedLive), Layer.provide(MemoryHistory.layer()))
const nestedService: Layer.Layer<Router.ServiceIdOf<typeof Nested>> = NestedApp
void nestedService

// Reused declarations bind to distinct parents without casts.
const OtherNested = Router.make("OtherNested").add(TaskRoutes)
const otherId: Router.IdOf<typeof OtherNested.tasks.detail> = "tasks.detail"
void otherId
const otherDestination = OtherNested.tasks.detail({ params: { taskId } })
// @ts-expect-error The other collection rejects the project-scoped destination shape.
OtherNested.tasks.detail({ params: { projectId, taskId } })

// Declaration pipeability preserves literals.
const piped = Route.make("piped", "/piped").pipe((self) => self)
const pipedId: Router.DeclarationIdentifier<typeof piped> = "piped"
void pipedId

// Sibling groups with identically named leaves keep distinct identities and
// require separate implementations.
const Twin = Router.make("Twin").add(
  RouteGroup.make("a")
    .add(Route.make("detail", "/:id", { params: { id: ProjectId }, success: Schema.Struct({ n: Schema.Number }) }))
    .prefix("/a"),
  RouteGroup.make("b")
    .add(Route.make("detail", "/:id", { params: { id: ProjectId }, success: Schema.Struct({ n: Schema.Number }) }))
    .prefix("/b")
)
const aDetailId: Router.IdOf<typeof Twin.a.detail> = "a.detail"
const bDetailId: Router.IdOf<typeof Twin.b.detail> = "b.detail"
void aDetailId
void bDetailId
const ADetail = Router.route(Twin.a.detail, () => Effect.succeed({ n: 1 }))
const BDetail = Router.route(Twin.b.detail, () => Effect.succeed({ n: 2 }))
const TwinApp = Router.layer(Twin).pipe(
  Layer.provide(Layer.merge(ADetail, BDetail)),
  Layer.provide(MemoryHistory.layer())
)
const twinComplete: Layer.Layer<Router.ServiceIdOf<typeof Twin>> = TwinApp
void twinComplete
const TwinOnlyA = Router.layer(Twin).pipe(Layer.provide(ADetail), Layer.provide(MemoryHistory.layer()))
// @ts-expect-error Missing the b.detail implementation.
// oxlint-disable-next-line effecttsgo/missing-layer-context -- Negative fixture: the missing implementation is the assertion under test.
const twinIncomplete: Layer.Layer<Router.ServiceIdOf<typeof Twin>> = TwinOnlyA
void twinIncomplete

// Widened options cannot preserve required schema/handler types and are
// rejected rather than silently erasing sections.
const widenedOptions: Route.Options = {
  params: { projectId: ProjectId },
  success: Schema.Struct({ title: Schema.String })
}
// @ts-expect-error Widened Route.Options is not a supported declaration input.
const Widened = Route.make("widened", "/:projectId", widenedOptions)
void Widened

// Whole-options unions are rejected: a union including `undefined` and a union
// of different sections both lose required implementation services.
const UnionSection = Schema.Struct({ title: Schema.String })
const unionWithUndefined = (options: { readonly success: typeof UnionSection } | undefined) =>
  // @ts-expect-error A union including undefined is ambiguous.
  Route.make("unionUndefined", "/union-undefined", options)
void unionWithUndefined
const unionOfSections = (
  options: { readonly success: typeof UnionSection } | { readonly error: typeof UnionSection }
) =>
  // @ts-expect-error A whole-options union would erase required services.
  Route.make("unionSections", "/union-sections", options)
void unionOfSections

class NeedsService extends Context.Service<NeedsService, { readonly n: number }>()("check/NeedsService") {}
const ServicefulCodec = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformEffect((value: string) => Effect.map(NeedsService, (svc) => `${value}${svc.n}`)),
    encode: SchemaGetter.transform((value: string) => value)
  })
)
// @ts-expect-error URL codecs must not require services.
Route.make("serviceful", "/:id", { params: { id: ServicefulCodec } })

const OtherRoutes = Router.make("Other").add(Route.make("home", "/"))
// @ts-expect-error Redirects must target the handler's collection.
Router.route(Routes.projects.detail, () => Effect.fail(Router.redirect(OtherRoutes.home())))
// @ts-expect-error Destinations are branded by their collection.
const foreignDestination: Destination<"App"> = OtherRoutes.home()
void foreignDestination

// Bound nodes no longer advertise unmaterialized schema fields.
// @ts-expect-error `params` is not a materialized bound-node property.
void Routes.projects.detail.params
// @ts-expect-error `success` is not a materialized bound-node property.
void Routes.projects.success
const nestedGroupId: Router.IdOf<typeof Nested.project.tasks> = "project.tasks"
void nestedGroupId
// @ts-expect-error The local key alone is not the qualified group identifier.
const nestedGroupLocalId: Router.IdOf<typeof Nested.project.tasks> = "tasks"
void nestedGroupLocalId

void Routes
void nestedDestination
void otherDestination
