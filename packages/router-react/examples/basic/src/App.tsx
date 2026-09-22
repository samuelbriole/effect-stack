import { Link, Outlet, RouterProvider, useRoute, type ErrorProps, type Views } from "@effect-stack/router-react"
import { AppLive, projectId42, Routes } from "@effect-stack-example/router-shared"
import { RegistryProvider } from "@effect/atom-react"
import { Atom } from "effect/unstable/reactivity"
import { useState } from "react"

const runtime = Atom.runtime(AppLive)

function Nav() {
  return (
    <nav>
      <Link to={Routes.home()}>Home</Link>
      <Link to={Routes.project({ params: { projectId: projectId42 } })}>Project 42</Link>
      <Link to={Routes.slow()}>Slow</Link>
    </nav>
  )
}

function HomePage() {
  return (
    <section>
      <Nav />
      <h2>Home</h2>
      <p>Native Effect handlers and typed React navigation.</p>
    </section>
  )
}

function ProjectPending() {
  return <p role="status">Loading project…</p>
}

function ProjectBoundary({ error, reset }: ErrorProps) {
  return (
    <section>
      <Nav />
      <h3>Project failed</h3>
      <pre>{String(error)}</pre>
      <button onClick={reset}>Retry</button>
    </section>
  )
}

function ProjectPage() {
  const { params, search, data } = useRoute(Routes.project)
  const [count, setCount] = useState(0)
  return (
    <section>
      <Nav />
      <h2>{data.title}</h2>
      <p>
        id {params.projectId} · tab {search.tab ?? "overview"}
      </p>
      <button onClick={() => setCount(count + 1)}>Layout counter: {count}</button>
      <nav>
        <Link to={Routes.project({ params, search })}>Overview</Link>
        <Link to={Routes.details({ params })}>Details</Link>
      </nav>
      <Outlet />
    </section>
  )
}

function DetailsPage() {
  return <p>This view is rendered through a nested layout Outlet.</p>
}

function SlowPage() {
  return <p>The slow route finished preparing.</p>
}

const views = {
  home: HomePage,
  project: { component: ProjectPage, pending: ProjectPending, error: ProjectBoundary },
  details: DetailsPage,
  slow: { component: SlowPage, pending: () => <p role="status">Preparing…</p> }
} satisfies Views<typeof Routes>

export const App = () => (
  <RegistryProvider>
    <RouterProvider routes={Routes} runtime={runtime} views={views} />
  </RegistryProvider>
)
