import { Link, Outlet, RouterProvider, useRoute, type ErrorProps, type Views } from "@effect-stack/router-solid"
import { AppLive, projectId42, Routes } from "@effect-stack-example/router-shared"
import { RegistryProvider } from "@effect/atom-solid"
import { Atom } from "effect/unstable/reactivity"
import { createSignal } from "solid-js"

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
      <p>Native Effect handlers and typed Solid navigation.</p>
    </section>
  )
}

function ProjectPending() {
  return <p role="status">Loading project…</p>
}

function ProjectBoundary(props: ErrorProps) {
  return (
    <section>
      <Nav />
      <h3>Project failed</h3>
      <pre>{String(props.error)}</pre>
      <button onClick={props.reset}>Retry</button>
    </section>
  )
}

function ProjectPage() {
  const route = useRoute(Routes.project)
  const [count, setCount] = createSignal(0)
  return (
    <section>
      <Nav />
      <h2>{route().data.title}</h2>
      <p>
        id {route().params.projectId} · tab {route().search.tab ?? "overview"}
      </p>
      <button onClick={() => setCount(count() + 1)}>Layout counter: {count()}</button>
      <nav>
        <Link to={Routes.project({ params: route().params, search: route().search })}>Overview</Link>
        <Link to={Routes.details({ params: route().params })}>Details</Link>
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

export function App() {
  return (
    <RegistryProvider>
      <RouterProvider routes={Routes} runtime={runtime} views={views} />
    </RegistryProvider>
  )
}
