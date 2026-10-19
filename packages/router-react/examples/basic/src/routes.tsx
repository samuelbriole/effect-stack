import { Outlet, layout, make, layer, route, useRouteInput } from "@effect-stack/router-react"
import { useAtomValue, useAtomRefresh, useAtomSuspense } from "@effect/atom-react"
import { Atom, AsyncResult } from "effect/reactivity"
import { Suspense } from "react"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import { Context, Effect, Layer, Schema } from "effect"
import type { ReactNode } from "react"
import { Link } from "./navigation.tsx"

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

/**
 * A demo service Layer. The closure state is scoped to one runtime
 * acquisition; project 13 fails on its first read so retry recovers,
 * exercising the domain failure boundary without external infrastructure.
 *
 * @since 0.4.0
 */
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

/**
 * A unified project layout: its component observes a project resource and
 * continues to nested index/details endpoints through an unbound `Outlet`.
 *
 * @since 0.4.0
 */
export const Project = layout("project", "/projects/:projectId", {
  params: { projectId: ProjectId },
  component: ProjectPage
})

function ProjectPage(): ReactNode {
  const input = useRouteInput(Project)
  const resource = projectResource(input.params.projectId)
  const result = useAtomValue(resource)
  const refresh = useAtomRefresh(resource)
  return (
    <section>
      <Nav />
      {AsyncResult.isInitial(result) ? (
        <ProjectPending />
      ) : AsyncResult.isFailure(result) ? (
        <section>
          <h3>Project failed</h3>
          <pre>{String(result.cause)}</pre>
          <button onClick={refresh}>Retry resource</button>
        </section>
      ) : (
        <h2>{result.value.title}</h2>
      )}
      <button onClick={refresh}>Refresh resource</button>
      <p>id {input.params.projectId}</p>
      <nav>
        <Link to="/projects/:projectId" params={{ projectId: input.params.projectId }}>
          Overview
        </Link>
        <Link to="/projects/:projectId/details" params={{ projectId: input.params.projectId }}>
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

const assembly = make("Example", [Home, ProjectIndex, ProjectDetails, Slow])

/** The application's inferred definition and gate evidence. @since 0.4.0 */
export type Application = Effect.Success<typeof assembly>

/** One service context for navigation gates and application resources. @since 0.4.0 */
export const runtime = Atom.runtime(
  layer(assembly).pipe(Layer.provideMerge(Layer.merge(BrowserHistory.layer, demoProjectsLayer)))
)

/** Application-owned resources using the shared runtime. @since 0.4.0 */
export const projectResource = Atom.family((id: ProjectId) =>
  runtime.atom(Projects.use((projects) => projects.get(id)))
)

function Nav(): ReactNode {
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

function HomePage(): ReactNode {
  return (
    <section>
      <Nav />
      <h2>Home</h2>
      <p>Native Effect gates and typed React navigation.</p>
    </section>
  )
}

function ProjectPending(): ReactNode {
  return <p role="status">Loading project…</p>
}

function OverviewPage(): ReactNode {
  const input = useRouteInput(ProjectIndex)
  return <p>This is the project overview. tab {input.search.tab ?? "overview"}</p>
}

function DetailsPage(): ReactNode {
  const input = useRouteInput(ProjectDetails)
  const result = useAtomSuspense(projectResource(input.params.projectId), { includeFailure: true })
  return (
    <p>
      {result._tag === "Success" ? `Details for ${result.value.title}` : "Refresh the project resource to recover."}
    </p>
  )
}

function SlowPage(): ReactNode {
  return <p>The slow route finished preparing.</p>
}
