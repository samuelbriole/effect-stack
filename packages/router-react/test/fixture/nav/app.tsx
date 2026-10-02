import { make } from "@effect-stack/router-react"
import * as Effect from "effect/Effect"
import { Home, Lazy, ProjectDetails, ProjectsIndex } from "./routes.tsx"

/**
 * Separate assembly module. No route module imports this finalized application;
 * route components link across routes through the type-only navigation helper.
 *
 * @since 0.4.0
 */
export const App = await Effect.runPromise(make("NavBoundary", [Home, ProjectsIndex, ProjectDetails, Lazy]))
