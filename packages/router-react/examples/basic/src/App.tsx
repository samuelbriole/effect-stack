import { createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from "@effect-stack/router-react"
import { Effect, Schema } from "effect"
import { useState } from "react"
import { demoLayer, Projects } from "./Projects.ts"

const rootRoute = createRootRoute({
  component: Layout,
  pendingComponent: () => <p role="status">Loading route…</p>,
  notFoundComponent: () => (
    <main>
      <h1>Page not found</h1>
      <Link to="/">Home</Link>
    </main>
  ),
  errorComponent: ({ error, reset }) => (
    <main>
      <h1>Route failed</h1>
      <pre>{String(error)}</pre>
      <button onClick={reset}>Retry</button>
      <Link to="/">Home</Link>
    </main>
  )
})
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <section>
      <h2>Home</h2>
      <p>Native Effect loaders and typed React navigation.</p>
    </section>
  )
})
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects/:projectId",
  params: { projectId: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  loader: ({ params }) => Projects.use((projects) => projects.get(params.projectId)),
  component: ProjectLayout
})
const projectIndex = createRoute({
  getParentRoute: () => projectRoute,
  path: "/",
  component: () => <p>Project overview</p>
})
const detailsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: "details",
  lazy: () => Effect.promise(() => import("./ProjectDetails.tsx")),
  pendingComponent: () => <p role="status">Loading details…</p>
})
export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, projectRoute.addChildren([projectIndex, detailsRoute])]),
  layer: demoLayer
})
declare module "@effect-stack/router-react" {
  interface Register {
    router: typeof router
  }
}

function Layout() {
  const [count, setCount] = useState(0)
  return (
    <main>
      <p className="eyebrow">First-party React adapter</p>
      <h1>EffectStack Router</h1>
      <nav>
        <Link to="/" exact>Home</Link>
        <Link to="/projects/:projectId" params={{ projectId: 42 }}>Project 42</Link>
      </nav>
      <button onClick={() => setCount(count + 1)}>Layout counter: {count}</button>
      <Outlet />
    </main>
  )
}
function ProjectLayout() {
  const project = projectRoute.useLoaderData()
  const params = projectRoute.useParams()
  return (
    <section>
      <h2>{project.title}</h2>
      <nav>
        <Link to="/projects/:projectId" params={params} exact>Overview</Link>
        <Link to="/projects/:projectId/details" params={params}>Details</Link>
      </nav>
      <Outlet />
    </section>
  )
}
export const App = () => <RouterProvider router={router} />
