import * as Schema from "effect/Schema"
import { Outlet, layout, route } from "@effect-stack/router-react"

/**
 * Individually exported route modules. This file is a hand-written stand-in for
 * what a file-based route generator would emit: ordinary public-API
 * constructors with deterministic names and parentage. Nothing here imports a
 * finalized application, so a child module can import this parent directly.
 *
 * @since 0.4.0
 */
export const Home = route("home", "/", {
  component: () => <h1>Fixture home</h1>
})

function WorkspaceLayout() {
  return (
    <section data-testid="workspace">
      <h1>Workspace</h1>
      <Outlet />
    </section>
  )
}

export const Workspace = layout("workspace", "/workspaces/:workspaceId", {
  params: { workspaceId: Schema.FiniteFromString },
  component: WorkspaceLayout
})
