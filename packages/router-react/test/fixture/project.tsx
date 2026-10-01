import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { useRouteInput } from "@effect-stack/router-react"
import type { ReactNode } from "react"
import { Workspace } from "./routes.tsx"

/**
 * A child route module that imports its parent definition directly. Local
 * parent-aware inference needs no finalized application import.
 *
 * @since 0.4.0
 */
export const Project = Workspace.route("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  prepare: () => Effect.void,
  component: (): ReactNode => <h1>Project {useRouteInput(Project).params.projectId}</h1>
})

/** An endpoint deliberately missing a success presentation. @since 0.4.0 */
export const GateOnly = Workspace.route("gateOnly", "/gate-only", {
  prepare: () => Effect.void
})
