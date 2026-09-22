import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import * as Router from "@effect-stack/router/Router"
import { Context, Effect, Layer, Schema } from "effect"

/** @since 0.4.0 */
export const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
/** @since 0.4.0 */
export type ProjectId = typeof ProjectId.Type

/** @since 0.4.0 */
export const projectId42 = Schema.decodeUnknownSync(ProjectId)(42)

/** @since 0.4.0 */
export const Project = Schema.Struct({ id: Schema.Number, title: Schema.String })
/** @since 0.4.0 */
export type Project = typeof Project.Type

/** @since 0.4.0 */
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  projectId: Schema.Number
}) {}

/** @since 0.4.0 */
export class Projects extends Context.Service<
  Projects,
  {
    readonly get: (id: number) => Effect.Effect<Project, ProjectNotFound>
  }
>()("example/Projects") {}

/** @since 0.4.0 */
export const demoProjectsLayer = Layer.succeed(
  Projects,
  Projects.of({
    get: (id: number) => Effect.succeed({ id, title: `Project ${id}` })
  })
)

/** A concise named contract with typed destinations and optional success. @since 0.4.0 */
export const Routes = Router.schema("Example", {
  home: "/",
  project: {
    path: "/projects/:projectId",
    params: { projectId: ProjectId },
    search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
    success: Project,
    error: ProjectNotFound
  },
  details: {
    path: "/projects/:projectId/details",
    params: { projectId: ProjectId }
  },
  slow: {
    path: "/slow",
    success: Schema.Void
  }
})

const ProjectLive = Router.route(Routes.project, ({ params }) =>
  Projects.use((projects) => projects.get(params.projectId))
)

const SlowLive = Router.route(Routes.slow, () => Effect.sleep("1 seconds"))

const DetailsLive = Router.route(Routes.details, () => Effect.void)

/** The complete router Layer: implementations, history, and domain services. @since 0.4.0 */
export const AppLive = Router.layer(Routes).pipe(
  Layer.provide(Layer.mergeAll(ProjectLive, SlowLive, DetailsLive)),
  Layer.provide(BrowserHistory.layer),
  Layer.provide(demoProjectsLayer)
)
