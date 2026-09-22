/**
 * Compile-time negative contract checks. Typechecked by `pnpm check`; not run
 * by Vitest.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Router from "@effect-stack/router/Router"

const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
const projectId = Schema.decodeUnknownSync(ProjectId)(1)

const Routes = Router.schema("App", {
  home: "/",
  project: {
    path: "/projects/:projectId",
    params: { projectId: ProjectId },
    search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
    success: Schema.Struct({ title: Schema.String }),
    error: Schema.Struct({ code: Schema.Number })
  }
})

const Other = Router.schema("Other", {
  home: "/"
})

// @ts-expect-error Missing required params.
Routes.project({ search: {} })
// @ts-expect-error Search values are constrained by the declared schema.
Routes.project({ params: { projectId }, search: { tab: "nope" } })
// @ts-expect-error Params are branded.
Routes.project({ params: { projectId: 1 } })

class Boom {
  readonly _tag = "Boom"
}
// @ts-expect-error Undeclared handler errors are rejected.
Router.route(Routes.project, () => Effect.fail(new Boom()))
// @ts-expect-error Handler success must satisfy the declared success schema.
Router.route(Routes.project, () => Effect.succeed({ nope: 1 }))
// @ts-expect-error Redirects belong to one collection.
Router.route(Routes.project, () => Effect.fail(Router.redirect(Other.home())))

// Nested child identifiers are qualified by their ancestor path, so two groups
// with the same local child name require separate implementations.
const Nested = Router.schema("Nested", {
  a: {
    path: "/a",
    children: {
      detail: { path: ":id", params: { id: Schema.FiniteFromString }, success: Schema.Struct({ n: Schema.Number }) }
    }
  },
  b: {
    path: "/b",
    children: {
      detail: { path: ":id", params: { id: Schema.FiniteFromString }, success: Schema.Struct({ n: Schema.Number }) }
    }
  }
})

const qualifiedId: Router.IdOf<typeof Nested.a.detail> = "a.detail"
void qualifiedId
// @ts-expect-error The local key alone is not the qualified identifier.
const localId: Router.IdOf<typeof Nested.a.detail> = "detail"
void localId

const ADetail = Router.route(Nested.a.detail, () => Effect.succeed({ n: 1 }))
const BDetail = Router.route(Nested.b.detail, () => Effect.succeed({ n: 2 }))

const Both = Router.layer(Nested).pipe(
  Layer.provide(Layer.merge(ADetail, BDetail)),
  Layer.provide(MemoryHistory.layer())
)
const complete: Layer.Layer<Router.ServiceIdOf<typeof Nested>> = Both
void complete

const OnlyA = Router.layer(Nested).pipe(Layer.provide(ADetail), Layer.provide(MemoryHistory.layer()))
// @ts-expect-error Missing the b.detail implementation.
// oxlint-disable-next-line effecttsgo/missing-layer-context -- Negative fixture: the missing implementation is the assertion under test.
const incomplete: Layer.Layer<Router.ServiceIdOf<typeof Nested>> = OnlyA
void incomplete
