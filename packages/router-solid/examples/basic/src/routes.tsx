import { Outlet, layout, layer, make, route, useRouteInput } from "@effect-stack/router-solid"
import { useAtomValue, useAtomRefresh, useAtomResource } from "@effect/atom-solid"
import { Atom, AsyncResult } from "effect/reactivity"
import { ErrorBoundary, Suspense } from "solid-js"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import { Context, Effect, Layer, Schema } from "effect"
import type { JSX } from "solid-js"
import { Link } from "./navigation.ts"

/** A branded project identifier decoded from the URL. @since 0.4.0 */
export const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
/** @since 0.4.0 */
export type ProjectId = typeof ProjectId.Type

/** A decoded project id used by the demo navigation. @since 0.4.0 */
export const projectId = Schema.decodeUnknownSync(ProjectId)("42")
/** A project id whose first read fails, so the error boundary and retry are reachable. @since 0.4.0 */
export const failingProjectId = Schema.decodeUnknownSync(ProjectId)("13")

/** @since 0.4.0 */
export const ProjectData = Schema.Struct({ id: Schema.Number, title: Schema.String })
/** @since 0.4.0 */
export type ProjectData = typeof ProjectData.Type

/** The expected domain failure for a missing project. @since 0.4.0 */
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  projectId: Schema.Number
}) {}

/** The demo domain service. @since 0.4.0 */
export class Projects extends Context.Service<
  Projects,
  {
    readonly get: (id: ProjectId) => Effect.Effect<ProjectData, ProjectNotFound>
  }
>()("example/Projects") {}

/** @since 0.4.0 */
export const demoProjectsLayer = Layer.sync(Projects, () => {
  let failed = false
  return Projects.of({
    get: Effect.fn("Projects.get")(function* (id: ProjectId) {
      yield* Effect.sleep("200 millis")
      if (id === 13 && !failed) {
        failed = true
        return yield* Effect.fail(new ProjectNotFound({ projectId: id }))
      }
      return { id, title: `Project ${id}` }
    })
  })
})

/** @since 0.4.0 */
export const Home = route("home", "/", { component: HomePage })

/** @since 0.4.0 */
export const Project = layout("project", "/projects/:projectId", {
  params: { projectId: ProjectId },
  component: ProjectPage
})

function ProjectPage(): JSX.Element {
  const input = useRouteInput(Project)
  const result = useAtomValue(() => projectResource(input().params.projectId))
  const refresh = useAtomRefresh(() => projectResource(input().params.projectId))
  const resourceView = () => {
    const value = result()
    return AsyncResult.isInitial(value) ? (
      <ProjectPending />
    ) : AsyncResult.isFailure(value) ? (
      <section>
        <h3>Project failed</h3>
        <pre>{String(value.cause)}</pre>
        <button onClick={refresh}>Retry resource</button>
      </section>
    ) : (
      <h2>{value.value.title}</h2>
    )
  }
  return (
    <section>
      <Nav />
      {resourceView()}
      <button onClick={refresh}>Refresh resource</button>
      <p>id {String(input().params.projectId)}</p>
      <nav>
        <Link to="/projects/:projectId" params={{ projectId: input().params.projectId }}>
          Overview
        </Link>
        <Link to="/projects/:projectId/details" params={{ projectId: input().params.projectId }}>
          Details
        </Link>
      </nav>
      <Suspense fallback={<ProjectPending />}>
        <Outlet />
      </Suspense>
    </section>
  )
}

/** @since 0.4.0 */
export const ProjectIndex = Project.index({
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  component: OverviewPage
})

/** @since 0.4.0 */
export const ProjectDetails = Project.route("details", "/details", { component: DetailsPage })

/** @since 0.4.0 */
export const Slow = route("slow", "/slow", {
  prepare: () => Effect.sleep("1 seconds"),
  component: SlowPage
})

/** Runtime-owned application assembly. @since 0.4.0 */
export const assembly = make("Example", [Home, ProjectIndex, ProjectDetails, Slow])
/** The navigation witness type. @since 0.4.0 */
export type Application = Effect.Success<typeof assembly>

/** One service context for navigation gates and application resources. @since 0.4.0 */
export const runtime = Atom.runtime(
  layer(assembly).pipe(Layer.provideMerge(Layer.merge(BrowserHistory.layer, demoProjectsLayer)))
)

/** Application-owned resources using the shared runtime. @since 0.4.0 */
export const projectResource = Atom.family((id: ProjectId) =>
  runtime.atom(Projects.use((projects) => projects.get(id)))
)

function Nav(): JSX.Element {
  return (
    <nav>
      <Link to="/">Home</Link>
      <Link to="/projects/:projectId" params={{ projectId }}>
        Project 42
      </Link>
      <Link to="/projects/:projectId" params={{ projectId: failingProjectId }}>
        Failing project
      </Link>
      <Link to="/slow">Slow</Link>
    </nav>
  )
}

function HomePage(): JSX.Element {
  return (
    <section>
      <Nav />
      <h2>Home</h2>
      <p>Native Effect gates and typed Solid navigation.</p>
    </section>
  )
}

function ProjectPending(): JSX.Element {
  return <p role="status">Loading project…</p>
}

function OverviewPage(): JSX.Element {
  const input = useRouteInput(ProjectIndex)
  return <p>This is the project overview. tab {input().search.tab ?? "overview"}</p>
}

function DetailsPage(): JSX.Element {
  const input = useRouteInput(ProjectDetails)
  const refresh = useAtomRefresh(() => projectResource(input().params.projectId))
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <button
          onClick={() => {
            refresh()
            reset()
          }}
        >
          Retry details resource
        </button>
      )}
    >
      <DetailsResource />
    </ErrorBoundary>
  )
}

function DetailsResource(): JSX.Element {
  const input = useRouteInput(ProjectDetails)
  const [resource] = useAtomResource(() => projectResource(input().params.projectId), { suspendOnWaiting: true })
  return <p>Details for {resource()?.title}</p>
}

function SlowPage(): JSX.Element {
  return <p>The slow route finished preparing.</p>
}
