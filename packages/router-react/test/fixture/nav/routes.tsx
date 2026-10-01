import * as Effect from "effect/Effect"
import * as React from "react"
import * as Schema from "effect/Schema"
import { Outlet, layout, route } from "@effect-stack/router-react"
import { Link } from "./navigation.tsx"

/**
 * Route modules. The parent layout links to a child endpoint by path literal;
 * it never imports the child module, so eager parent/child definition imports
 * cannot form an import cycle.
 *
 * @since 0.4.0
 */
export const Home = route("home", "/", {
  component: () => (
    <main>
      <h1>Nav home</h1>
      <Link to="/projects">Projects</Link>
      <Link to="/lazy">Lazy</Link>
    </main>
  )
})

/** A route whose component is lazily imported and must not load until rendered. @since 0.4.0 */
const LazyPage = React.lazy(() => import("./lazy-target.tsx"))

export const Lazy = route("lazy", "/lazy", {
  component: () => (
    <React.Suspense fallback={<p>Lazy pending</p>}>
      <LazyPage />
    </React.Suspense>
  )
})

export const Projects = layout("projects", "/projects", {
  component: () => (
    <section>
      <h2>Projects layout</h2>
      <nav>
        <Link to="/projects">Projects index</Link>
        <Link to="/projects/:projectId/details" params={{ projectId: 7 }}>
          Child details
        </Link>
      </nav>
      <Outlet />
    </section>
  )
})

export const ProjectsIndex = Projects.index({
  component: () => <p>Projects index</p>
})

export const Project = Projects.layout("project", "/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  prepare: () => Effect.void
})

export const ProjectDetails = Project.route("details", "/details", {
  component: () => <p>Project details</p>
})
